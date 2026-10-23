// "New version available" notice, checked at most once a day.
//
// The latest version on npm is remembered in update-check.json next to config.json.
// After a command, if that version is newer than the installed one, one line goes to
// stderr (so --json output on stdout stays clean). Refreshing has a short timeout and
// any failure is ignored: the check never breaks or noticeably slows a command.
// Off when SCRAPELY_NO_UPDATE_CHECK is set or in CI.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { configPath } from "./config.js";
import { colors } from "./style.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 1500;
const DEFAULT_URL = "https://registry.npmjs.org/scrapely-mcp/latest";

const cacheFile = () => join(dirname(configPath()), "update-check.json");

function readCache() {
  try {
    return JSON.parse(readFileSync(cacheFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeCache(data) {
  try {
    mkdirSync(dirname(cacheFile()), { recursive: true, mode: 0o700 });
    writeFileSync(cacheFile(), JSON.stringify(data) + "\n");
  } catch {
    // Read-only home folder etc.: just check again next time
  }
}

// "1.17.0" > "1.16.2". Pre-releases ("1.17.0-beta.1") are never offered.
export function isNewer(latest, current) {
  if (typeof latest !== "string" || !/^\d+\.\d+\.\d+$/.test(latest)) return false;
  const a = latest.split(".").map(Number);
  const b = current.split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

async function fetchLatest() {
  const res = await fetch(process.env.SCRAPELY_UPDATE_URL || DEFAULT_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return null;
  const { version } = await res.json();
  return typeof version === "string" ? version : null;
}

export async function updateNotice(current, stream = process.stderr) {
  if (process.env.SCRAPELY_NO_UPDATE_CHECK || process.env.CI) return;

  let { checked_at: checkedAt = 0, latest } = readCache();
  if (Date.now() - checkedAt > DAY_MS) {
    latest = (await fetchLatest().catch(() => null)) || latest;
    writeCache({ checked_at: Date.now(), latest });
  }
  if (!isNewer(latest, current)) return;

  const c = colors(stream);
  stream.write(
    `\n${c.yellow("Update available:")} Scrapely CLI ${latest} (you have ${current}).\n` +
    `Run: npm install -g scrapely-mcp, then scrapely setup-agent\n`,
  );
}
