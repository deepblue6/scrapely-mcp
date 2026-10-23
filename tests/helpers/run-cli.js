// Runs the real CLI in a child process against the mock API, with a throwaway config folder.

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../cli.js", import.meta.url));

export function tempHome() {
  return mkdtempSync(join(tmpdir(), "scrapely-cli-test-"));
}

// options: { base, home, env, input, cwd } -> { code, stdout, stderr }
export function runCli(args, { base, home = tempHome(), env = {}, input = "", cwd } = {}) {
  const childEnv = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), ...env };
  delete childEnv.SCRAPELY_API_KEY; // never pick up a real key from the developer's shell
  delete childEnv.SCRAPELY_PROFILE;
  delete childEnv.NO_COLOR;
  childEnv.SCRAPELY_API_BASE = base || "http://127.0.0.1:9/never-called";
  if (env.SCRAPELY_API_KEY) childEnv.SCRAPELY_API_KEY = env.SCRAPELY_API_KEY;
  if (env.NO_COLOR) childEnv.NO_COLOR = env.NO_COLOR;
  if (env.SCRAPELY_PROFILE) childEnv.SCRAPELY_PROFILE = env.SCRAPELY_PROFILE;
  // Never ask the real npm registry; tests that need the check pass SCRAPELY_UPDATE_URL
  delete childEnv.CI;
  delete childEnv.SCRAPELY_NO_UPDATE_CHECK;
  delete childEnv.SCRAPELY_UPDATE_URL;
  if (env.SCRAPELY_UPDATE_URL) childEnv.SCRAPELY_UPDATE_URL = env.SCRAPELY_UPDATE_URL;
  else childEnv.SCRAPELY_NO_UPDATE_CHECK = "1";
  if (env.SCRAPELY_NO_UPDATE_CHECK) childEnv.SCRAPELY_NO_UPDATE_CHECK = env.SCRAPELY_NO_UPDATE_CHECK;
  if (env.CI) childEnv.CI = env.CI;

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: childEnv, cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}
