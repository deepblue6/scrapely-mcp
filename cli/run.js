// Running a registry tool, and the raw `scrapely api` escape hatch.

import { readFileSync } from "node:fs";
import { apiCall } from "../api.js";
import { parseFlags, parseToolArgs } from "./args.js";
import { resolveApiKey } from "./config.js";
import { CliError, UsageError } from "./errors.js";
import { printResult } from "./output.js";
import { confirm, readStdin } from "./prompt.js";
import { commandName } from "./registry.js";
import { colors, truncate } from "./style.js";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function requireKey() {
  const active = resolveApiKey();
  if (!active) throw new CliError("Not logged in. Run: scrapely login (or set SCRAPELY_API_KEY)");
  return active.key;
}

// name="Launch", lead_source_ids=[2 items]: what the confirmation shows.
function summarizeArgs(args) {
  return Object.entries(args).map(([key, value]) => {
    if (Array.isArray(value)) return `${key}=[${value.length} item${value.length === 1 ? "" : "s"}]`;
    if (value && typeof value === "object") return `${key}={...}`;
    return `${key}=${truncate(JSON.stringify(value), 40)}`;
  }).join(", ");
}

export async function runTool(tool, argv) {
  const name = commandName(tool);
  const { args, globals } = await parseToolArgs(tool, argv, name);
  const key = requireKey();

  if (tool.destructive) {
    const c = colors(process.stderr);
    const details = summarizeArgs(args);
    const summary = `${c.yellow("About to run")} ${c.bold(`scrapely ${name}`)}: ${tool.description.split(/(?<=\.)\s+(?=[A-Z])/)[0]}` +
      (details ? `\n  ${details}` : "");
    await confirm(summary, { yes: globals.yes, commandName: name });
  }

  const data = await tool.run(args, (method, path, body, query) => apiCall(key, method, path, body, query));
  printResult(data, globals);

  // Chunked tools (imports, add-leads) report a mid-way failure inside the result instead of throwing.
  if (data && typeof data === "object" && typeof data.error === "string") process.exitCode = 1;
}

function parseQuery(pairs) {
  const query = {};
  for (const pair of pairs || []) {
    const eq = pair.indexOf("=");
    if (eq < 1) throw new UsageError(`--query must look like key=value (got "${pair}").`, "api");
    query[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return query;
}

async function parseData(raw) {
  if (raw === undefined) return null;
  let text = raw;
  if (raw === "-") text = await readStdin();
  else if (raw.startsWith("@")) {
    try {
      text = readFileSync(raw.slice(1), "utf8");
    } catch (err) {
      throw new UsageError(`--data: couldn't read ${raw.slice(1)} (${err.code || err.message}).`, "api");
    }
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UsageError(`--data must be JSON: ${err.message}`, "api");
  }
}

export async function runApi(argv) {
  const { values, positionals } = parseFlags(argv, {
    data: { type: "string" },
    query: { type: "string", multiple: true },
    yes: { type: "boolean", short: "y" },
    json: { type: "boolean" },
    debug: { type: "boolean" },
  }, "api");

  const [rawMethod, rawPath, ...extra] = positionals;
  if (!rawMethod || !rawPath) throw new UsageError("Usage: scrapely api <METHOD> <path>", "api");
  if (extra.length) throw new UsageError(`Unexpected argument "${extra[0]}".`, "api");

  const method = rawMethod.toUpperCase();
  if (!METHODS.includes(method)) throw new UsageError(`Method must be one of: ${METHODS.join(", ")} (got "${rawMethod}").`, "api");

  // Accept "campaigns", "/campaigns" or a pasted "/api/v1/campaigns".
  const path = "/" + rawPath.replace(/^\/+/, "").replace(/^api\/v1\//, "");
  const body = await parseData(values.data);
  if (body !== null && method === "GET") throw new UsageError("GET requests can't have --data. Use --query instead.", "api");
  const query = parseQuery(values.query);

  const key = requireKey();
  if (method !== "GET") {
    await confirm(`${colors(process.stderr).yellow("About to send")} ${method} ${path}`, { yes: values.yes, commandName: "api" });
  }

  const data = await apiCall(key, method, path, body, query);
  printResult(data, { json: true });
}
