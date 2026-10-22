// Where the CLI keeps API keys, and which key is active.
//
// Keys are saved by `scrapely login` as named profiles (one per workspace), in:
//   macOS/Linux: $XDG_CONFIG_HOME/scrapely/config.json (default ~/.config/scrapely/config.json)
//   Windows:     %APPDATA%\scrapely\config.json
// The file is readable only by the current user (0600, folder 0700).
//
// Shape: { "default_profile": "default", "profiles": { "<name>": { "api_key": "..." } } }
// The old shape { "api_key": "..." } is read as profile "default" and rewritten
// in the new shape on the next save.
//
// Which key is used, first match wins:
//   --profile <name>  >  SCRAPELY_API_KEY  >  SCRAPELY_PROFILE  >  default_profile  >  "default"

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { UsageError } from "./errors.js";

const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function configPath() {
  const env = process.env;
  let base;
  if (process.platform === "win32" && env.APPDATA) base = env.APPDATA;
  else base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  return join(base, "scrapely", "config.json");
}

export function readConfig() {
  try {
    const data = JSON.parse(readFileSync(configPath(), "utf8"));
    return isPlainObject(data) ? data : {};
  } catch {
    return {};
  }
}

// The config in the profiles shape, whichever shape is on disk. Unknown keys are kept.
export function loadConfig() {
  const { api_key, profiles, default_profile, ...rest } = readConfig();
  const config = { ...rest, profiles: isPlainObject(profiles) ? { ...profiles } : {} };
  if (api_key && !config.profiles.default) config.profiles.default = { api_key };
  if (typeof default_profile === "string") config.default_profile = default_profile;
  else if (api_key) config.default_profile = "default";
  return config;
}

// Writes a new 0600 file next to the target, then renames it into place,
// so the key is never in a file that others can read, even for a moment.
function writePrivate(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  rmSync(tmp, { force: true }); // left over from a crash
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(tmp, file);
}

function writeConfig(config) {
  const file = configPath();
  const { profiles, ...rest } = config;
  if (Object.keys(profiles).length === 0 && Object.keys(rest).filter((k) => k !== "default_profile").length === 0) {
    rmSync(file, { force: true });
    return file;
  }
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  writePrivate(file, config);
  return file;
}

// Throws a usage error unless `name` is a valid profile name.
export function checkProfileName(name, where = "--profile") {
  if (!PROFILE_NAME.test(name)) {
    throw new UsageError(
      `${where}: "${name}" isn't a valid profile name. Use 1-32 lowercase letters, digits, - or _ (starting with a letter or digit).`,
      "profiles"
    );
  }
  return name;
}

export function profileNames(config = loadConfig()) {
  return Object.keys(config.profiles).sort();
}

export function missingProfile(name, config = loadConfig()) {
  const saved = profileNames(config);
  return new UsageError(
    `No profile named "${name}". Saved profiles: ${saved.length ? saved.join(", ") : "none"}. Add one with: scrapely login --profile ${name}`,
    "profiles"
  );
}

// The profile that login/logout act on: --profile > SCRAPELY_PROFILE > default_profile > "default".
export function targetProfile(flagProfile, config = loadConfig()) {
  if (flagProfile) return checkProfileName(flagProfile);
  const fromEnv = process.env.SCRAPELY_PROFILE?.trim();
  if (fromEnv) return checkProfileName(fromEnv, "SCRAPELY_PROFILE");
  return config.default_profile || "default";
}

// Saves a key under a profile. The first profile saved becomes the default.
export function saveApiKey(apiKey, profile = targetProfile()) {
  checkProfileName(profile);
  const config = loadConfig();
  config.profiles[profile] = { ...config.profiles[profile], api_key: apiKey };
  if (!config.default_profile) config.default_profile = profile;
  return writeConfig(config);
}

// Removes a profile. Returns { removed, wasDefault }.
export function removeApiKey(profile = targetProfile()) {
  if (!existsSync(configPath())) return { removed: false, wasDefault: false };
  const config = loadConfig();
  if (!config.profiles[profile]) return { removed: false, wasDefault: false };
  delete config.profiles[profile];
  const wasDefault = config.default_profile === profile;
  if (wasDefault) delete config.default_profile;
  writeConfig(config);
  return { removed: true, wasDefault };
}

export function setDefaultProfile(profile) {
  checkProfileName(profile);
  const config = loadConfig();
  if (!config.profiles[profile]) throw missingProfile(profile, config);
  config.default_profile = profile;
  return writeConfig(config);
}

// [{ name, key (masked), default }], sorted by name. Never contains a full key.
export function listProfiles() {
  const config = loadConfig();
  return profileNames(config).map((name) => ({
    name,
    key: maskKey(config.profiles[name]?.api_key),
    default: name === config.default_profile,
  }));
}

function fromProfile(config, name, source) {
  const key = config.profiles[name]?.api_key;
  if (!key) throw missingProfile(name, config);
  return { key, source, profile: name, file: configPath() };
}

// { key, source, profile, file, overridesEnv } for the active key, or null if there is none.
// profile is null when the key comes from SCRAPELY_API_KEY.
export function resolveApiKey(flagProfile) {
  const config = loadConfig();
  const fromEnv = process.env.SCRAPELY_API_KEY?.trim();
  if (flagProfile) {
    const active = fromProfile(config, checkProfileName(flagProfile), "--profile flag");
    return { ...active, overridesEnv: Boolean(fromEnv) };
  }
  if (fromEnv) return { key: fromEnv, source: "SCRAPELY_API_KEY environment variable", profile: null };

  const envProfile = process.env.SCRAPELY_PROFILE?.trim();
  if (envProfile) return fromProfile(config, checkProfileName(envProfile, "SCRAPELY_PROFILE"), "SCRAPELY_PROFILE environment variable");
  if (config.default_profile) return fromProfile(config, config.default_profile, "default profile");
  if (config.profiles.default) return fromProfile(config, "default", "default profile");

  const saved = profileNames(config);
  if (saved.length) {
    throw new UsageError(`No default profile is set. Saved profiles: ${saved.join(", ")}. Pick one with: scrapely profiles use <name> (or pass --profile <name>)`, "profiles");
  }
  return null;
}

// "Profile: bitvault (sk_live_…abcd)": which workspace a command is about to change.
export function describeActive(active) {
  if (active.profile) return `Profile: ${active.profile} (${maskKey(active.key)})`;
  return `Key: ${maskKey(active.key)} from SCRAPELY_API_KEY (no profile)`;
}

// sk_live_abc...wxyz -> "sk_live_…wxyz". Never print a full key.
export function maskKey(key) {
  if (!key || key.length < 12) return "****";
  const prefix = key.match(/^[a-z]+_(?:[a-z]+_)?/i)?.[0] || "";
  return `${prefix}…${key.slice(-4)}`;
}
