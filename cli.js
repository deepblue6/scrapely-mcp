#!/usr/bin/env node

// Scrapely CLI: `scrapely <group> <action> [--flags]`.
// Commands come from the same tool registry as the MCP server (tools.js),
// so both always offer the same tools with the same inputs.

import { readFileSync } from "node:fs";
import { login, logout, whoami } from "./cli/auth.js";
import { parseFlags } from "./cli/args.js";
import { UsageError, describeError } from "./cli/errors.js";
import { apiHelp, commandHelp, groupHelp, loginHelp, rootHelp } from "./cli/help.js";
import { ACTION_SYNONYMS, BUILTINS, BUILTIN_ALIASES, allCommandNames, findTool, groupNames, groupTools } from "./cli/registry.js";
import { runApi, runTool } from "./cli/run.js";
import { closest } from "./cli/suggest.js";
import { colors } from "./cli/style.js";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

const wantsHelp = (args) => args.includes("--help") || args.includes("-h");
const print = (text) => process.stdout.write(text + "\n");

function unknownCommand(words) {
  const [first, second] = words;
  const typed = words.filter((w) => !w.startsWith("-")).slice(0, 2).join(" ");
  let guess = null;

  if (groupNames().includes(first)) {
    const actions = groupTools(first).map((t) => t.cli.action);
    const synonym = ACTION_SYNONYMS[second];
    const action = actions.includes(synonym) ? synonym : closest(second, actions);
    if (action) guess = `${first} ${action}`;
  } else if (second && !second.startsWith("-") && findTool(second, first)) {
    guess = `${second} ${first}`; // "list campaigns" -> "campaigns list"
  } else {
    guess = (second && !second.startsWith("-") && closest(`${first} ${second}`, allCommandNames()))
      || closest(first, [...groupNames(), ...Object.keys(BUILTINS)]);
  }

  const hint = guess ? ` Did you mean: scrapely ${guess}?` : "";
  return new UsageError(`Unknown command "${typed}".${hint}`, groupNames().includes(first) ? first : "");
}

// `scrapely help campaigns launch` is the same as `scrapely campaigns launch --help`.
function help(words) {
  const [group, action] = words;
  if (!group) return print(rootHelp(version));
  if (group === "api") return print(apiHelp());
  if (group === "login") return print(loginHelp());
  if (!groupNames().includes(group)) throw unknownCommand(words);
  if (!action) return print(groupHelp(group));
  const tool = findTool(group, action);
  if (!tool) throw unknownCommand(words);
  print(commandHelp(tool));
}

async function main(argv) {
  const [rawFirst, second, ...rest] = argv;
  if (!rawFirst || rawFirst === "--help" || rawFirst === "-h") return print(rootHelp(version));
  if (rawFirst === "--version" || rawFirst === "-v") return print(version);

  const first = BUILTIN_ALIASES[rawFirst] || rawFirst;
  const afterFirst = argv.slice(1);

  switch (first) {
    case "help":
      return help(afterFirst);
    case "api":
      return wantsHelp(afterFirst) ? print(apiHelp()) : runApi(afterFirst);
    case "login": {
      if (wantsHelp(afterFirst)) return print(loginHelp());
      const { values } = parseFlags(afterFirst, { key: { type: "string" }, debug: { type: "boolean" } }, "login");
      return login(values);
    }
    case "logout":
      return wantsHelp(afterFirst) ? print("scrapely logout\n\nRemove the API key saved by scrapely login.") : logout();
    case "whoami":
      return wantsHelp(afterFirst) ? print("scrapely whoami (or: scrapely status)\n\nShow which API key is in use and where it comes from.") : whoami();
  }

  if (!groupNames().includes(first)) throw unknownCommand(argv);
  if (!second || second === "--help" || second === "-h") return print(groupHelp(first));

  const tool = findTool(first, second);
  if (!tool) throw unknownCommand(argv);
  if (wantsHelp(rest)) return print(commandHelp(tool));
  return runTool(tool, rest);
}

// `scrapely --json campaigns list` works like `scrapely campaigns list --json`.
const GLOBAL_SWITCHES = ["--json", "--yes", "-y", "--debug"];
function globalsLast(args) {
  let n = 0;
  while (n < args.length - 1 && GLOBAL_SWITCHES.includes(args[n])) n++;
  return [...args.slice(n), ...args.slice(0, n)];
}

const argv = globalsLast(process.argv.slice(2));

main(argv).catch((err) => {
  const c = colors(process.stderr);
  const { message, exitCode } = describeError(err);
  process.stderr.write(`${c.red("Error:")} ${message}\n`);
  if (argv.includes("--debug")) {
    process.stderr.write(`\n${err.stack}\n`);
    if (err.data !== undefined) process.stderr.write(`\nResponse: ${JSON.stringify(err.data, null, 2)}\n`);
  }
  process.exitCode = exitCode;
});
