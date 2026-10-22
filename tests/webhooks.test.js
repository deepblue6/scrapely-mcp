// `scrapely webhooks ...` against the local mock API: requests sent, confirmations, key handling.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GOOD_KEY, startMockApi } from "./helpers/mock-api.js";
import { runCli } from "./helpers/run-cli.js";

const LONG_URL = "https://hooks.example.com/scrapely/a-very-long-path-that-should-never-be-cut/abcdef0123456789";
const SECRET = "my-super-secret-webhook-key-123";
const GENERATED = "whk_Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo";

let api;
before(async () => {
  api = await startMockApi({
    "GET /webhooks": {
      enabled: true,
      all_replies: false,
      webhooks: [
        { url: LONG_URL, has_key: true, key_preview: "…k123" },
        { url: "https://93.184.215.14/hook", has_key: false, key_preview: null },
      ],
      events: [{ event: "new_reply", description: "First reply from a lead" }],
    },
    "POST /webhooks": ({ body }) => ({
      status: 201,
      body: {
        success: true,
        webhook: { url: body.url, has_key: Boolean(body.key || body.generate_key), key_preview: body.generate_key ? "…hij" : null },
        ...(body.generate_key ? { key: GENERATED } : {}),
      },
    }),
    "PATCH /webhooks": ({ body }) => ({
      body: { success: true, webhook: { url: body.url, has_key: !body.remove_key, key_preview: body.remove_key ? null : "…0000" } },
    }),
    "DELETE /webhooks": { success: true, message: "Webhook removed" },
    "PATCH /webhooks/settings": ({ body }) => ({ body: { enabled: body.enabled ?? true, all_replies: body.all_replies ?? false, webhooks: [], events: [] } }),
    "POST /webhooks/test": { results: [{ url: "https://93.184.215.14/hook", ok: true, status: 200 }] },
  });
});
after(() => api.close());

const cli = (args, options = {}) =>
  runCli(args, { base: api.base, ...options, env: { SCRAPELY_API_KEY: GOOD_KEY, COLUMNS: "80", ...options.env } });
const sentTo = (method, path) => api.requests.filter((r) => r.method === method && r.path === path);
const count = (text, part) => text.split(part).length - 1;

test("webhooks list: settings first, then URL and KEY columns, URLs never cut", async () => {
  const { code, stdout } = await cli(["webhooks", "list"]);
  assert.equal(code, 0);
  assert.equal(sentTo("GET", "/webhooks").length, 1);
  assert.match(stdout, /^enabled\s+yes$/m);
  assert.match(stdout, /^all_replies\s+no$/m);
  assert.match(stdout, /^ {2}URL\s+KEY$/m);
  assert.ok(stdout.includes(LONG_URL), "full URL even on a narrow terminal");
  assert.match(stdout, /…k123/);
  assert.match(stdout, /93\.184\.215\.14\/hook\s+none/);
  assert.doesNotMatch(stdout, /HAS KEY/);
  assert.match(stdout, /new_reply/);
});

test("webhooks add sends the URL and key, without asking first", async () => {
  const { code, stderr } = await cli(["webhooks", "add", "--url", "https://93.184.215.14/hook", "--key", SECRET]);
  assert.equal(code, 0);
  assert.doesNotMatch(stderr, /About to run/);
  assert.deepEqual(sentTo("POST", "/webhooks").at(-1).body, { url: "https://93.184.215.14/hook", key: SECRET });
});

test("webhooks add --generate-key prints the new key once, with a save-it-now note", async () => {
  const { code, stdout, stderr } = await cli(["webhooks", "add", "--url", "https://93.184.215.14/new", "--generate-key"]);
  assert.equal(code, 0);
  assert.deepEqual(sentTo("POST", "/webhooks").at(-1).body, { url: "https://93.184.215.14/new", generate_key: true });
  assert.match(stdout, new RegExp(`^key\\s+${GENERATED}$`, "m"));
  assert.equal(count(stdout + stderr, GENERATED), 1, "shown exactly once");
  assert.match(stderr, /Save this key now: Scrapely won't show it again/);

  const json = await cli(["webhooks", "add", "--url", "https://93.184.215.14/new2", "--generate-key", "--json"]);
  assert.equal(JSON.parse(json.stdout).key, GENERATED, "--json output stays valid JSON");
  assert.match(json.stderr, /Save this key now/);
});

test("webhooks add without a generated key has no save-it note", async () => {
  const { stderr } = await cli(["webhooks", "add", "--url", "https://93.184.215.14/plain"]);
  assert.doesNotMatch(stderr, /Save this key/);
  assert.deepEqual(sentTo("POST", "/webhooks").at(-1).body, { url: "https://93.184.215.14/plain" });
});

test("webhooks add refuses --key together with --generate-key", async () => {
  const before = sentTo("POST", "/webhooks").length;
  const { code, stderr } = await cli(["webhooks", "add", "--url", "https://x.example", "--key", "a", "--generate-key"]);
  assert.equal(code, 2);
  assert.match(stderr, /Pass --key or --generate-key, not both/);
  assert.equal(sentTo("POST", "/webhooks").length, before);
});

test("webhooks set-key asks first and never echoes the key", async () => {
  const { code, stderr } = await cli(["webhooks", "set-key", "--url", LONG_URL, "--key", SECRET]);
  assert.equal(code, 2);
  assert.match(stderr, /About to run scrapely webhooks set-key/);
  assert.match(stderr, /--key \*\*\*\*/);
  assert.ok(!stderr.includes(SECRET), "the secret is not printed");
  assert.equal(sentTo("PATCH", "/webhooks").length, 0, "nothing was sent");

  const yes = await cli(["webhooks", "set-key", "--url", LONG_URL, "--key", SECRET, "--yes"]);
  assert.equal(yes.code, 0);
  assert.ok(!(yes.stdout + yes.stderr).includes(SECRET));
  assert.deepEqual(sentTo("PATCH", "/webhooks").at(-1).body, { url: LONG_URL, key: SECRET });
});

test("webhooks set-key can generate or remove the key", async () => {
  await cli(["webhooks", "set-key", "--url", LONG_URL, "--remove-key", "--yes"]);
  assert.deepEqual(sentTo("PATCH", "/webhooks").at(-1).body, { url: LONG_URL, remove_key: true });
  await cli(["webhooks", "set-key", "--url", LONG_URL, "--generate-key", "--yes"]);
  assert.deepEqual(sentTo("PATCH", "/webhooks").at(-1).body, { url: LONG_URL, generate_key: true });
});

test("webhooks set-key needs exactly one of --key, --generate-key, --remove-key", async () => {
  const before = sentTo("PATCH", "/webhooks").length;
  for (const extra of [[], ["--key", "a", "--remove-key"], ["--generate-key", "--remove-key"]]) {
    const { code, stderr } = await cli(["webhooks", "set-key", "--url", LONG_URL, ...extra, "--yes"]);
    assert.equal(code, 2);
    assert.match(stderr, /Pass exactly one of --key, --generate-key or --remove-key/);
  }
  assert.equal(sentTo("PATCH", "/webhooks").length, before);
});

test("webhooks remove asks first, then sends DELETE with the URL", async () => {
  const refused = await cli(["webhooks", "remove", "--url", LONG_URL]);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /About to run scrapely webhooks remove/);
  assert.equal(sentTo("DELETE", "/webhooks").length, 0);

  const { code, stdout } = await cli(["webhooks", "remove", "--url", LONG_URL, "--yes"]);
  assert.equal(code, 0);
  assert.match(stdout, /Webhook removed/);
  assert.deepEqual(sentTo("DELETE", "/webhooks").at(-1).body, { url: LONG_URL });
});

test("webhooks settings asks first and sends only the switches given", async () => {
  const refused = await cli(["webhooks", "settings", "--no-enabled"]);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /About to run scrapely webhooks settings/);
  assert.match(refused.stderr, /--no-enabled/);
  assert.equal(sentTo("PATCH", "/webhooks/settings").length, 0);

  const { code } = await cli(["webhooks", "settings", "--no-enabled", "--yes"]);
  assert.equal(code, 0);
  assert.deepEqual(sentTo("PATCH", "/webhooks/settings").at(-1).body, { enabled: false });
  await cli(["webhooks", "settings", "--all-replies", "--yes"]);
  assert.deepEqual(sentTo("PATCH", "/webhooks/settings").at(-1).body, { all_replies: true });

  const empty = await cli(["webhooks", "settings", "--yes"]);
  assert.equal(empty.code, 2);
  assert.match(empty.stderr, /Pass --enabled\/--no-enabled or --all-replies\/--no-all-replies/);
});

test("webhooks test sends to all URLs, or just the one given", async () => {
  const all = await cli(["webhooks", "test"]);
  assert.equal(all.code, 0);
  assert.doesNotMatch(all.stderr, /About to run/);
  assert.deepEqual(sentTo("POST", "/webhooks/test").at(-1).body, {});
  assert.match(all.stdout, /93\.184\.215\.14\/hook/);

  await cli(["webhooks", "test", "--url", "https://93.184.215.14/hook"]);
  assert.deepEqual(sentTo("POST", "/webhooks/test").at(-1).body, { url: "https://93.184.215.14/hook" });
});

test("webhook URL flags say where to find the URL", async () => {
  for (const action of ["set-key", "remove", "test"]) {
    const { stdout } = await cli(["webhooks", action, "--help"]);
    assert.match(stdout, /--url <text>\s+The webhook URL exactly as scrapely webhooks list shows\s+it/, action);
  }
  const media = await cli(["media", "upload", "--help"]);
  assert.doesNotMatch(media.stdout, /webhooks list/, "other --url flags are untouched");
});
