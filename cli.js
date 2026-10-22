#!/usr/bin/env node

// Scrapely CLI: `scrapely <group> <action> [--flags]`.
// Commands come from the same tool registry as the MCP server (tools.js),
// so both always offer the same tools with the same inputs.

import { readFileSync } from "node:fs";
import { login, logout, whoami } from "./cli/auth.js";
import { parseFlags, takeProfileFlag } from "./cli/args.js";
import { UsageError, describeError } from "./cli/errors.js";
import { apiHelp, commandHelp, groupHelp, loginHelp, profilesHelp, rootHelp, whoamiHelp } from "./cli/help.js";
import { runProfiles } from "./cli/profiles.js";
import { ACTION_SYNONYMS, BUILTINS, BUILTIN_ALIASES, allCommandNames, findTool, groupNames, groupTools } from "./cli/registry.js";
import { runApi, runTool } from "./cli/run.js";
import { closest } from "./cli/suggest.js";
import { colors } from "./cli/style.js";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

const wantsHelp = (args) => args.includes("--help") || args.includes("-h");
const print = (text) => process.stdout.write(text + "\n");

// Words people try at the top level that aren't groups.
const TOP_LEVEL_SYNONYMS = { inbox: "conversations list", dms: "conversations list", messages: "conversations list", version: "--version" };

function guesses(first, second) {
  if (TOP_LEVEL_SYNONYMS[first]) return [TOP_LEVEL_SYNONYMS[first]];
  if (groupNames().includes(first)) {
    const actions = groupTools(first).map((t) => t.cli.action);
    const synonym = ACTION_SYNONYMS[second];
    const action = actions.includes(synonym) ? synonym : closest(second, actions);
    return action ? [`${first} ${action}`] : [];
  }
  if (second && findTool(second, first)) return [`${second} ${first}`]; // "list campaigns" -> "campaigns list"
  const pair = second && closest(`${first} ${second}`, allCommandNames());
  if (pair) return [pair];
  const asAction = groupNames().filter((g) => findTool(g, first)).map((g) => `${g} ${first}`); // "leads" -> "campaigns leads"
  if (asAction.length) return asAction;
  const near = closest(first, [...groupNames(), ...Object.keys(BUILTINS)]);
  return near ? [near] : [];
}

function unknownCommand(words) {
  const firstFlag = words.findIndex((w) => w.startsWith("-"));
  const [first, second] = firstFlag < 0 ? words : words.slice(0, firstFlag);
  const typed = [first, second].filter(Boolean).join(" ");
  const isGroup = groupNames().includes(first);
  const found = guesses(first, second);

  let hint = "";
  if (found.length) hint = ` Did you mean: ${found.map((g) => `scrapely ${g}`).join(" or ")}?`;
  else if (isGroup) hint = ` Commands in ${first}: ${groupTools(first).map((t) => t.cli.action).join(", ")}.`;
  return new UsageError(`Unknown command "${typed}".${hint}`, isGroup ? first : "");
}

// `scrapely help campaigns launch` is the same as `scrapely campaigns launch --help`.
function help(words) {
  const [group, action] = words;
  if (!group) return print(rootHelp(version));
  if (group === "api") return print(apiHelp());
  if (group === "login") return print(loginHelp());
  if (group === "profiles" || group === "profile") return print(profilesHelp());
  if (group === "whoami" || group === "status") return print(whoamiHelp());
  if (!groupNames().includes(group)) throw unknownCommand(words);
  if (!action) return print(groupHelp(group));
  const tool = findTool(group, action);
  if (!tool) throw unknownCommand(words);
  print(commandHelp(tool));
}

async function main(argv, profile) {
  const [rawFirst, second, ...rest] = argv;
  if (!rawFirst || rawFirst === "--help" || rawFirst === "-h") return print(rootHelp(version));
  if (rawFirst === "--version" || rawFirst === "-v") return print(version);

  const first = BUILTIN_ALIASES[rawFirst] || rawFirst;
  const afterFirst = argv.slice(1);

  switch (first) {
    case "help":
      return help(afterFirst);
    case "api":
      return wantsHelp(afterFirst) ? print(apiHelp()) : runApi(afterFirst, { profile });
    case "login": {
      if (wantsHelp(afterFirst)) return print(loginHelp());
      const { values } = parseFlags(afterFirst, { key: { type: "string" }, debug: { type: "boolean" } }, "login");
      return login({ ...values, profile });
    }
    case "logout":
      return wantsHelp(afterFirst)
        ? print("scrapely logout [--profile <name>]\n\nRemove the API key saved by scrapely login (from the default profile, or the one you name).")
        : logout({ profile });
    case "whoami":
      return wantsHelp(afterFirst) ? print(whoamiHelp()) : whoami({ profile });
    case "profiles":
      return !second || wantsHelp(afterFirst) ? print(profilesHelp()) : runProfiles(afterFirst, { profile });
  }

  if (!groupNames().includes(first)) throw unknownCommand(argv);
  if (!second || second === "--help" || second === "-h") return print(groupHelp(first));

  const tool = findTool(first, second);
  if (!tool) throw unknownCommand(argv);
  if (wantsHelp(rest)) return print(commandHelp(tool));
  return runTool(tool, rest, { profile });
}

// `scrapely --json campaigns list` works like `scrapely campaigns list --json`.
const GLOBAL_SWITCHES = ["--json", "--yes", "-y", "--debug"];
function globalsLast(args) {
  let n = 0;
  while (n < args.length - 1 && GLOBAL_SWITCHES.includes(args[n])) n++;
  return [...args.slice(n), ...args.slice(0, n)];
}

const rawArgv = process.argv.slice(2);

function start() {
  const { profile, argv } = takeProfileFlag(rawArgv);
  return main(globalsLast(argv), profile);
}

Promise.resolve().then(start).catch((err) => {
  const c = colors(process.stderr);
  const { message, exitCode } = describeError(err);
  process.stderr.write(`${c.red("Error:")} ${message}\n`);
  if (rawArgv.includes("--debug")) {
    process.stderr.write(`\n${err.stack}\n`);
    if (err.data !== undefined) process.stderr.write(`\nResponse: ${JSON.stringify(err.data, null, 2)}\n`);
  }
  process.exitCode = exitCode;
});
