// Where the CLI keeps the API key, and which key is active.
//
// SCRAPELY_API_KEY in the environment always wins. Otherwise the key saved by
// `scrapely login` is used, from:
//   macOS/Linux: $XDG_CONFIG_HOME/scrapely/config.json (default ~/.config/scrapely/config.json)
//   Windows:     %APPDATA%\scrapely\config.json
// The file is readable only by the current user (0600, folder 0700).

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function configPath() {
  const env = process.env;
  let base;
  if (process.platform === "win32" && env.APPDATA) base = env.APPDATA;
  else base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  return join(base, "scrapely", "config.json");
}

export function readConfig() {
  try {
    return JSON.parse(readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
}

export function saveApiKey(apiKey) {
  const file = configPath();
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  writeFileSync(file, JSON.stringify({ ...readConfig(), api_key: apiKey }, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600); // mode above only applies when the file is new
  return file;
}

// Returns true if a saved key was removed.
export function removeApiKey() {
  const file = configPath();
  if (!existsSync(file)) return false;
  const { api_key, ...rest } = readConfig();
  if (Object.keys(rest).length === 0) rmSync(file);
  else writeFileSync(file, JSON.stringify(rest, null, 2) + "\n", { mode: 0o600 });
  return Boolean(api_key);
}

// { key, source } where source says where the key came from, or null.
export function resolveApiKey() {
  const fromEnv = process.env.SCRAPELY_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: "SCRAPELY_API_KEY environment variable" };
  const saved = readConfig().api_key;
  if (saved) return { key: saved, source: configPath() };
  return null;
}

// sk_live_abc...wxyz -> "sk_live_…wxyz". Never print a full key.
export function maskKey(key) {
  if (!key || key.length < 12) return "****";
  const prefix = key.match(/^[a-z]+_(?:[a-z]+_)?/i)?.[0] || "";
  return `${prefix}…${key.slice(-4)}`;
}
