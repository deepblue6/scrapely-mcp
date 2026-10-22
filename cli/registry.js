// CLI view of the shared tool registry: `scrapely <group> <action>` -> command.
//
// Most commands are a tool as-is. A tool's cli.defaults let a flag be left out
// (`campaigns pause` pauses), and cli.aliases add commands that run the same
// tool with some inputs fixed (`campaigns resume` = pause with is_paused false).

import { tools } from "../tools.js";

// One-line summaries for `scrapely --help`, in display order.
export const GROUPS = {
  accounts: "Your connected X accounts: list, add, pause, warmup, proxies",
  tags: "Tags on your X accounts",
  sources: "Lead sources: scrape followers, import your own lists",
  campaigns: "DM campaigns: launch, pause, edit, leads and analytics",
  media: "Upload images to attach to DMs",
  conversations: "Your DM conversations",
  dm: "Send a DM in an existing conversation",
  crm: "CRM tags, notes and deal values on conversations",
  listeners: "Watch X accounts for new followers / following",
  people: "Search the Scrapely People database",
  enrich: "Find a person's X profile or email",
  tweets: "Schedule tweets",
  webhooks: "Webhook event reference",
  feedback: "Report a bug or idea to the Scrapely team",
};

// Built-in commands that aren't API tools.
export const BUILTINS = {
  login: "Save your API key on this computer",
  logout: "Remove the saved API key",
  whoami: "Show which API key and profile are in use",
  profiles: "Switch between workspaces: list, use, remove saved keys",
  api: "Call any API endpoint directly (advanced)",
  "setup-agent": "Teach your AI agent (Claude Code, Codex, Cursor) to use this CLI",
  help: "Show help for a command",
};

export const BUILTIN_ALIASES = { status: "whoami", profile: "profiles" };

// Words people try that mean an existing action ("campaigns unpause" -> resume).
export const ACTION_SYNONYMS = {
  unpause: "resume", start: "resume", continue: "resume",
  delete: "remove", rm: "remove",
  ls: "list", all: "list",
  show: "get", view: "get", info: "get",
  edit: "update", new: "create",
};

function withDefaults(inputs, defaults = {}) {
  return Object.fromEntries(Object.entries(inputs).map(([key, schema]) =>
    [key, key in defaults ? schema.default(defaults[key]) : schema]));
}

function without(inputs, fixed) {
  return Object.fromEntries(Object.entries(inputs).filter(([key]) => !(key in fixed)));
}

function commandsFor(tool) {
  const { defaults, aliases = {}, ...cli } = tool.cli;
  const main = { ...tool, inputs: withDefaults(tool.inputs, defaults), cli };
  const extra = Object.entries(aliases).map(([action, { args, summary }]) => ({
    ...tool,
    description: summary,
    inputs: without(tool.inputs, args),
    run: (input, call) => tool.run({ ...input, ...args }, call),
    cli: { ...cli, action },
  }));
  return [main, ...extra];
}

export const commands = tools.flatMap(commandsFor);

export function commandName(command) {
  return `${command.cli.group} ${command.cli.action}`;
}

export function findTool(group, action) {
  return commands.find((t) => t.cli.group === group && t.cli.action === action) || null;
}

export function groupTools(group) {
  return commands.filter((t) => t.cli.group === group);
}

export function groupNames() {
  const known = Object.keys(GROUPS);
  const extra = [...new Set(commands.map((t) => t.cli.group))].filter((g) => !known.includes(g));
  return [...known.filter((g) => groupTools(g).length), ...extra];
}

export function allCommandNames() {
  return commands.map(commandName);
}
