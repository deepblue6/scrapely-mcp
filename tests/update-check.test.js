// "Update available" notice: shown on stderr when npm has a newer version, checked once a day, never breaks a command.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { runCli, tempHome } from "./helpers/run-cli.js";
import { isNewer } from "../cli/update-check.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// A stand-in for registry.npmjs.org/scrapely-mcp/latest; `latest` is changed per test.
let latest = "99.0.0";
let hits = 0;
let registry;
before(async () => {
  const server = createServer((req, res) => {
    hits++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ name: "scrapely-mcp", version: latest }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  registry = { url: `http://127.0.0.1:${server.address().port}/scrapely-mcp/latest`, close: () => new Promise((r) => server.close(r)) };
});
after(() => registry.close());

const withRegistry = (args, home, env = {}) => runCli(args, { home, env: { SCRAPELY_UPDATE_URL: registry.url, ...env } });

test("isNewer compares x.y.z and never offers pre-releases", () => {
  assert.equal(isNewer("1.17.0", "1.16.0"), true);
  assert.equal(isNewer("1.16.10", "1.16.9"), true);
  assert.equal(isNewer("2.0.0", "1.99.99"), true);
  assert.equal(isNewer("1.16.0", "1.16.0"), false);
  assert.equal(isNewer("1.15.9", "1.16.0"), false);
  assert.equal(isNewer("1.17.0-beta.1", "1.16.0"), false);
  assert.equal(isNewer(undefined, "1.16.0"), false);
});

test("a newer version prints the notice on stderr only, and stdout stays clean", async () => {
  latest = "99.0.0";
  const { code, stdout, stderr } = await withRegistry(["--version"], tempHome());
  assert.equal(code, 0);
  assert.equal(stdout.trim(), version);
  assert.match(stderr, new RegExp(`Update available: Scrapely CLI 99\\.0\\.0 \\(you have ${version.replace(/\./g, "\\.")}\\)`));
  assert.match(stderr, /npm install -g scrapely-mcp, then scrapely setup-agent/);
});

test("checks npm at most once a day, and keeps showing the notice from the saved answer", async () => {
  latest = "99.0.0";
  const home = tempHome();
  const before = hits;
  await withRegistry(["--version"], home);
  const second = await withRegistry(["--version"], home);
  assert.equal(hits - before, 1);
  assert.match(second.stderr, /Update available/);
});

test("no notice when already on the latest version", async () => {
  latest = version;
  const { stderr } = await withRegistry(["--version"], tempHome());
  assert.doesNotMatch(stderr, /Update available/);
});

test("an unreachable registry is ignored: no notice, no error, exit 0", async () => {
  const { code, stdout, stderr } = await runCli(["--version"], { env: { SCRAPELY_UPDATE_URL: "http://127.0.0.1:9/never" } });
  assert.equal(code, 0);
  assert.equal(stdout.trim(), version);
  assert.equal(stderr, "");
});

test("SCRAPELY_NO_UPDATE_CHECK and CI turn it off without asking npm", async () => {
  latest = "99.0.0";
  for (const env of [{ SCRAPELY_NO_UPDATE_CHECK: "1" }, { CI: "true" }]) {
    const before = hits;
    const { stderr } = await withRegistry(["--version"], tempHome(), env);
    assert.equal(hits, before);
    assert.doesNotMatch(stderr, /Update available/);
  }
});

test("the notice also follows a failed command, after its error", async () => {
  latest = "99.0.0";
  const { code, stderr } = await withRegistry(["nosuchcommand"], tempHome());
  assert.equal(code, 2);
  assert.ok(stderr.indexOf("Error:") < stderr.indexOf("Update available"));
});
