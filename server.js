#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { apiCall } from "./api.js";
import { buildTools } from "./tools.js";

// ─── Configuration ───────────────────────────────────────────────────────────

const HTTP_MODE = process.env.PORT || process.argv.includes("--http");
const PORT = parseInt(process.env.PORT, 10) || 3000;

// ─── Logger ─────────────────────────────────────────────────────────────────

function log(category, message, data = {}) {
  const entry = {
    ts: new Date().toISOString(),
    cat: category,
    msg: message,
    ...data,
  };
  console.log(JSON.stringify(entry));
}

// Never log the API key or any part of it. A short hash lets us tell keys apart in logs.
function keyFingerprint(apiKey) {
  return "key_" + createHash("sha256").update(apiKey).digest("hex").substring(0, 10);
}

// In stdio mode, require SCRAPELY_API_KEY upfront.
// In HTTP mode, each request provides the key via Bearer token.
if (!HTTP_MODE) {
  if (!process.env.SCRAPELY_API_KEY) {
    console.error("ERROR: SCRAPELY_API_KEY environment variable is required.");
    console.error("Set it with: export SCRAPELY_API_KEY=sk_live_your_key_here");
    process.exit(1);
  }
}

// ─── Tool Registration ──────────────────────────────────────────────────────

// Appended to every tool error so agents report bugs and confusing tool descriptions back to us
const FEEDBACK_HINT =
  "If this looks like a bug in Scrapely or a confusing tool description (not a mistake in your input), " +
  "call the submit_feedback tool with the tool name, the error, and what you were trying to do.";

// Tool definitions live in tools.js (shared with the CLI). The hosted server gets
// the variant without upload_media's file_path, so it never reads its own files.
const tools = buildTools({ hosted: Boolean(HTTP_MODE) });

function registerTools(server, getApiKey, sessionLabel = "stdio") {
  const keyPrefix = () => keyFingerprint(getApiKey());

  const call = async (method, path, body, queryParams) => {
    const result = await apiCall(getApiKey(), method, path, body, queryParams);
    return result;
  };

  // Wrong-argument errors are raised by the SDK before our handler runs, so add the hint there too.
  // validateToolInput is SDK-internal; if a future SDK renames it we just lose the hint on these errors.
  if (typeof server.validateToolInput === "function") {
    const origValidate = server.validateToolInput.bind(server);
    server.validateToolInput = async (tool, args, toolName) => {
      try {
        return await origValidate(tool, args, toolName);
      } catch (err) {
        log("tool_error", `${toolName} invalid arguments`, { error: err.message, key: keyPrefix(), session: sessionLabel });
        if (toolName === "submit_feedback") throw err;
        err.message = `${err.message}\n\n${FEEDBACK_HINT}`;
        throw err;
      }
    };
  }

  // Wrap server.tool to auto-log every tool call
  const origTool = server.tool.bind(server);
  server.tool = (name, description, schema, handler) => {
    origTool(name, description, schema, async (...args) => {
      log("tool", name, { key: keyPrefix(), session: sessionLabel });
      try {
        const result = await handler(...args);
        return result;
      } catch (err) {
        log("tool_error", `${name} failed`, { error: err.message, key: keyPrefix(), session: sessionLabel });
        if (name === "submit_feedback") throw err; // no hint here, or a failing report would ask for another report
        throw new Error(`${err.message}\n\n${FEEDBACK_HINT}`);
      }
    });
  };

  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.inputs, async (args) => {
      const data = await tool.run(args, call);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    });
  }
}

// ─── Stdio Mode (npx scrapely-mcp) ─────────────────────────────────────────

async function startStdio() {
  const apiKey = process.env.SCRAPELY_API_KEY;
  const server = new McpServer({ name: "Scrapely", version: "1.18.0" });
  registerTools(server, () => apiKey);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Scrapely MCP Server running on stdio");
}

// ─── HTTP Mode (Claude Connector / remote MCP) ─────────────────────────────

async function startHttp() {
  const sessions = new Map();
  // Stores: clientId -> { client_id, redirect_uris, ..., createdAt }
  const clients = new Map();

  const BASE_URL = process.env.BASE_URL || `https://mcp.scrapely.co`;

  // ─── Rate Limiter ──────────────────────────────────────────────────────
  // Simple in-memory per-IP rate limiter. windowMs = time window, max = max requests.
  const rateLimitBuckets = new Map();
  function rateLimit(ip, bucket, max, windowMs) {
    const key = `${bucket}:${ip}`;
    const now = Date.now();
    let entry = rateLimitBuckets.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      rateLimitBuckets.set(key, entry);
    }
    entry.count++;
    return entry.count > max;
  }
  // Clean up stale rate limit entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitBuckets) {
      if (now - entry.start > 300000) rateLimitBuckets.delete(key);
    }
  }, 300000);

  // ─── Client Registration TTL ──────────────────────────────────────────
  // Expire unused client registrations after 1 hour
  setInterval(() => {
    const now = Date.now();
    for (const [id, client] of clients) {
      if (now - client.createdAt > 3600000) clients.delete(id);
    }
  }, 600000);

  // Helper: get client IP (behind Caddy proxy)
  function getIP(req) {
    return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress;
  }

  // Helper: send 429
  function tooManyRequests(res, ip, bucket) {
    log("rate_limit", "rate limit hit", { ip, bucket });
    res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
    res.end(JSON.stringify({ error: "too_many_requests", error_description: "Rate limit exceeded. Try again later." }));
  }

  // Helper to read request body
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });
  }

  // Helper to parse URL with base
  function parseUrl(req) {
    return new URL(req.url, BASE_URL);
  }

  const httpServer = createServer(async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = parseUrl(req);
    const pathname = url.pathname;
    const ip = getIP(req);

    // Log all non-OPTIONS requests (skip health checks and static metadata)
    if (pathname !== "/health" && !pathname.startsWith("/.well-known")) {
      log("req", `${req.method} ${pathname}`, { ip });
    }

    // ─── Health check ────────────────────────────────────────────────────
    if (pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // ─── OAuth Protected Resource Metadata (RFC 9728) ────────────────────
    if (pathname === "/.well-known/oauth-protected-resource" || pathname === "/.well-known/oauth-protected-resource/mcp") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        resource: `${BASE_URL}/mcp`,
        authorization_servers: [`${BASE_URL}`],
        bearer_methods_supported: ["header"],
        resource_name: "Scrapely MCP",
      }));
      return;
    }

    // ─── OAuth Authorization Server Metadata (RFC 8414) ──────────────────
    if (pathname === "/.well-known/oauth-authorization-server") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        issuer: BASE_URL,
        authorization_endpoint: `${BASE_URL}/authorize`,
        token_endpoint: `${BASE_URL}/token`,
        registration_endpoint: `${BASE_URL}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256", "plain"],
        scopes_supported: [],
      }));
      return;
    }

    // ─── Dynamic Client Registration (RFC 7591) ─────────────────────────
    if (pathname === "/register" && req.method === "POST") {
      // Rate limit: 20 registrations per IP per minute
      if (rateLimit(ip, "register", 20, 60000)) return tooManyRequests(res, ip, "register");

      const body = await readBody(req);
      let data;
      try { data = JSON.parse(body); } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
        return;
      }

      const clientId = `client_${randomUUID()}`;
      const clientInfo = {
        client_id: clientId,
        client_name: data.client_name || "MCP Client",
        redirect_uris: data.redirect_uris || [],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        createdAt: Date.now(),
      };
      clients.set(clientId, clientInfo);
      log("auth", "client registered", { clientId, clientName: clientInfo.client_name, ip });

      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(clientInfo));
      return;
    }

    // ─── Authorization Endpoint ──────────────────────────────────────────
    // Redirect to the Scrapely app consent page (user logs in there)
    if (pathname === "/authorize" && req.method === "GET") {
      const clientId = url.searchParams.get("client_id") || "";
      const redirectUri = url.searchParams.get("redirect_uri") || "";
      const state = url.searchParams.get("state") || "";
      const codeChallenge = url.searchParams.get("code_challenge") || "";
      const codeChallengeMethod = url.searchParams.get("code_challenge_method") || "plain";

      if (!redirectUri) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Bad Request</h1><p>Missing redirect_uri</p>");
        return;
      }

      const APP_URL = process.env.APP_URL || "https://app.scrapely.co";
      const consentUrl = new URL(`${APP_URL}/oauth/consent`);
      consentUrl.searchParams.set("client_id", clientId);
      consentUrl.searchParams.set("redirect_uri", redirectUri);
      consentUrl.searchParams.set("state", state);
      consentUrl.searchParams.set("code_challenge", codeChallenge);
      consentUrl.searchParams.set("code_challenge_method", codeChallengeMethod);

      log("auth", "redirecting to consent", { clientId, ip });
      res.writeHead(302, { Location: consentUrl.toString() });
      res.end();
      return;
    }

    // ─── Token Endpoint ──────────────────────────────────────────────────
    // Exchange auth code for access token. Codes are stored in Supabase
    // by the Scrapely app's /api/oauth/authorize endpoint.
    if (pathname === "/token" && req.method === "POST") {
      // Rate limit: 30 token requests per IP per minute
      if (rateLimit(ip, "token", 30, 60000)) return tooManyRequests(res, ip, "token");

      const body = await readBody(req);
      const params = new URLSearchParams(body);
      const grantType = params.get("grant_type");
      const code = params.get("code");
      const codeVerifier = params.get("code_verifier");

      if (grantType !== "authorization_code" || !code) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
        return;
      }

      // Look up the auth code from Supabase
      const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!SUPABASE_URL || !SUPABASE_KEY) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "server_error", error_description: "Missing Supabase config" }));
        return;
      }

      // Fetch the auth code from Supabase
      const codeRes = await fetch(
        `${SUPABASE_URL}/rest/v1/mcp_auth_codes?code=eq.${encodeURIComponent(code)}&select=*`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );
      const codeRows = await codeRes.json();
      const stored = Array.isArray(codeRows) && codeRows[0];

      if (!stored) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant", error_description: "Code expired or invalid" }));
        return;
      }

      // Check expiry
      if (new Date(stored.expires_at) < new Date()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant", error_description: "Code expired" }));
        return;
      }

      // Verify PKCE if code_challenge was provided
      if (stored.code_challenge) {
        let valid = false;
        if (stored.code_challenge_method === "plain") {
          valid = codeVerifier === stored.code_challenge;
        } else if (stored.code_challenge_method === "S256") {
          const { createHash } = await import("node:crypto");
          const hash = createHash("sha256").update(codeVerifier || "").digest("base64url");
          valid = hash === stored.code_challenge;
        }
        if (!valid) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_grant", error_description: "PKCE verification failed" }));
          return;
        }
      }

      // Delete the used code
      await fetch(
        `${SUPABASE_URL}/rest/v1/mcp_auth_codes?code=eq.${encodeURIComponent(code)}`,
        {
          method: "DELETE",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );

      // The access token IS the Scrapely API key
      log("auth", "token exchanged", { customer_id: stored.customer_id, key: keyFingerprint(stored.api_key), ip });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        access_token: stored.api_key,
        token_type: "Bearer",
        scope: "",
      }));
      return;
    }

    // ─── MCP Endpoint ────────────────────────────────────────────────────
    if (pathname !== "/mcp") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    // Extract API key from Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.writeHead(401, {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
      });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const apiKey = authHeader.slice(7).trim();
    if (!apiKey) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Empty API key" }));
      return;
    }

    // Existing session
    const sessionId = req.headers["mcp-session-id"];
    if (sessionId && sessions.has(sessionId)) {
      await sessions.get(sessionId).transport.handleRequest(req, res);
      return;
    }
    if (sessionId && !sessions.has(sessionId)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    // New session
    const keyPfx = keyFingerprint(apiKey);
    log("session", "new MCP session", { key: keyPfx, ip });
    const mcpServer = new McpServer({ name: "Scrapely", version: "1.18.0" });
    registerTools(mcpServer, () => apiKey, keyPfx);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) sessions.delete(sid);
    };

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);

    // Session ID is generated during handleRequest (on initialize)
    const sid = transport.sessionId;
    if (sid) sessions.set(sid, { server: mcpServer, transport });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Scrapely MCP Server running on http://0.0.0.0:${PORT}/mcp`);
    console.log(`Base URL: ${BASE_URL}`);
    console.log("Auth: OAuth 2.1 with PKCE (API key as access token)");
  });
}

// ─── Entry Point ────────────────────────────────────────────────────────────

if (HTTP_MODE) {
  startHttp().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
} else {
  startStdio().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
