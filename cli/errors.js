// Error types and the friendly messages customers see when something fails.

import { ApiError } from "../api.js";

// Wrong command, flag or value. Exit code 2, with a pointer to the right --help.
export class UsageError extends Error {
  constructor(message, helpCommand = "") {
    super(message);
    this.name = "UsageError";
    this.helpCommand = helpCommand;
  }
}

// Expected failure with a message that is already customer-friendly. Exit code 1.
export class CliError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliError";
  }
}

const NETWORK_CODES = ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"];

function serverMessage(err) {
  return err.message.replace(/^API Error \d+: /, "");
}

// Turns any error into { message, exitCode } for printing.
export function describeError(err) {
  if (err instanceof UsageError) {
    const hint = err.helpCommand ? `\nRun: scrapely ${err.helpCommand} --help` : "\nRun: scrapely --help";
    return { message: err.message + hint, exitCode: 2 };
  }

  if (err instanceof ApiError) {
    const detail = serverMessage(err);
    if (err.status === 401 || err.status === 403) {
      return { message: `Invalid or missing API key. Run: scrapely login\n(Scrapely said: ${detail})`, exitCode: 1 };
    }
    if (err.status === 404) return { message: `Not found: ${detail}\nCheck the name or ID you passed.`, exitCode: 1 };
    if (err.status === 429) return { message: "Rate limited, try again shortly.", exitCode: 1 };
    if (err.status >= 500) {
      return { message: `Scrapely had a problem on its side (HTTP ${err.status}). Try again in a moment.\n(${detail})`, exitCode: 1 };
    }
    return { message: `Scrapely couldn't do that: ${detail}`, exitCode: 1 };
  }

  const code = err.cause?.code || err.cause?.errors?.[0]?.code || err.code;
  if (NETWORK_CODES.includes(code) || err.message === "fetch failed") {
    return { message: `Could not reach Scrapely (${code || err.cause?.message || "network error"}). Check your internet connection and try again.`, exitCode: 1 };
  }

  // A 2xx reply that isn't JSON (e.g. a proxy's HTML page).
  if (err instanceof SyntaxError) {
    return { message: "Scrapely sent back a response the CLI couldn't read. Try again, or run with --debug for details.", exitCode: 1 };
  }

  return { message: err.message, exitCode: 1 };
}
