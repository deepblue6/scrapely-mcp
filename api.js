// Thin client for the Scrapely REST API, shared by the MCP server and the CLI.

export const DEFAULT_API_BASE = "https://app.scrapely.co/api/v1";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

// SCRAPELY_API_BASE exists only so tests can point at a local mock server.
// Anything other than localhost is ignored, so a stray setting can't send API keys elsewhere.
function pickApiBase(value) {
  if (!value) return DEFAULT_API_BASE;
  try {
    if (LOOPBACK_HOSTS.includes(new URL(value).hostname)) return value.replace(/\/+$/, "");
  } catch {
    // not a URL: fall through to the warning
  }
  process.stderr.write(`Warning: ignoring SCRAPELY_API_BASE=${value} (only localhost is allowed, for testing). Using ${DEFAULT_API_BASE}\n`);
  return DEFAULT_API_BASE;
}

export const API_BASE = pickApiBase(process.env.SCRAPELY_API_BASE);

const { origin: API_ORIGIN, pathname: API_PATH } = new URL(API_BASE);
const MAX_REDIRECTS = 5;
const MAX_ERROR_TEXT = 200;

// Carries the HTTP status and parsed body so callers can react to them.
// The message keeps the "API Error <status>: <message>" format agents already see.
export class ApiError extends Error {
  constructor(status, data, message) {
    super(`API Error ${status}: ${message}`);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

// The full URL for an API path. Throws if the path ("../..", "%2e%2e") would leave /api/v1.
export function apiUrl(path) {
  const url = new URL(API_BASE + path);
  if (url.origin !== API_ORIGIN || !`${url.pathname}/`.startsWith(`${API_PATH}/`)) {
    throw new Error(`Refusing to call ${url.pathname}: it is outside the Scrapely API (${API_PATH})`);
  }
  return url;
}

// Parse JSON when we can; otherwise keep the raw text (e.g. an HTML error page from a proxy).
function parseBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(data, res) {
  if (data && typeof data === "object") {
    return data.message || data.error || JSON.stringify(data);
  }
  // A proxy's HTML page can be kilobytes long: keep a short, single-line excerpt (err.data has it all).
  const text = String(data || "").replace(/\s+/g, " ").trim();
  if (text.length > MAX_ERROR_TEXT) return text.slice(0, MAX_ERROR_TEXT) + "…";
  return text || res.statusText || "Unknown error";
}

// fetch, following redirects only within the Scrapely API's own origin.
// fetch would otherwise forward the X-API-Key header to whatever host a redirect points at.
async function send(url, options) {
  for (let hops = 0; ; hops++) {
    const res = await fetch(url, { ...options, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;

    const next = new URL(location, url);
    if (next.origin !== API_ORIGIN || hops >= MAX_REDIRECTS) {
      await res.body?.cancel();
      throw new ApiError(res.status, null, `Redirect to ${next.origin}${next.pathname} was not followed`);
    }
    await res.body?.cancel();
    url = next;
  }
}

export async function apiCall(apiKey, method, path, body = null, queryParams = null) {
  const url = apiUrl(path);

  if (queryParams) {
    const filtered = Object.fromEntries(
      Object.entries(queryParams).filter(([, v]) => v !== undefined && v !== null)
    );
    const qs = new URLSearchParams(filtered).toString();
    if (qs) url.search = qs;
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

  const res = await send(url, options);
  const text = await res.text();

  if (!res.ok) {
    const data = parseBody(text);
    throw new ApiError(res.status, data, errorMessage(data, res));
  }

  // A success must be JSON: an empty body or an HTML page here is a failure, not a result.
  return JSON.parse(text);
}
