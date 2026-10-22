// scrapely login / logout / whoami, and picking the active key for a command.

import { API_BASE, ApiError, DEFAULT_API_BASE, apiCall } from "../api.js";
import { loadConfig, maskKey, missingProfile, profileNames, removeApiKey, resolveApiKey, saveApiKey, targetProfile } from "./config.js";
import { CliError } from "./errors.js";
import { askHidden, isInteractive, readStdin } from "./prompt.js";
import { colors } from "./style.js";

export const KEYS_URL = "https://app.scrapely.co/settings/integrations";

const NOT_LOGGED_IN = "Not logged in. Run: scrapely login (or set SCRAPELY_API_KEY)";

// The active key for a command ({ key, profile, ... }); throws if there is none.
export function requireKey(profile) {
  const active = resolveApiKey(profile);
  if (!active) throw new CliError(NOT_LOGGED_IN);
  if (active.overridesEnv) {
    process.stderr.write(`Note: using profile "${active.profile}" (--profile); SCRAPELY_API_KEY is ignored for this command.\n`);
  }
  return active;
}

async function readKey(flagKey) {
  if (flagKey) {
    if (isInteractive()) process.stderr.write("Tip: --key leaves the key in your shell history. Next time, run scrapely login and paste it.\n");
    return flagKey.trim();
  }
  if (!isInteractive()) return (await readStdin()).trim();
  process.stderr.write(`Create an API key at ${KEYS_URL}\n`);
  return askHidden("Paste your API key (input is hidden): ");
}

export async function login({ key: flagKey, profile: flagProfile }) {
  const c = colors(process.stdout);
  const profile = targetProfile(flagProfile); // checked before asking for the key
  const key = await readKey(flagKey);
  if (!key) throw new CliError(`No API key given. Create one at ${KEYS_URL}`);

  // A cheap authenticated call proves the key works before we save it.
  try {
    await apiCall(key, "GET", "/accounts");
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      throw new CliError(`Scrapely rejected that API key (${maskKey(key)}). Check it at ${KEYS_URL}`);
    }
    throw err;
  }

  const file = saveApiKey(key, profile);
  process.stdout.write(`${c.green("Logged in.")} Key ${maskKey(key)} saved as profile "${profile}" in ${file}\n`);
  const { default_profile } = loadConfig();
  if (default_profile !== profile) {
    process.stdout.write(`Use it with --profile ${profile}, or make it the default: scrapely profiles use ${profile}\n`);
  }
  if (process.env.SCRAPELY_API_KEY) {
    process.stderr.write("Note: SCRAPELY_API_KEY is set in your environment and is used instead of saved profiles (unless you pass --profile).\n");
  }
}

export function logout({ profile: flagProfile } = {}) {
  const profile = targetProfile(flagProfile);
  const { removed, wasDefault } = removeApiKey(profile);
  if (!removed && (flagProfile || profileNames().length)) throw missingProfile(profile);
  process.stdout.write(removed ? `Logged out. The API key saved as profile "${profile}" was removed.\n` : "No saved API key to remove.\n");
  if (wasDefault && profileNames().length) {
    process.stdout.write("That was the default profile. Pick a new one with: scrapely profiles use <name>\n");
  }
  if (process.env.SCRAPELY_API_KEY) {
    process.stderr.write("Note: SCRAPELY_API_KEY is still set in your environment, so commands will keep using it.\n");
  }
}

export function whoami({ profile } = {}) {
  const c = colors(process.stdout);
  const active = requireKey(profile);
  const lines = [];
  if (active.profile) lines.push(`${c.dim("Profile")}  ${active.profile}`);
  lines.push(`${c.dim("API key")}  ${maskKey(active.key)}`, `${c.dim("From   ")}  ${active.source}`);
  if (active.file) lines.push(`${c.dim("File   ")}  ${active.file}`);
  if (API_BASE !== DEFAULT_API_BASE) lines.push(`${c.dim("API    ")}  ${API_BASE}`);
  process.stdout.write(lines.join("\n") + "\n");
}
