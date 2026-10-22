// CLI view of the shared tool registry: `scrapely <group> <action>` -> tool.

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
  whoami: "Show which API key is in use",
  api: "Call any API endpoint directly (advanced)",
  help: "Show help for a command",
};

export const BUILTIN_ALIASES = { status: "whoami" };

export function commandName(tool) {
  return `${tool.cli.group} ${tool.cli.action}`;
}

export function findTool(group, action) {
  return tools.find((t) => t.cli.group === group && t.cli.action === action) || null;
}

export function groupTools(group) {
  return tools.filter((t) => t.cli.group === group);
}

export function groupNames() {
  const known = Object.keys(GROUPS);
  const extra = [...new Set(tools.map((t) => t.cli.group))].filter((g) => !known.includes(g));
  return [...known.filter((g) => groupTools(g).length), ...extra];
}

export function allCommandNames() {
  return tools.map(commandName);
}

export { tools };
