// Running a registry tool, and the raw `scrapely api` escape hatch.

import { readFileSync } from "node:fs";
import { ApiError, apiCall, apiUrl } from "../api.js";
import { parseFlags, parseToolArgs } from "./args.js";
import { requireKey } from "./auth.js";
import { describeActive } from "./config.js";
import { UsageError } from "./errors.js";
import { printResult } from "./output.js";
import { confirm, readStdin } from "./prompt.js";
import { commandName } from "./registry.js";
import { describeInputs } from "./schema.js";
import { colors, stripControl, truncate } from "./style.js";
import { cliText } from "./wording.js";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const isPlainWord = (text) => /^[\w@.:/+-]+$/.test(text);

// --name "October launch"  --lead-source-ids a1,b2  --leads [120 items]: what the confirmation shows.
function summarizeArgs(args, tool) {
  const flagFor = Object.fromEntries(describeInputs(tool.inputs).map((f) => [f.key, f.flag]));
  return Object.entries(args).map(([key, value]) => {
    const flag = `--${flagFor[key] || key}`;
    if (typeof value === "boolean") return value ? flag : flag.replace(/^--/, "--no-");
    if (value === null) return flag.replace(/^--/, "--no-");
    if (Array.isArray(value)) {
      const joined = value.every((v) => typeof v !== "object") ? value.join(",") : "";
      if (joined && joined.length <= 40) return `${flag} ${isPlainWord(joined) ? joined : JSON.stringify(joined)}`;
      return `${flag} [${value.length} item${value.length === 1 ? "" : "s"}]`;
    }
    if (typeof value === "object") return `${flag} {...}`;
    const text = truncate(stripControl(String(value)).replace(/\s+/g, " "), 40);
    return `${flag} ${isPlainWord(text) ? text : JSON.stringify(text)}`;
  }).join("  ");
}

// apiCall with the active key. A failed call remembers which key it used, so the
// error can say how to fix that key (saved profile vs SCRAPELY_API_KEY).
function caller(active) {
  return async (method, path, body, query) => {
    try {
      return await apiCall(active.key, method, path, body, query);
    } catch (err) {
      if (err instanceof ApiError) err.active = active;
      throw err;
    }
  };
}

export async function runTool(tool, argv, { profile } = {}) {
  const name = commandName(tool);
  const { args, globals } = await parseToolArgs(tool, argv, name);
  const active = requireKey(profile);

  if (tool.destructive) {
    const c = colors(process.stderr);
    const details = summarizeArgs(args, tool);
    const what = cliText(tool.description.split(/(?<=\.)\s+(?=[A-Z])/)[0]);
    const summary = `${c.yellow("About to run")} ${c.bold(`scrapely ${name}`)}: ${what}` +
      (details ? `\n  ${details}` : "") + `\n  ${describeActive(active)}`;
    await confirm(summary, { yes: globals.yes, commandName: name });
  }

  const data = await tool.run(args, caller(active));
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

export async function runApi(argv, { profile } = {}) {
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

  // Accept "campaigns", "/campaigns" or a pasted "/api/v1/campaigns", with or without "?a=b".
  const [rawPathname, rawSearch = ""] = rawPath.split(/\?(.*)/s);
  const path = "/" + rawPathname.replace(/^\/+/, "").replace(/^api\/v1\//, "");
  try {
    apiUrl(path);
  } catch (err) {
    throw new UsageError(`${err.message}.`, "api");
  }
  const body = await parseData(values.data);
  if (body !== null && method === "GET") throw new UsageError("GET requests can't have --data. Use --query instead.", "api");
  const query = { ...Object.fromEntries(new URLSearchParams(rawSearch)), ...parseQuery(values.query) };

  const active = requireKey(profile);
  if (method !== "GET") {
    const summary = `${colors(process.stderr).yellow("About to send")} ${method} ${path}\n  ${describeActive(active)}`;
    await confirm(summary, { yes: values.yes, commandName: "api" });
  }

  const data = await caller(active)(method, path, body, query);
  printResult(data, { json: true });
}
