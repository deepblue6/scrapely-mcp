#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

// ─── Configuration ───────────────────────────────────────────────────────────

const API_BASE = "https://app.scrapely.co/api/v1";
const HTTP_MODE = process.env.PORT || process.argv.includes("--http");
const PORT = parseInt(process.env.PORT, 10) || 3000;

// In stdio mode, require SCRAPELY_API_KEY upfront.
// In HTTP mode, each request provides the key via Bearer token.
if (!HTTP_MODE) {
  if (!process.env.SCRAPELY_API_KEY) {
    console.error("ERROR: SCRAPELY_API_KEY environment variable is required.");
    console.error("Set it with: export SCRAPELY_API_KEY=sk_live_your_key_here");
    process.exit(1);
  }
}

// ─── API Helper ──────────────────────────────────────────────────────────────

async function apiCall(apiKey, method, path, body = null, queryParams = null) {
  let url = `${API_BASE}${path}`;

  if (queryParams) {
    const filtered = Object.fromEntries(
      Object.entries(queryParams).filter(([, v]) => v !== undefined && v !== null)
    );
    const qs = new URLSearchParams(filtered).toString();
    if (qs) url += `?${qs}`;
  }

  const options = {
    method,
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
  };

  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      `API Error ${res.status}: ${data.message || data.error || JSON.stringify(data)}`
    );
  }

  return data;
}

// ─── Tool Registration ──────────────────────────────────────────────────────

function registerTools(server, getApiKey) {
  const call = (method, path, body, queryParams) =>
    apiCall(getApiKey(), method, path, body, queryParams);

  server.tool("list_accounts", "List all connected Twitter/X accounts in the workspace", {}, async () => {
    const data = await call("GET", "/accounts");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("add_account", "Add a new Twitter/X account to the workspace.", {
    handle: z.string().describe("Twitter handle (with or without @)"),
    cookies: z.array(z.object({ name: z.string(), value: z.string(), domain: z.string() })).describe("Cookie objects — must include ct0 and auth_token"),
    proxy: z.string().describe("Proxy URL"),
    proxy_auth: z.string().describe("Proxy auth in username:password format"),
    xchat_pin: z.string().describe("X chat PIN code"),
  }, async ({ handle, cookies, proxy, proxy_auth, xchat_pin }) => {
    const data = await call("POST", "/accounts", { handle, cookies, proxy, proxy_auth, xchat_pin });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("remove_account", "Remove a Twitter/X account from the workspace.", {
    account_id: z.string().optional().describe("The account UUID to remove"),
    handle: z.string().optional().describe("Twitter handle to remove"),
  }, async ({ account_id, handle }) => {
    const body = {};
    if (account_id) body.account_id = account_id;
    if (handle) body.handle = handle;
    const data = await call("DELETE", "/accounts", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("update_cookies", "Update cookies for an existing Twitter/X account.", {
    account_id: z.string().describe("The account UUID"),
    cookies: z.array(z.object({ name: z.string(), value: z.string(), domain: z.string() })).describe("Cookie objects — must include ct0 and auth_token"),
  }, async ({ account_id, cookies }) => {
    const data = await call("PUT", "/accounts/cookies", { account_id, cookies });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("toggle_pause", "Pause or unpause DM sending for a Twitter/X account", {
    account_id: z.string().describe("The account UUID"),
    is_paused: z.boolean().describe("true to pause, false to unpause"),
  }, async ({ account_id, is_paused }) => {
    const data = await call("PATCH", "/accounts/pause", { account_id, is_paused });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("toggle_followups_pause", "Pause or unpause follow-up messages for a Twitter/X account", {
    account_id: z.string().describe("The account UUID"),
    followups_paused: z.boolean().describe("true to pause, false to unpause"),
  }, async ({ account_id, followups_paused }) => {
    const data = await call("PATCH", "/accounts/pause-followups", { account_id, followups_paused });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("update_proxy", "Update proxy settings for an existing Twitter/X account.", {
    account_id: z.string().describe("The account UUID"),
    proxy: z.string().describe("Proxy URL"),
    proxy_auth: z.string().describe("Proxy auth in username:password format"),
  }, async ({ account_id, proxy, proxy_auth }) => {
    const data = await call("PUT", "/accounts/proxy", { account_id, proxy, proxy_auth });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("get_account_tags", "Get tags for a specific account or all accounts.", {
    account_id: z.string().optional().describe("Account UUID. Omit to get tags for all accounts."),
  }, async ({ account_id }) => {
    const data = await call("GET", "/accounts/tags", null, { account_id });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("set_account_tags", "Replace all tags for an account.", {
    account_id: z.string().describe("The account UUID"),
    tags: z.array(z.string()).describe("Array of tag strings to set"),
  }, async ({ account_id, tags }) => {
    const data = await call("PUT", "/accounts/tags", { account_id, tags });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("update_account_tags", "Add or remove individual tags on an account.", {
    account_id: z.string().describe("The account UUID"),
    add: z.array(z.string()).optional().describe("Tags to add"),
    remove: z.array(z.string()).optional().describe("Tags to remove"),
  }, async ({ account_id, add, remove }) => {
    const body = { account_id };
    if (add) body.add = add;
    if (remove) body.remove = remove;
    const data = await call("PATCH", "/accounts/tags", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("toggle_warmup", "Enable or disable warmup mode for a Twitter/X account", {
    account_id: z.string().describe("The account UUID"),
    warmup_enabled: z.boolean().describe("true to enable warmup, false to disable"),
  }, async ({ account_id, warmup_enabled }) => {
    const data = await call("PATCH", "/accounts/warmup", { account_id, warmup_enabled });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // ─── LEAD SCRAPING ─────────────────────────────────────────────────────────

  server.tool("create_scraping_source", "Create a new lead source by scraping followers/following from Twitter/X accounts.", {
    name: z.string().describe("Name for the lead source"),
    sources: z.array(z.object({
      handle: z.string().describe("Twitter handle to scrape"),
      followers: z.boolean().optional().describe("Scrape their followers"),
      following: z.boolean().optional().describe("Scrape who they follow"),
    })).describe("Array of accounts to scrape from"),
    filters: z.object({
      includeKeywords: z.array(z.array(z.string())).optional(),
      excludeKeywords: z.array(z.array(z.string())).optional(),
      includeWithinLogic: z.enum(["AND", "OR"]).optional(),
      includeBetweenLogic: z.enum(["AND", "OR"]).optional(),
      excludeWithinLogic: z.enum(["AND", "OR"]).optional(),
      excludeBetweenLogic: z.enum(["AND", "OR"]).optional(),
      locationExcludeKeywords: z.array(z.string()).optional(),
      followers: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
      following: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
      hasWebsite: z.boolean().nullable().optional(),
    }).optional().describe("Filter configuration"),
  }, async ({ name, sources, filters }) => {
    const body = { name, sources };
    if (filters) body.filters = filters;
    const data = await call("POST", "/scraping-sources", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("check_scraping_status", "Check the status of scraping jobs.", {
    id: z.string().optional().describe("Specific scraping source ID"),
    limit: z.number().optional().describe("Results per page (max 100)"),
    offset: z.number().optional().describe("Pagination offset"),
  }, async ({ id, limit, offset }) => {
    const data = await call("GET", "/scraping-sources", null, { id, limit, offset });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("get_scraping_source_leads", "Get leads from a specific scraping source.", {
    source_id: z.string().describe("The scraping source ID"),
    limit: z.number().optional().describe("Results per page (max 100)"),
    offset: z.number().optional().describe("Pagination offset"),
  }, async ({ source_id, limit, offset }) => {
    const data = await call("GET", `/scraping-sources/${source_id}/leads`, null, { limit, offset });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // ─── CAMPAIGNS ─────────────────────────────────────────────────────────────

  server.tool("launch_campaign", "Launch a DM campaign targeting leads from scraping sources.", {
    name: z.string().describe("Campaign name"),
    message: z.string().optional().describe("Message text (supports {{firstName}})"),
    message_variants: z.array(z.object({
      message: z.string(),
      followups: z.array(z.object({
        wait_time: z.number(),
        wait_unit: z.enum(["hours", "days", "weeks"]),
        message: z.string(),
      })).optional(),
    })).optional().describe("Message variants for A/B testing (max 5)"),
    lead_source_ids: z.array(z.string()).describe("Lead source IDs to target"),
    account_ids: z.array(z.string()).optional().describe("Account IDs to send from"),
    followups: z.array(z.object({ wait_time: z.number(), wait_unit: z.enum(["hours", "days", "weeks"]), message: z.string() })).optional(),
    max_leads: z.number().optional().describe("Max leads to target (max 25,000)"),
    enable_follow: z.boolean().optional(),
    enable_like: z.boolean().optional(),
    enable_comment: z.boolean().optional(),
    comment_template: z.string().optional(),
  }, async (args) => {
    const data = await call("POST", "/campaigns", { ...args });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("list_campaigns", "List campaigns with basic stats", {
    limit: z.number().optional(),
    offset: z.number().optional(),
  }, async ({ limit, offset }) => {
    const data = await call("GET", "/campaigns", null, { limit, offset });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("get_campaign_detail", "Get detailed info for a specific campaign.", {
    campaign_id: z.string().describe("The campaign UUID"),
  }, async ({ campaign_id }) => {
    const data = await call("GET", `/campaigns/${campaign_id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("get_campaign_analytics", "Get detailed campaign analytics with optional date range filtering.", {
    campaign_name: z.string().optional().describe("Filter to a specific campaign"),
    account_id: z.string().optional().describe("Filter to a specific account"),
    start_date: z.string().optional().describe("ISO 8601 start date"),
    end_date: z.string().optional().describe("ISO 8601 end date"),
  }, async ({ campaign_name, account_id, start_date, end_date }) => {
    const data = await call("GET", "/campaigns/analytics", null, { campaign_name, account_id, start_date, end_date });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // ─── CONVERSATIONS ─────────────────────────────────────────────────────────

  server.tool("fetch_conversations", "Fetch conversations with optional filters.", {
    conversation_id: z.string().optional().describe("Get a single conversation with all messages"),
    account_id: z.string().optional().describe("Filter by Twitter account"),
    handle: z.string().optional().describe("Filter by receiver handle"),
    limit: z.number().optional().describe("Results per page (max 100)"),
    cursor: z.string().optional().describe("Pagination cursor"),
    offset: z.number().optional().describe("Pagination offset"),
    include_messages: z.boolean().optional().describe("Include full message history"),
  }, async ({ conversation_id, account_id, handle, limit, cursor, offset, include_messages }) => {
    const data = await call("GET", "/conversations", null, { conversation_id, account_id, handle, limit, cursor, offset, include_messages });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("send_dm", "Send a direct message to an existing conversation", {
    conversation_id: z.string().describe("The conversation ID"),
    message: z.string().describe("Message text (max 10,000 chars)"),
    account_id: z.string().describe("Twitter account ID to send from"),
  }, async ({ conversation_id, message, account_id }) => {
    const data = await call("POST", "/dm/send", { conversation_id, message, account_id });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // ─── CRM ───────────────────────────────────────────────────────────────────

  server.tool("get_crm_data", "Get conversations organized by CRM tags.", {
    tag: z.string().optional().describe("Filter to a specific tag"),
    limit: z.number().optional().describe("Results per page (max 500, default 20)"),
    page: z.number().optional().describe("Page number (default 1)"),
    include_messages: z.boolean().optional().describe("Include full message history"),
  }, async ({ tag, limit, page, include_messages }) => {
    const data = await call("GET", "/crm/conversations", null, { tag, limit, page, include_messages });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("update_crm", "Update CRM data for a conversation", {
    conversation_id: z.string().describe("The conversation ID"),
    account_handle: z.string().describe("The account handle"),
    notes: z.string().optional(),
    deal_value: z.number().optional(),
    deal_currency: z.string().optional(),
    tag: z.string().nullable().optional(),
  }, async ({ conversation_id, account_handle, notes, deal_value, deal_currency, tag }) => {
    const body = { conversation_id, account_handle };
    if (notes !== undefined) body.notes = notes;
    if (deal_value !== undefined) body.deal_value = deal_value;
    if (deal_currency !== undefined) body.deal_currency = deal_currency;
    if (tag !== undefined) body.tag = tag;
    const data = await call("PATCH", "/crm/update", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // ─── WEBHOOKS ──────────────────────────────────────────────────────────────

  server.tool("get_webhook_info", "Get documentation for webhook events and payload structure.", {}, async () => {
    const info = {
      description: "Webhooks send real-time POST requests when events occur.",
      events: { new_reply: "First reply from prospect.", reply_back_and_forth: "Follow-up reply.", account_paused: "Account disconnected." },
      configuration: "Configure webhook URLs in Settings.",
    };
    return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
  });

  // ─── ENRICHMENT ────────────────────────────────────────────────────────────

  server.tool("enrich_twitter", "Find a person's Twitter/X profile from their name and company.", {
    firstName: z.string().describe("Person's first name"),
    lastName: z.string().describe("Person's last name"),
    companyName: z.string().describe("Person's company name"),
  }, async ({ firstName, lastName, companyName }) => {
    const data = await call("POST", "/enrich/twitter", { firstName, lastName, companyName });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("enrich_email", "Find a person's email from their Twitter/X handle.", {
    handle: z.string().describe("Twitter/X handle (e.g. 'elonmusk' or '@elonmusk')"),
  }, async ({ handle }) => {
    const data = await call("POST", "/enrich/email", { handle });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("get_enrichment_credits", "Check your enrichment credit balance.", {}, async () => {
    const data = await call("GET", "/enrichment/credits");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // ─── SCHEDULED TWEETS ──────────────────────────────────────────────────────

  server.tool("schedule_tweet", "Schedule a tweet to be posted at a specific time", {
    account_id: z.string().describe("The account UUID to post from"),
    tweet_text: z.string().describe("Tweet content"),
    scheduled_at: z.string().describe("ISO 8601 timestamp (must be in the future)"),
  }, async ({ account_id, tweet_text, scheduled_at }) => {
    const data = await call("POST", "/scheduled-tweets", { account_id, tweet_text, scheduled_at });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("list_scheduled_tweets", "List scheduled tweets with optional filters", {
    account_id: z.string().optional(),
    status: z.enum(["pending", "posted", "failed"]).optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  }, async ({ account_id, status, limit, offset }) => {
    const data = await call("GET", "/scheduled-tweets", null, { account_id, status, limit, offset });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("cancel_scheduled_tweet", "Cancel a pending scheduled tweet", {
    tweet_id: z.string().describe("The scheduled tweet UUID to cancel"),
  }, async ({ tweet_id }) => {
    const data = await call("DELETE", "/scheduled-tweets", { tweet_id });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });
}

// ─── Stdio Mode (npx scrapely-mcp) ─────────────────────────────────────────

async function startStdio() {
  const apiKey = process.env.SCRAPELY_API_KEY;
  const server = new McpServer({ name: "Scrapely", version: "1.5.0" });
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
  function tooManyRequests(res) {
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
      if (rateLimit(getIP(req), "register", 20, 60000)) return tooManyRequests(res);

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

      res.writeHead(302, { Location: consentUrl.toString() });
      res.end();
      return;
    }

    // ─── Token Endpoint ──────────────────────────────────────────────────
    // Exchange auth code for access token. Codes are stored in Supabase
    // by the Scrapely app's /api/oauth/authorize endpoint.
    if (pathname === "/token" && req.method === "POST") {
      // Rate limit: 30 token requests per IP per minute
      if (rateLimit(getIP(req), "token", 30, 60000)) return tooManyRequests(res);

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
    const mcpServer = new McpServer({ name: "Scrapely", version: "1.5.0" });
    registerTools(mcpServer, () => apiKey);

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
