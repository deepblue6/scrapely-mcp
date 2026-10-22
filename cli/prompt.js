// Terminal input: yes/no confirmation, hidden key entry, and reading piped stdin.

import { createInterface } from "node:readline";
import { NeedsConfirmation, UsageError } from "./errors.js";

export function isInteractive() {
  return Boolean(process.stdin.isTTY);
}

let stdinUsed = false;

// Whole of stdin as text. Only one value per command can come from stdin.
export async function readStdin() {
  if (stdinUsed) throw new UsageError("Only one value can be read from stdin (-) per command.");
  stdinUsed = true;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Ask before changing things. Without a terminal to ask on, --yes is required.
// The refusal is worded for AI agents too: they must ask the user, not just add --yes.
export async function confirm(summary, { yes }) {
  if (yes) return;
  if (!isInteractive()) {
    throw new NeedsConfirmation(
      `${summary}\nNothing was done: this needs confirmation. Re-run with --yes to go ahead.\n` +
      "(AI agents: show the lines above to the user and add --yes only after they approve.)"
    );
  }
  process.stderr.write(`${summary}\n`);
  const answer = await ask("Continue? [y/N] ");
  if (!/^y(es)?$/i.test(answer.trim())) {
    process.stderr.write("Cancelled. Nothing was changed.\n");
    process.exit(1);
  }
}

// Reads a line without echoing it (for API keys).
export function askHidden(question) {
  return new Promise((resolve) => {
    const { stdin, stderr } = process;
    stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";

    const done = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stderr.write("\n");
    };

    function onData(chunk) {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          done();
          return resolve(value.trim());
        }
        if (char === "\u0003") {
          done();
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    }

    stdin.on("data", onData);
  });
}
