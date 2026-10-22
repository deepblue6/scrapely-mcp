// Thin client for the Scrapely REST API, shared by the MCP server and the CLI.

// SCRAPELY_API_BASE exists only so tests can point at a local mock server.
export const API_BASE = process.env.SCRAPELY_API_BASE || "https://app.scrapely.co/api/v1";

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
  return data || res.statusText || "Unknown error";
}

export async function apiCall(apiKey, method, path, body = null, queryParams = null) {
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
  const text = await res.text();

  if (!res.ok) {
    const data = parseBody(text);
    throw new ApiError(res.status, data, errorMessage(data, res));
  }

  // A success must be JSON: an empty body or an HTML page here is a failure, not a result.
  return JSON.parse(text);
}
