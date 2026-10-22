// The shared API client (api.js) against local servers only.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const seen = [];
let api;
let other;
let apiCall;
let ApiError;

before(async () => {
  other = await listen((req, res) => {
    seen.push({ host: "other", url: req.url, key: req.headers["x-api-key"] });
    res.end("{}");
  });
  api = await listen((req, res) => {
    seen.push({ host: "api", url: req.url, key: req.headers["x-api-key"] });
    const otherBase = `http://127.0.0.1:${other.address().port}`;
    if (req.url === "/api/v1/away") return res.writeHead(302, { Location: `${otherBase}/steal` }).end();
    if (req.url === "/api/v1/moved") return res.writeHead(308, { Location: "/api/v1/ok" }).end();
    if (req.url === "/api/v1/html") return res.writeHead(502, { "Content-Type": "text/html" }).end(`<html>\n  ${"Bad gateway ".repeat(100)}</html>`);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, url: req.url }));
  });
  process.env.SCRAPELY_API_BASE = `http://127.0.0.1:${api.address().port}/api/v1`;
  ({ apiCall, ApiError } = await import("../api.js"));
});

after(() => {
  api.close();
  other.close();
});

test("redirects within the API are followed", async () => {
  const data = await apiCall("sk_test_key", "GET", "/moved");
  assert.equal(data.url, "/api/v1/ok");
});

test("redirects to another host are refused and never get the key", async () => {
  await assert.rejects(apiCall("sk_test_key", "GET", "/away"), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 302);
    assert.match(err.message, /^API Error 302: Redirect to http:\/\/127\.0\.0\.1:\d+\/steal was not followed$/);
    return true;
  });
  assert.equal(seen.filter((r) => r.host === "other").length, 0);
});

test("paths can't climb out of /api/v1", async () => {
  for (const path of ["/../../away", "/%2e%2e/%2e%2e/x", "@evil.example/x"]) {
    await assert.rejects(apiCall("sk_test_key", "GET", path), /outside the Scrapely API/, path);
  }
  assert.ok(!seen.some((r) => !r.url.startsWith("/api/v1/")));
});

test("query parameters skip empty values", async () => {
  const data = await apiCall("sk_test_key", "GET", "/campaigns", null, { limit: 5, offset: undefined, tag: null });
  assert.equal(data.url, "/api/v1/campaigns?limit=5");
});
