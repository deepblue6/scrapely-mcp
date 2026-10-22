// scrapely login / logout / whoami

import { API_BASE, ApiError, DEFAULT_API_BASE, apiCall } from "../api.js";
import { maskKey, removeApiKey, resolveApiKey, saveApiKey } from "./config.js";
import { CliError } from "./errors.js";
import { askHidden, isInteractive, readStdin } from "./prompt.js";
import { colors } from "./style.js";

export const KEYS_URL = "https://app.scrapely.co/settings/integrations";

async function readKey(flagKey) {
  if (flagKey) return flagKey.trim();
  if (!isInteractive()) return (await readStdin()).trim();
  process.stderr.write(`Create an API key at ${KEYS_URL}\n`);
  return askHidden("Paste your API key (input is hidden): ");
}

export async function login({ key: flagKey }) {
  const c = colors(process.stdout);
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

  const file = saveApiKey(key);
  process.stdout.write(`${c.green("Logged in.")} Key ${maskKey(key)} saved to ${file}\n`);
  if (process.env.SCRAPELY_API_KEY) {
    process.stderr.write("Note: SCRAPELY_API_KEY is set in your environment and is used instead of the saved key.\n");
  }
}

export function logout() {
  const removed = removeApiKey();
  process.stdout.write(removed ? "Logged out. The saved API key was removed.\n" : "No saved API key to remove.\n");
  if (process.env.SCRAPELY_API_KEY) {
    process.stderr.write("Note: SCRAPELY_API_KEY is still set in your environment, so commands will keep using it.\n");
  }
}

export function whoami() {
  const c = colors(process.stdout);
  const active = resolveApiKey();
  if (!active) throw new CliError("Not logged in. Run: scrapely login (or set SCRAPELY_API_KEY)");
  const lines = [`${c.dim("API key")}  ${maskKey(active.key)}`, `${c.dim("From   ")}  ${active.source}`];
  if (API_BASE !== DEFAULT_API_BASE) lines.push(`${c.dim("API    ")}  ${API_BASE}`);
  process.stdout.write(lines.join("\n") + "\n");
}
