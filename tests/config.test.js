import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkProfileName, configPath, describeActive, listProfiles, loadConfig, maskKey, removeApiKey, resolveApiKey,
  saveApiKey, setDefaultProfile, targetProfile,
} from "../cli/config.js";
import { CliError, UsageError } from "../cli/errors.js";
import { tempHome } from "./helpers/run-cli.js";

let home;
beforeEach(() => {
  home = tempHome();
  process.env.XDG_CONFIG_HOME = join(home, "xdg");
  delete process.env.SCRAPELY_API_KEY;
  delete process.env.SCRAPELY_PROFILE;
});

const KEY_A = "sk_live_aaaaaaaaaaaa1111";
const KEY_B = "sk_live_bbbbbbbbbbbb2222";
const KEY_ENV = "sk_live_envenvenvenv3333";
const onDisk = () => JSON.parse(readFileSync(configPath(), "utf8"));
const mode = (path) => statSync(path).mode & 0o777;
const isPrivate = () => process.platform === "win32" || (mode(configPath()) === 0o600 && mode(join(home, "xdg", "scrapely")) === 0o700);

function writeOld(data) {
  const dir = join(home, "xdg", "scrapely");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(data), { mode: 0o600 });
}

function usageError(fn, pattern) {
  assert.throws(fn, (err) => err instanceof UsageError && pattern.test(err.message));
}

test("config lives under XDG_CONFIG_HOME/scrapely", () => {
  assert.equal(configPath(), join(home, "xdg", "scrapely", "config.json"));
});

test("saved key is private to the user (0600 file, 0700 folder)", { skip: process.platform === "win32" }, () => {
  const file = saveApiKey("sk_live_abcdefghijklmnop");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(join(home, "xdg", "scrapely")).mode & 0o777, 0o700);
});

test("SCRAPELY_API_KEY wins over the saved key", () => {
  saveApiKey("sk_live_saved000000000");
  assert.equal(resolveApiKey().key, "sk_live_saved000000000");
  process.env.SCRAPELY_API_KEY = "sk_live_fromenv0000000";
  assert.equal(resolveApiKey().key, "sk_live_fromenv0000000");
  assert.match(resolveApiKey().source, /environment/);
  delete process.env.SCRAPELY_API_KEY;
});

test("logout removes the key", () => {
  saveApiKey("sk_live_saved000000000");
  assert.equal(removeApiKey().removed, true);
  assert.equal(resolveApiKey(), null);
  assert.equal(removeApiKey().removed, false);
});

test("keys are masked, never shown in full", () => {
  assert.equal(maskKey("sk_live_1234567890abcd"), "sk_live_…abcd");
  assert.equal(maskKey("short"), "****");
});

test("an existing world-readable config is replaced by a private one", { skip: process.platform === "win32" }, () => {
  const dir = join(home, "xdg", "scrapely");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ other: 1 }), { mode: 0o644 });
  chmodSync(join(dir, "config.json"), 0o644);
  const file = saveApiKey("sk_live_abcdefghijklmnop");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir), ["config.json"], "no temp file left behind");
  assert.equal(removeApiKey().removed, true);
  assert.deepEqual(onDisk(), { other: 1 }, "no empty profiles object is left behind");
  assert.equal(statSync(file).mode & 0o777, 0o600, "other settings stay private too");
});

test("the old { api_key } shape is read as profile default, and migrated on the next write", () => {
  writeOld({ api_key: KEY_A, other: 1 });
  const active = resolveApiKey();
  assert.equal(active.key, KEY_A);
  assert.equal(active.profile, "default");
  assert.deepEqual(onDisk(), { api_key: KEY_A, other: 1 }, "reading doesn't rewrite the file");

  saveApiKey(KEY_B, "bitvault");
  assert.deepEqual(onDisk(), {
    other: 1,
    profiles: { default: { api_key: KEY_A }, bitvault: { api_key: KEY_B } },
    default_profile: "default",
  });
  assert.equal(resolveApiKey().key, KEY_A, "the migrated key stays the default");
  assert.ok(isPrivate());
});

test("the first profile saved becomes the default; later ones don't change it", () => {
  saveApiKey(KEY_B, "bitvault");
  assert.equal(loadConfig().default_profile, "bitvault");
  saveApiKey(KEY_A, "acme");
  assert.equal(loadConfig().default_profile, "bitvault");
  assert.equal(resolveApiKey().key, KEY_B);
  assert.equal(targetProfile(), "bitvault", "login without --profile updates the default profile");
});

test("key precedence: --profile > SCRAPELY_API_KEY > SCRAPELY_PROFILE > default_profile > default", () => {
  saveApiKey(KEY_A, "default");
  saveApiKey(KEY_B, "bitvault");
  saveApiKey("sk_live_cccccccccccc4444", "acme");
  saveApiKey("sk_live_dddddddddddd5555", "flagged");
  setDefaultProfile("acme");
  process.env.SCRAPELY_API_KEY = KEY_ENV;
  process.env.SCRAPELY_PROFILE = "bitvault";

  const flag = resolveApiKey("flagged");
  assert.deepEqual([flag.profile, flag.source, flag.overridesEnv], ["flagged", "--profile flag", true]);

  const env = resolveApiKey();
  assert.deepEqual([env.key, env.profile], [KEY_ENV, null]);
  delete process.env.SCRAPELY_API_KEY;

  const envProfile = resolveApiKey();
  assert.deepEqual([envProfile.key, envProfile.source], [KEY_B, "SCRAPELY_PROFILE environment variable"]);
  delete process.env.SCRAPELY_PROFILE;

  const byDefault = resolveApiKey();
  assert.deepEqual([byDefault.profile, byDefault.source], ["acme", "default profile"]);
  assert.equal(resolveApiKey("flagged").overridesEnv, false);

  // Without a default_profile, a lone profile named "default" is used; with several, nothing is guessed.
  writeOld({ profiles: { default: { api_key: KEY_A } } });
  assert.equal(resolveApiKey().key, KEY_A);
  writeOld({ profiles: { default: { api_key: KEY_A }, bitvault: { api_key: KEY_B } } });
  usageError(() => resolveApiKey(), /No default profile is set\. Saved profiles: bitvault, default/);
});

test("profile names must be lowercase letters, digits, - and _ (max 32)", () => {
  for (const ok of ["a", "bitvault", "client-2", "acme_eu", "0x", "a".repeat(32)]) assert.equal(checkProfileName(ok), ok);
  for (const bad of ["", "BitVault", "-x", "_x", "../etc", "a/b", "a b", "a.b", "a".repeat(33), "é"]) {
    usageError(() => checkProfileName(bad), /isn't a valid profile name/);
  }
  usageError(() => saveApiKey(KEY_A, "../evil"), /isn't a valid profile name/);
  process.env.SCRAPELY_PROFILE = "Nope!";
  usageError(() => resolveApiKey(), /SCRAPELY_PROFILE: "Nope!" isn't a valid profile name/);
  assert.throws(() => statSync(configPath()), "nothing was written");
});

test("a missing profile is an error that lists the saved ones", () => {
  saveApiKey(KEY_A, "acme");
  saveApiKey(KEY_B, "bitvault");
  usageError(() => resolveApiKey("other"), /^No profile named "other"\. Saved profiles: acme, bitvault\. Add one with: scrapely login --profile other$/);
  process.env.SCRAPELY_API_KEY = KEY_ENV;
  usageError(() => resolveApiKey("other"), /No profile named "other"/); // even with the env key set
  delete process.env.SCRAPELY_API_KEY;
  process.env.SCRAPELY_PROFILE = "other";
  usageError(() => resolveApiKey(), /No profile named "other"/);
  usageError(() => setDefaultProfile("other"), /No profile named "other"/);
});

test("removing the default profile leaves no default (never silently another workspace)", () => {
  saveApiKey(KEY_A, "acme");
  saveApiKey(KEY_B, "bitvault");
  assert.deepEqual(removeApiKey("acme"), { removed: true, wasDefault: true });
  assert.equal(loadConfig().default_profile, undefined);
  usageError(() => resolveApiKey(), /No default profile is set\. Saved profiles: bitvault/);
  assert.ok(isPrivate());
  assert.deepEqual(removeApiKey("bitvault"), { removed: true, wasDefault: false });
  assert.throws(() => statSync(configPath()), "an empty config is deleted");
});

test("every write keeps the file 0600 and the folder 0700", { skip: process.platform === "win32" }, () => {
  saveApiKey(KEY_A, "acme");
  assert.ok(isPrivate());
  saveApiKey(KEY_B, "bitvault");
  assert.ok(isPrivate());
  setDefaultProfile("bitvault");
  assert.ok(isPrivate());
  removeApiKey("acme");
  assert.ok(isPrivate());
});

test("listProfiles and describeActive never contain a full key", () => {
  saveApiKey(KEY_A, "acme");
  saveApiKey(KEY_B, "bitvault");
  assert.deepEqual(listProfiles(), [
    { name: "acme", key: "sk_live_…1111", default: true },
    { name: "bitvault", key: "sk_live_…2222", default: false },
  ]);
  assert.equal(describeActive(resolveApiKey("bitvault")), "Profile: bitvault (sk_live_…2222)");
  process.env.SCRAPELY_API_KEY = KEY_ENV;
  assert.equal(describeActive(resolveApiKey()), "Key: sk_live_…3333 from SCRAPELY_API_KEY (no profile)");
});

test("a config.json that can't be read is an error, and is never overwritten", () => {
  const broken = '{"default_profile":"a","profiles":{"a":{"api_key":"sk_live_aaaa"},"b":{"api_key":"sk_live_bbbb"},}}';
  writeOld({});
  writeFileSync(configPath(), broken);
  const unreadable = (err) => err instanceof CliError && /Can't read .*config\.json/.test(err.message) && !/sk_live_/.test(err.message);
  assert.throws(() => resolveApiKey(), unreadable);
  assert.throws(() => listProfiles(), unreadable);
  assert.throws(() => saveApiKey(KEY_A, "c"), unreadable);
  assert.throws(() => removeApiKey("a"), unreadable);
  assert.equal(readFileSync(configPath(), "utf8"), broken, "the saved keys are still there");

  writeFileSync(configPath(), "[1,2]");
  assert.throws(() => saveApiKey(KEY_A, "c"), unreadable);
});

test("an unreadable (chmod 000) config is never overwritten", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
  saveApiKey(KEY_A, "acme");
  chmodSync(configPath(), 0o000);
  assert.throws(() => saveApiKey(KEY_B, "bitvault"), (err) => err instanceof CliError && /EACCES/.test(err.message));
  chmodSync(configPath(), 0o600);
  assert.deepEqual(onDisk().profiles, { acme: { api_key: KEY_A } });
});

test("a key an older CLI saved next to the profiles is kept as profile legacy", () => {
  writeOld({ default_profile: "default", profiles: { default: { api_key: KEY_A } }, api_key: KEY_B });
  assert.equal(resolveApiKey().key, KEY_A, "the default profile is still the default");
  assert.equal(resolveApiKey("legacy").key, KEY_B);
  saveApiKey(KEY_ENV, "acme");
  assert.deepEqual(onDisk().profiles, { default: { api_key: KEY_A }, legacy: { api_key: KEY_B }, acme: { api_key: KEY_ENV } });
  assert.equal(onDisk().api_key, undefined);
});
