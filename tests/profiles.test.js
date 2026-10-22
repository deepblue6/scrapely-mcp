// End-to-end: named profiles (one saved API key per workspace) against the mock API.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GOOD_KEY, startMockApi } from "./helpers/mock-api.js";
import { runCli, tempHome } from "./helpers/run-cli.js";

// The mock API accepts only GOOD_KEY, so a profile holding OTHER_KEY gets a 401.
const OTHER_KEY = "sk_live_otherkey00009999";

let api;
before(async () => {
  api = await startMockApi({ "POST /campaigns/pause": { success: true, message: "Campaign paused" } });
});
after(() => api.close());

const configFile = (home) => join(home, ".config", "scrapely", "config.json");
const onDisk = (home) => JSON.parse(readFileSync(configFile(home), "utf8"));
const mode = (home) => statSync(configFile(home)).mode & 0o777;

// A home with saved profiles, written directly (login needs the mock to accept the key).
function homeWith(config) {
  const home = tempHome();
  mkdirSync(join(home, ".config", "scrapely"), { recursive: true, mode: 0o700 });
  writeFileSync(configFile(home), JSON.stringify(config), { mode: 0o600 });
  return home;
}

const twoProfiles = () => homeWith({
  default_profile: "acme",
  profiles: { acme: { api_key: OTHER_KEY }, bitvault: { api_key: GOOD_KEY } },
});

test("login --profile saves a second workspace without changing the default", async () => {
  const home = tempHome();
  const first = await runCli(["login", "--profile", "acme", "--key", GOOD_KEY], { base: api.base, home });
  assert.equal(first.code, 0);
  assert.match(first.stdout, /saved as profile "acme"/);
  assert.doesNotMatch(first.stdout, /--profile acme/, "the first profile is the default, no hint needed");

  const second = await runCli(["login", "--key", GOOD_KEY, "--profile=bitvault"], { base: api.base, home });
  assert.equal(second.code, 0);
  assert.match(second.stdout, /Use it with --profile bitvault, or make it the default: scrapely profiles use bitvault/);
  assert.deepEqual(onDisk(home), {
    profiles: { acme: { api_key: GOOD_KEY }, bitvault: { api_key: GOOD_KEY } },
    default_profile: "acme",
  });
  if (process.platform !== "win32") assert.equal(mode(home), 0o600);
});

test("a key saved by an older version keeps working and is migrated on the next login", async () => {
  const home = homeWith({ api_key: GOOD_KEY });
  const who = await runCli(["whoami"], { base: api.base, home });
  assert.equal(who.code, 0);
  assert.match(who.stdout, /Profile\s+default/);

  const login = await runCli(["login", "--profile", "bitvault", "--key", GOOD_KEY], { base: api.base, home });
  assert.equal(login.code, 0);
  assert.deepEqual(onDisk(home), {
    profiles: { default: { api_key: GOOD_KEY }, bitvault: { api_key: GOOD_KEY } },
    default_profile: "default",
  });
  if (process.platform !== "win32") assert.equal(mode(home), 0o600);
});

test("--profile picks the key for any command, before or after it", async () => {
  const home = twoProfiles();
  const byDefault = await runCli(["accounts", "list"], { base: api.base, home });
  assert.equal(byDefault.code, 1, "the default profile (acme) holds a key the mock rejects");
  assert.match(byDefault.stderr, /Invalid or missing API key/);

  for (const args of [["accounts", "list", "--profile", "bitvault"], ["--profile", "bitvault", "accounts", "list"], ["--json", "--profile=bitvault", "accounts", "list"]]) {
    const { code } = await runCli(args, { base: api.base, home });
    assert.equal(code, 0, args.join(" "));
    assert.equal(api.requests.at(-1).key, GOOD_KEY);
  }

  const raw = await runCli(["api", "GET", "/campaigns", "--profile", "bitvault"], { base: api.base, home });
  assert.equal(raw.code, 0);
});

test("--profile beats SCRAPELY_API_KEY, with a note; otherwise the env key wins", async () => {
  const home = twoProfiles();
  const flagged = await runCli(["accounts", "list", "--profile", "bitvault"], { base: api.base, home, env: { SCRAPELY_API_KEY: OTHER_KEY } });
  assert.equal(flagged.code, 0);
  assert.equal(api.requests.at(-1).key, GOOD_KEY);
  assert.match(flagged.stderr, /^Note: using profile "bitvault" \(--profile\); SCRAPELY_API_KEY is ignored for this command\.$/m);

  const env = await runCli(["accounts", "list"], { base: api.base, home: homeWith({ profiles: { default: { api_key: OTHER_KEY } } }), env: { SCRAPELY_API_KEY: GOOD_KEY } });
  assert.equal(env.code, 0);
  assert.equal(api.requests.at(-1).key, GOOD_KEY);
});

test("SCRAPELY_PROFILE picks a profile, and whoami says where the key came from", async () => {
  const home = twoProfiles();
  const who = await runCli(["whoami"], { base: api.base, home, env: { SCRAPELY_PROFILE: "bitvault" } });
  assert.equal(who.code, 0);
  assert.match(who.stdout, /Profile\s+bitvault\nAPI key\s+sk_live_…abcd\nFrom\s+SCRAPELY_PROFILE environment variable\nFile\s+.*config\.json/);
  assert.doesNotMatch(who.stdout, new RegExp(GOOD_KEY));

  const flag = await runCli(["whoami", "--profile", "acme"], { base: api.base, home, env: { SCRAPELY_PROFILE: "bitvault" } });
  assert.match(flag.stdout, /Profile\s+acme[\s\S]*From\s+--profile flag/);

  const env = await runCli(["status"], { base: api.base, home, env: { SCRAPELY_API_KEY: GOOD_KEY } });
  assert.doesNotMatch(env.stdout, /Profile/);
  assert.match(env.stdout, /From\s+SCRAPELY_API_KEY environment variable/);
});

test("an unknown or invalid profile exits 2 and lists the saved ones", async () => {
  const home = twoProfiles();
  const missing = await runCli(["campaigns", "list", "--profile", "nope"], { base: api.base, home, env: { SCRAPELY_API_KEY: GOOD_KEY } });
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /No profile named "nope"\. Saved profiles: acme, bitvault\. Add one with: scrapely login --profile nope/);

  for (const bad of ["BitVault", "../x", "a b"]) {
    const { code, stderr } = await runCli(["campaigns", "list", "--profile", bad], { base: api.base, home });
    assert.equal(code, 2, bad);
    assert.match(stderr, /isn't a valid profile name/);
  }

  const noValue = await runCli(["campaigns", "list", "--profile"], { base: api.base, home });
  assert.equal(noValue.code, 2);
  assert.match(noValue.stderr, /--profile needs a value/);

  const fresh = tempHome();
  const sent = api.requests.length;
  const login = await runCli(["login", "--profile", "Bad!", "--key", GOOD_KEY], { base: api.base, home: fresh });
  assert.equal(login.code, 2);
  assert.equal(api.requests.length, sent, "the name is checked before the key is sent");
  assert.throws(() => statSync(configFile(fresh)), "nothing was saved");
});

test("profiles list shows masked keys and the default; --json has nothing secret", async () => {
  const home = twoProfiles();
  const { code, stdout } = await runCli(["profiles", "list"], { base: api.base, home });
  assert.equal(code, 0);
  assert.match(stdout, /^NAME\s+KEY\s+DEFAULT$/m);
  assert.match(stdout, /^acme\s+sk_live_…9999\s+yes$/m);
  assert.match(stdout, /^bitvault\s+sk_live_…abcd\s+no$/m);

  const json = await runCli(["profiles", "list", "--json"], { base: api.base, home });
  assert.deepEqual(JSON.parse(json.stdout), {
    default_profile: "acme",
    profiles: [
      { name: "acme", key: "sk_live_…9999", default: true },
      { name: "bitvault", key: "sk_live_…abcd", default: false },
    ],
  });
  assert.doesNotMatch(json.stdout + stdout, new RegExp(`${GOOD_KEY}|${OTHER_KEY}`));

  const empty = await runCli(["profiles", "ls"], { base: api.base });
  assert.match(empty.stdout, /No saved profiles\. Add one with: scrapely login --profile <name>/);
});

test("profiles use sets the default", async () => {
  const home = twoProfiles();
  const { code, stdout } = await runCli(["profiles", "use", "bitvault"], { base: api.base, home });
  assert.equal(code, 0);
  assert.match(stdout, /Default profile is now bitvault/);
  assert.equal(onDisk(home).default_profile, "bitvault");
  if (process.platform !== "win32") assert.equal(mode(home), 0o600);
  assert.equal((await runCli(["accounts", "list"], { base: api.base, home })).code, 0);

  const missing = await runCli(["profiles", "use", "nope"], { base: api.base, home });
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /No profile named "nope"/);
});

test("profiles remove asks first, naming the profile, then removes it", async () => {
  const home = twoProfiles();
  const refused = await runCli(["profiles", "remove", "acme"], { base: api.base, home });
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /About to remove the saved API key for profile acme/);
  assert.match(refused.stderr, /Profile: acme \(sk_live_…9999\)/);
  assert.match(refused.stderr, /--yes/);
  assert.ok(onDisk(home).profiles.acme, "nothing was removed");

  const removed = await runCli(["profiles", "rm", "acme", "--yes"], { base: api.base, home });
  assert.equal(removed.code, 0);
  assert.match(removed.stdout, /Removed profile "acme"\.\nThat was the default profile\. Pick a new one with: scrapely profiles use <name>/);
  assert.deepEqual(onDisk(home), { profiles: { bitvault: { api_key: GOOD_KEY } } });
  if (process.platform !== "win32") assert.equal(mode(home), 0o600);

  // With no default left, commands say so instead of picking another workspace.
  const noDefault = await runCli(["accounts", "list"], { base: api.base, home });
  assert.equal(noDefault.code, 2);
  assert.match(noDefault.stderr, /No default profile is set\. Saved profiles: bitvault/);
});

test("logout --profile removes only that profile", async () => {
  const home = twoProfiles();
  const out = await runCli(["logout", "--profile", "bitvault"], { base: api.base, home });
  assert.equal(out.code, 0);
  assert.match(out.stdout, /profile "bitvault" was removed/);
  assert.deepEqual(Object.keys(onDisk(home).profiles), ["acme"]);
  if (process.platform !== "win32") assert.equal(mode(home), 0o600);

  const again = await runCli(["logout", "--profile", "bitvault"], { base: api.base, home });
  assert.equal(again.code, 2);
  assert.match(again.stderr, /No profile named "bitvault"/);
});

test("confirmations for commands that change things name the profile in use", async () => {
  const home = twoProfiles();
  const tool = await runCli(["campaigns", "pause", "--campaign-name", "Launch", "--profile", "bitvault"], { base: api.base, home });
  assert.equal(tool.code, 2);
  assert.match(tool.stderr, /About to run scrapely campaigns pause[^\n]*\n {2}--campaign-name Launch[^\n]*\n {2}Profile: bitvault \(sk_live_…abcd\)/);

  const raw = await runCli(["api", "POST", "/campaigns/pause", "--data", "{}"], { base: api.base, home });
  assert.match(raw.stderr, /About to send POST \/campaigns\/pause\n {2}Profile: acme \(sk_live_…9999\)/);

  const env = await runCli(["campaigns", "pause", "--campaign-name", "Launch"], { base: api.base, env: { SCRAPELY_API_KEY: GOOD_KEY } });
  assert.match(env.stderr, /Key: sk_live_…abcd from SCRAPELY_API_KEY \(no profile\)/);

  for (const out of [tool, raw, env]) assert.doesNotMatch(out.stderr, new RegExp(`${GOOD_KEY}|${OTHER_KEY}`));
  const done = await runCli(["campaigns", "pause", "--campaign-name", "Launch", "--profile", "bitvault", "--yes"], { base: api.base, home });
  assert.equal(done.code, 0);
});

test("help documents --profile and the profiles command", async () => {
  const root = await runCli(["--help"]);
  assert.match(root.stdout, /--profile <name>\s+Use the API key saved under this profile/);
  assert.match(root.stdout, /Other commands[\s\S]*\n {2}profiles\s+Switch between workspaces/);

  const login = await runCli(["login", "--help"]);
  assert.match(login.stdout, /scrapely login --profile bitvault/);
  const who = await runCli(["help", "whoami"]);
  assert.match(who.stdout, /--profile <name>[\s\S]*SCRAPELY_API_KEY[\s\S]*SCRAPELY_PROFILE[\s\S]*default profile/);
  const profiles = await runCli(["profiles"]);
  assert.match(profiles.stdout, /use <name>\s+Make a profile the default/);
  const command = await runCli(["campaigns", "list", "--help"]);
  assert.match(command.stdout, /Also: --json, --yes, --profile <name>, --debug/);
});
