// End-to-end: the real `scrapely` binary against a local mock API.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GOOD_KEY, startMockApi } from "./helpers/mock-api.js";
import { runCli, tempHome } from "./helpers/run-cli.js";

let api;
before(async () => {
  api = await startMockApi({
    "POST /campaigns/pause": { success: true, message: "Campaign paused" },
    "POST /dm/send": { success: true },
    "POST /people/search": { count: 42 },
    "GET /campaigns/analytics": () => ({ status: 503, body: { error: "Service unavailable" } }),
    "GET /people/credits": () => ({ status: 429, body: { error: "Too many requests" } }),
  });
});
after(() => api.close());

const auth = { SCRAPELY_API_KEY: GOOD_KEY };
const cli = (args, options = {}) => runCli(args, { base: api.base, ...options, env: { ...auth, ...options.env } });
const sentTo = (method, path) => api.requests.filter((r) => r.method === method && r.path === path);
const ANSI = /\x1b\[/;

test("--help lists groups and the getting-started commands", async () => {
  const { code, stdout } = await cli(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /scrapely <group> <command>/);
  for (const group of ["accounts", "campaigns", "listeners", "people"]) assert.match(stdout, new RegExp(`\\n  ${group}\\s`));
  assert.match(stdout, /login/);
  assert.doesNotMatch(stdout, ANSI, "no colors when piped");
});

test("group --help lists its commands and marks the ones that ask first", async () => {
  const { code, stdout } = await cli(["campaigns", "--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /^ {2}list\s+List campaigns with basic stats$/m);
  assert.match(stdout, /^ {2}launch \*/m);
});

test("command --help shows required flags, enum values and an example", async () => {
  const { code, stdout } = await cli(["tweets", "list", "--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /--status <value>/);
  assert.match(stdout, /One of: pending, posted, failed/);
  assert.match(stdout, /Example\n {2}scrapely tweets list/);

  const launch = await cli(["campaigns", "launch", "--help"]);
  assert.match(launch.stdout, /Required\n {2}--name <text>/);
  assert.match(launch.stdout, /--lead-source-ids/);
  assert.match(launch.stdout, /asked to confirm/);
});

test("help speaks CLI: commands and --flags, never MCP tool names", async () => {
  const { tools } = await import("../tools.js");
  const { commands, commandName } = await import("../cli/registry.js");
  const { commandHelp } = await import("../cli/help.js");
  const toolNames = new Set(tools.map((t) => t.name));
  for (const command of commands) {
    const words = commandHelp(command).match(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g) || [];
    assert.deepEqual(words.filter((w) => toolNames.has(w)), [], `${commandName(command)} mentions an MCP tool`);
  }

  const remove = await cli(["listeners", "remove", "--help"]);
  assert.match(remove.stdout, /scrapely listeners update with --no-is-active/);
  const leads = await cli(["campaigns", "leads", "--help"]);
  assert.match(leads.stdout, /Only leads who replied \(--replied\) or didn't \(--no-replied\)/);
  const upload = await cli(["media", "upload", "--help"]);
  assert.match(upload.stdout, /exactly one of --url, --base64 or\s+--file-path/);
});

test("help says where IDs come from and fills in undescribed flags", async () => {
  const dm = await cli(["dm", "send", "--help"]);
  assert.match(dm.stdout, /--conversation-id <text>[^\n]*\n\s+Find it with: scrapely conversations list/);
  assert.match(dm.stdout, /--account-id <text>[^\n]*\n\s+Use the conversation's account_id: scrapely conversations\s+list\s+--conversation-id <id>/);
  assert.doesNotMatch(dm.stdout, /accounts list/, "replying from any account could use the wrong one");
  const create = await cli(["campaigns", "launch", "--help"]);
  assert.match(create.stdout, /Find it with: scrapely accounts list \(ID column\)/, "other commands keep the general hint");
  const launch = await cli(["campaigns", "launch", "--help"]);
  assert.match(launch.stdout, /--lead-source-ids[^\n]*\n\s+Find it with: scrapely sources list/);
  assert.match(launch.stdout, /--\[no-\]enable-follow\s+Follow each lead's profile before the DM/);
  const list = await cli(["campaigns", "list", "--help"]);
  assert.match(list.stdout, /--limit <number>\s+Max results to return/);
  const get = await cli(["campaigns", "get", "--help"]);
  assert.doesNotMatch(get.stdout, /Find it with/, "already says to use scrapely campaigns list");
  const sources = await cli(["sources", "--help"]);
  assert.match(sources.stdout, /list\s+List your lead sources \(IDs, status, lead counts\)/);
});

test("--version prints the package version", async () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const { stdout } = await cli(["--version"]);
  assert.equal(stdout.trim(), pkg.version);
});

test("accounts list prints a table by default", async () => {
  const { code, stdout } = await cli(["accounts", "list"], { env: { COLUMNS: "200" } });
  assert.equal(code, 0);
  assert.match(stdout, /^HANDLE\s+NAME\s+ID/);
  assert.match(stdout, /acme_founder\s+Acme Founder\s+acc-2/);
  assert.doesNotMatch(stdout, /cookies/, "only the chosen columns");
  assert.equal(sentTo("GET", "/accounts").at(-1).key, GOOD_KEY);
});

test("--json prints the raw response as valid JSON", async () => {
  const { code, stdout } = await cli(["accounts", "list", "--json"]);
  assert.equal(code, 0);
  const data = JSON.parse(stdout);
  assert.equal(data.accounts.length, 2);
  assert.deepEqual(data.accounts[0].cookies, []);
});

test("flags reach the API with the right types", async () => {
  await cli(["campaigns", "list", "--limit", "5", "--offset", "10"]);
  assert.deepEqual(sentTo("GET", "/campaigns").at(-1).query, { limit: "5", offset: "10" });
});

test("bad enum values exit 2 with the allowed values", async () => {
  const { code, stderr } = await cli(["tweets", "list", "--status", "sent"]);
  assert.equal(code, 2);
  assert.match(stderr, /--status must be one of: pending, posted, failed/);
  assert.match(stderr, /scrapely tweets list --help/);
});

test("destructive commands refuse to run without --yes when not in a terminal", async () => {
  const before = sentTo("POST", "/campaigns/pause").length;
  const { code, stderr } = await cli(["campaigns", "pause", "--campaign-name", "Launch", "--is-paused"]);
  assert.equal(code, 2);
  assert.match(stderr, /About to run scrapely campaigns pause/);
  assert.match(stderr, /--campaign-name Launch {2}--is-paused/);
  assert.match(stderr, /Nothing was done: this needs confirmation\. Re-run with --yes to go ahead\./);
  assert.match(stderr, /AI agents: show the lines above to the user and add --yes only after they approve/);
  assert.doesNotMatch(stderr, /--help/, "not a usage mistake, so no pointer to --help");
  assert.equal(sentTo("POST", "/campaigns/pause").length, before, "nothing was sent");
});

test("people search --count-only is free, so it runs without --yes; row searches still ask", async () => {
  const before = sentTo("POST", "/people/search").length;
  const count = await cli(["people", "search", "--bio-contains", "founder", "--count-only", "--json"]);
  assert.equal(count.code, 0);
  assert.deepEqual(JSON.parse(count.stdout), { count: 42 });
  assert.deepEqual(sentTo("POST", "/people/search").at(-1).body, { bio_contains: ["founder"], count_only: true });

  const rows = await cli(["people", "search", "--bio-contains", "founder"]);
  assert.equal(rows.code, 2);
  assert.match(rows.stderr, /needs confirmation/);
  assert.equal(sentTo("POST", "/people/search").length, before + 1, "the row search was not sent");
  const noCount = await cli(["people", "search", "--bio-contains", "founder", "--no-count-only"]);
  assert.equal(noCount.code, 2);
});

test("the confirmation shows the flags as typed", async () => {
  const { stderr } = await cli(["dm", "send", "--conversation-id", "123-456", "--message", "Hi Bob, thanks!", "--account-id", "acc-1"]);
  assert.match(stderr, /About to run scrapely dm send: Send a direct message to an existing conversation\n {2}--conversation-id 123-456 {2}--message "Hi Bob, thanks!" {2}--account-id acc-1/);
});

test("--yes runs destructive commands", async () => {
  const { code, stdout } = await cli(["campaigns", "pause", "--campaign-name", "Launch", "--is-paused", "--yes"]);
  assert.equal(code, 0);
  assert.match(stdout, /Campaign paused/);
  assert.deepEqual(sentTo("POST", "/campaigns/pause").at(-1).body, { campaign_name: "Launch", is_paused: true });
});

test("campaigns resume unpauses, and pause needs no switch", async () => {
  const resumed = await cli(["campaigns", "resume", "--campaign-name", "Launch", "--yes"]);
  assert.equal(resumed.code, 0);
  assert.deepEqual(sentTo("POST", "/campaigns/pause").at(-1).body, { campaign_name: "Launch", is_paused: false });
  const paused = await cli(["campaigns", "pause", "--campaign-name", "Launch", "--yes"]);
  assert.equal(paused.code, 0);
  assert.deepEqual(sentTo("POST", "/campaigns/pause").at(-1).body, { campaign_name: "Launch", is_paused: true });
  const help = await cli(["campaigns", "--help"]);
  assert.match(help.stdout, /^ {2}resume \*\s+Resume a paused campaign$/m);
});

test("JSON flags can be read from stdin", async () => {
  const input = JSON.stringify([{ name: "ct0", value: "v", domain: ".x.com" }]);
  const { code } = await runCli(["accounts", "update-cookies", "--account-id", "a1", "--cookies", "-"], {
    base: api.base, env: auth, input,
  });
  assert.equal(code, 1); // the mock has no route for it; we only check what was sent
  assert.deepEqual(sentTo("PUT", "/accounts/cookies").at(-1).body, { account_id: "a1", cookies: JSON.parse(input) });
});

test("401 explains how to log in", async () => {
  const { code, stderr } = await cli(["accounts", "list"], { env: { SCRAPELY_API_KEY: "sk_live_wrong0000000" } });
  assert.equal(code, 1);
  assert.match(stderr, /Scrapely rejected the key in SCRAPELY_API_KEY \(sk_live_…0000\)/);
  assert.match(stderr, /unset SCRAPELY_API_KEY/);
  assert.doesNotMatch(stderr, /sk_live_wrong/);
});

test("no key at all asks you to log in", async () => {
  const { code, stderr } = await runCli(["accounts", "list"], { base: api.base });
  assert.equal(code, 1);
  assert.match(stderr, /Not logged in\. Run: scrapely login/);
});

test("rate limits and server errors get friendly messages", async () => {
  const limited = await cli(["people", "credits"]);
  assert.equal(limited.code, 1);
  assert.match(limited.stderr, /Rate limited, try again shortly/);

  const down = await cli(["campaigns", "analytics"]);
  assert.equal(down.code, 1);
  assert.match(down.stderr, /problem on its side \(HTTP 503\)/);
  assert.doesNotMatch(down.stderr, /at .*\.js/, "no stack trace without --debug");

  const debug = await cli(["campaigns", "analytics", "--debug"]);
  assert.match(debug.stderr, /ApiError/);
  assert.match(debug.stderr, /Service unavailable/);
});

test("network failures say the API couldn't be reached", async () => {
  const { code, stderr } = await runCli(["accounts", "list"], { base: "http://127.0.0.1:59999/api/v1", env: auth });
  assert.equal(code, 1);
  assert.match(stderr, /Could not reach Scrapely/);
});

test("login validates the key, saves it with 0600 permissions and never echoes it", async () => {
  const home = tempHome();
  const { code, stdout } = await runCli(["login", "--key", GOOD_KEY], { base: api.base, home });
  assert.equal(code, 0);
  assert.match(stdout, /Logged in/);
  assert.doesNotMatch(stdout, new RegExp(GOOD_KEY));
  assert.match(stdout, /sk_live_…abcd/);

  const file = join(home, ".config", "scrapely", "config.json");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { profiles: { default: { api_key: GOOD_KEY } }, default_profile: "default" });
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);

  // The saved key is used by later commands, and whoami shows it masked.
  const list = await runCli(["accounts", "list"], { base: api.base, home });
  assert.equal(list.code, 0);
  const who = await runCli(["whoami"], { base: api.base, home });
  assert.match(who.stdout, /sk_live_…abcd/);
  assert.match(who.stdout, /config\.json/);
  assert.doesNotMatch(who.stdout, new RegExp(GOOD_KEY));

  const out = await runCli(["logout"], { base: api.base, home });
  assert.match(out.stdout, /Logged out/);
  assert.equal((await runCli(["whoami"], { base: api.base, home })).code, 1);
});

test("login reads the key from stdin and rejects a bad one without saving", async () => {
  const home = tempHome();
  const good = await runCli(["login"], { base: api.base, home, input: `${GOOD_KEY}\n` });
  assert.equal(good.code, 0);

  const other = tempHome();
  const bad = await runCli(["login", "--key", "sk_live_wrong0000000"], { base: api.base, home: other });
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /rejected that API key/);
  assert.throws(() => statSync(join(other, ".config", "scrapely", "config.json")));
});

test("api --help links the endpoint reference", async () => {
  const { stdout } = await cli(["api", "--help"]);
  assert.match(stdout, /Endpoints and their fields: https:\/\/app\.scrapely\.co\/documentation/);
});

test("api GET prints JSON", async () => {
  const { code, stdout } = await cli(["api", "GET", "/campaigns", "--query", "limit=5"]);
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).campaigns[0].name, "October launch");
  assert.deepEqual(sentTo("GET", "/campaigns").at(-1).query, { limit: "5" });
});

test("api non-GET needs confirmation, then sends the body", async () => {
  const refused = await cli(["api", "POST", "/dm/send", "--data", '{"message":"hi"}']);
  assert.equal(refused.code, 2);
  assert.equal(sentTo("POST", "/dm/send").length, 0);

  const sent = await cli(["api", "post", "dm/send", "--data", '{"message":"hi"}', "--yes"]);
  assert.equal(sent.code, 0);
  assert.deepEqual(sentTo("POST", "/dm/send").at(-1).body, { message: "hi" });
});

test("api refuses paths outside /api/v1", async () => {
  const before = api.requests.length;
  const { code, stderr } = await cli(["api", "GET", "../../redir"]);
  assert.equal(code, 2);
  assert.match(stderr, /outside the Scrapely API/);
  assert.equal(api.requests.length, before, "nothing was sent");
});

test("global flags also work before the command", async () => {
  const { code, stdout } = await cli(["--json", "campaigns", "list"]);
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).campaigns[0].name, "October launch");
});

test("api merges a query string in the path with --query", async () => {
  const { code } = await cli(["api", "GET", "/campaigns?limit=5", "--query", "offset=2"]);
  assert.equal(code, 0);
  assert.deepEqual(sentTo("GET", "/campaigns").at(-1).query, { limit: "5", offset: "2" });
});

test("input rules are checked before the confirmation and exit 2", async () => {
  const { code, stderr } = await cli(["accounts", "remove", "--yes"]);
  assert.equal(code, 2);
  assert.match(stderr, /Pass --account-id or --handle/);
  assert.doesNotMatch(stderr, /About to run/);
  assert.equal(sentTo("DELETE", "/accounts").length, 0);
});

test("typos get a suggestion and exit 2", async () => {
  const group = await cli(["campains", "list"]);
  assert.equal(group.code, 2);
  assert.match(group.stderr, /Did you mean: scrapely campaigns list\?/);

  const action = await cli(["campaigns", "lst"]);
  assert.match(action.stderr, /Did you mean: scrapely campaigns list\?/);

  const swapped = await cli(["list", "campaigns"]);
  assert.match(swapped.stderr, /Did you mean: scrapely campaigns list\?/);

  const leads = await cli(["leads", "--campaign-name", "x"]);
  assert.match(leads.stderr, /Unknown command "leads"\. Did you mean: scrapely sources leads or scrapely campaigns leads\?/);

  const inbox = await cli(["inbox"]);
  assert.match(inbox.stderr, /Did you mean: scrapely conversations list\?/);

  const noMatch = await cli(["conversations", "get"]);
  assert.match(noMatch.stderr, /Commands in conversations: list\./);

  const synonym = await cli(["campaigns", "unpause"]);
  assert.match(synonym.stderr, /Did you mean: scrapely campaigns resume\?/);
});

test("NO_COLOR and pipes never get ANSI codes", async () => {
  const { stdout, stderr } = await cli(["tweets", "list", "--status", "nope"], { env: { NO_COLOR: "1" } });
  assert.doesNotMatch(stdout + stderr, ANSI);
});
