// A local stand-in for the Scrapely API. Tests never touch the real one.

import { createServer } from "node:http";

export const GOOD_KEY = "sk_live_test1234567890abcd";

const FIXTURES = {
  "GET /accounts": {
    accounts: [
      { id: "acc-1", handle: "acme_sales", name: "Acme Sales", is_paused: false, warmup_paused: true, dms_sent: 120, tags: ["main"], cookies: [] },
      { id: "acc-2", handle: "acme_founder", name: "Acme Founder", is_paused: true, warmup_paused: false, dms_sent: 4500, tags: [], cookies: [] },
    ],
  },
  "GET /campaigns": {
    campaigns: [
      { name: "October launch", total: 200, completed: 150, pending: 50, replies: 12, progress: 75, is_paused: false },
    ],
    pagination: { limit: 20, offset: 0, count: 1, total: 1 },
  },
};

// routes: { "METHOD /path": body | (req) => ({ status, body }) } override the fixtures.
export function startMockApi(routes = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const url = new URL(req.url, "http://localhost");
      const path = url.pathname.replace(/^\/api\/v1/, "");
      const record = {
        method: req.method,
        path,
        query: Object.fromEntries(url.searchParams),
        body: raw ? JSON.parse(raw) : null,
        key: req.headers["x-api-key"],
      };
      requests.push(record);

      const send = (status, body) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(typeof body === "string" ? body : JSON.stringify(body));
      };

      if (record.key !== GOOD_KEY) return send(401, { error: "Unauthorized", message: "Invalid API key" });

      const route = routes[`${req.method} ${path}`] ?? FIXTURES[`${req.method} ${path}`];
      if (route === undefined) return send(404, { error: "Not found", message: `No route ${req.method} ${path}` });
      if (typeof route === "function") {
        const { status = 200, body } = route(record);
        return send(status, body);
      }
      send(200, route);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const base = `http://127.0.0.1:${server.address().port}/api/v1`;
      resolve({ base, requests, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
