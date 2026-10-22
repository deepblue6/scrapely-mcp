import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { join } from "node:path";
import { configPath, maskKey, removeApiKey, resolveApiKey, saveApiKey } from "../cli/config.js";
import { tempHome } from "./helpers/run-cli.js";

let home;
beforeEach(() => {
  home = tempHome();
  process.env.XDG_CONFIG_HOME = join(home, "xdg");
  delete process.env.SCRAPELY_API_KEY;
});

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
  assert.equal(removeApiKey(), true);
  assert.equal(resolveApiKey(), null);
  assert.equal(removeApiKey(), false);
});

test("keys are masked, never shown in full", () => {
  assert.equal(maskKey("sk_live_1234567890abcd"), "sk_live_…abcd");
  assert.equal(maskKey("short"), "****");
});
