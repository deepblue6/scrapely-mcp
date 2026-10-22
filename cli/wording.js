// Tool descriptions are written for AI agents (MCP). These helpers make them read
// right on the command line: tool names become commands, input names become
// --flags, and flags with no description or an unknown source get a short hint.

import { tools } from "../tools.js";
import { toFlag } from "./schema.js";

const COMMAND_FOR = Object.fromEntries(tools.map((t) => [t.name, `scrapely ${t.cli.group} ${t.cli.action}`]));
const FLAG_KEYS = new Set(tools.flatMap((t) => Object.keys(t.inputs)).filter((key) => key.includes("_")));

// "Use list_campaigns ... is_active false" -> "Use scrapely campaigns list ... --no-is-active"
export function cliText(text) {
  return text
    .replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g, (word) => COMMAND_FOR[word] || (FLAG_KEYS.has(word) ? `--${toFlag(word)}` : word))
    .replace(/--([a-z0-9-]+) (true|false)\b/g, (_, flag, value) => (value === "true" ? `--${flag}` : `--no-${flag}`));
}

// For inputs the schemas leave undescribed (the MCP schemas must stay as they are).
const FIELD_HELP = {
  limit: "Max results to return",
  offset: "Skip this many results (for paging)",
  enable_follow: "Follow each lead's profile before the DM",
  enable_like: "Like each lead's recent post before the DM",
  enable_comment: "Comment on each lead's post before the DM",
  comment_template: "AI personalization template for the comments",
  notes: "Notes for the conversation",
  deal_value: "Deal value",
  deal_currency: "Currency code (default USD)",
  tag: "CRM tag",
  account_id: "Only this account",
  status: "Only items with this status",
  sort_by: "Sort by this column",
  sort_order: "Sort direction",
};

// A field's help line, with true/false spelled as the switches you type.
export function fieldText(field) {
  let text = cliText(field.description || FIELD_HELP[field.key] || "");
  if (field.kind === "boolean") {
    text = text.replace(/\btrue\b/g, `--${field.flag}`).replace(/\bfalse\b/g, `--no-${field.flag}`);
  }
  return text;
}

// Where to find the ID or name a flag asks for.
const FIND_WITH = {
  account_id: "scrapely accounts list (ID column)",
  account_ids: "scrapely accounts list (ID column)",
  lead_source_id: "scrapely sources list",
  lead_source_ids: "scrapely sources list",
  source_id: "scrapely sources list",
  conversation_id: "scrapely conversations list",
  account_handle: "scrapely conversations list",
  campaign_name: "scrapely campaigns list",
  listener_id: "scrapely listeners list",
  tweet_id: "scrapely tweets list",
};

// "Find it with: scrapely accounts list", unless the help line already says so.
export function findWith(field, tool) {
  const source = field.key === "id" ? `scrapely ${tool.cli.group} list` : FIND_WITH[field.key];
  if (!source || source.startsWith(`scrapely ${tool.cli.group} ${tool.cli.action}`)) return null;
  if (fieldText(field).includes(source.split(" (")[0])) return null;
  return `Find it with: ${source}`;
}
