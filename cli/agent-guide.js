// What `scrapely setup-agent` writes: instructions that teach an AI agent
// (Claude Code, Codex, Cursor, ...) to use this CLI. One text, two wrappers:
// a Claude Code skill file and a delimited block for AGENTS.md.
// The command map is built from the registry, so it never goes stale.

import { BUILTINS, GROUPS, groupNames, groupTools } from "./registry.js";

export const AGENTS_START = "<!-- scrapely:start -->";
export const AGENTS_END = "<!-- scrapely:end -->";
// In every file this command writes: a SKILL.md without it was written by someone else.
export const WRITTEN_BY = 'Written by "scrapely setup-agent"';

// Plain YAML scalar: no ": " or " #" in it, so it needs no quoting.
const SKILL_DESCRIPTION =
  "Run Scrapely (X/Twitter DM outreach) with the scrapely CLI. Use for anything about Scrapely, " +
  "cold DMs on X/Twitter, DM campaigns, leads and lead sources, conversations and replies, " +
  "connected X accounts, people search, enrichment or webhooks.";

// "- accounts (Your connected X accounts...): list, add, remove*, ..."
export function commandMap() {
  return groupNames().map((group) => {
    const actions = groupTools(group).map((t) => t.cli.action + (t.destructive ? "*" : ""));
    const about = GROUPS[group] ? ` (${GROUPS[group]})` : "";
    return `- \`${group}\`${about}: ${actions.join(", ")}`;
  });
}

// Built-ins that have sub-commands worth listing (with * like the registry's).
const BUILTIN_DETAIL = { profiles: "profiles (list, use, remove*)" };

export const DASHBOARD_URL = "https://app.scrapely.co";
export const API_DOCS_URL = "https://app.scrapely.co/documentation";
const NOTIFICATION_SETTINGS_URL = "https://app.scrapely.co/settings/notifications";

// The shared guide. `level` is the markdown level of its top heading.
export function agentGuide(version, level = 1) {
  const h = (n, text) => `${"#".repeat(level + n)} ${text}`;
  return [
    h(0, "Scrapely CLI"),
    "",
    `<!-- ${WRITTEN_BY} (scrapely-mcp v${version}). Run it again after upgrading to refresh. -->`,
    "",
    "Scrapely automates X/Twitter DM outreach: the user's connected X accounts send DM campaigns to leads",
    "(scraped from followers or imported from a list), with replies, CRM, follower listeners, a People",
    "database, enrichment and webhooks. The `scrapely` command does all of this from the terminal.",
    "If it isn't installed, use `npx -p scrapely-mcp scrapely <command>`.",
    "",
    h(1, "Start here"),
    "",
    "1. Run `scrapely whoami --json`. If it says \"Not logged in\", ask the user to run `scrapely login` in",
    "   their own terminal. Never ask them to paste an API key into the chat, and never pass one yourself.",
    "   If `source` is the SCRAPELY_API_KEY environment variable, tell the user: that key is used instead",
    "   of their saved profiles until they unset it or you pass `--profile <name>`.",
    "2. Always add `--json` and parse the JSON (tables are for humans and get cut short).",
    "3. Don't guess commands or flags. Run `scrapely --help`, `scrapely <group> --help` and",
    "   `scrapely <group> <command> --help`: they list every flag with an example, and say which command",
    "   gives each ID or name (e.g. account IDs come from `scrapely accounts list`).",
    "",
    h(1, "Commands"),
    "",
    "`scrapely <group> <command> [--flags]`. `*` = changes something and needs `--yes` (see below).",
    "",
    ...commandMap(),
    `- Other: ${Object.keys(BUILTINS).map((name) => BUILTIN_DETAIL[name] || name).join(", ")}`,
    "",
    h(1, "Ask before changing anything"),
    "",
    "`*` commands send DMs, launch, pause or resume campaigns, spend credits, or remove or overwrite",
    "something. Without `--yes` they change nothing: they print a preview (command, flags, profile) and",
    "exit with code 2 (in an interactive terminal they ask `Continue? [y/N]` instead). Run the command",
    "without `--yes` first, show the preview to the user, and add `--yes` only after they explicitly",
    "approve in this conversation. One approval covers one action.",
    "- Unstarred commands that change things (like `campaigns rename` or `crm update`) are only for",
    "  changes the user asked for.",
    "- Read-only commands (list, get, analytics, credits) are fine any time. `people search --count-only`",
    "  is free and runs without `--yes`; a search without it costs 1 credit per row.",
    "- `dm send`: reply from the account that owns the conversation (its `account_id` in",
    "  `scrapely conversations list --conversation-id <id> --json`), not just any connected account.",
    "",
    h(1, "Several workspaces"),
    "",
    "Agencies save one key per workspace as a profile (a local label, not the Scrapely workspace name).",
    "`scrapely profiles list --json` shows them. Once the user names a workspace, pass `--profile <name>`",
    "on every command until they switch, and say which profile you used. Don't run `profiles use` unless",
    "they ask: it changes their default everywhere. The SCRAPELY_API_KEY environment variable beats the",
    "default profile (and SCRAPELY_PROFILE) unless you pass `--profile`; commands print a Note when it does.",
    "",
    h(1, "Secrets"),
    "",
    "Never print, log, echo or repeat API keys or webhook keys, and don't read the CLI's config file.",
    "The CLI shows keys masked; keep it that way.",
    "A newly generated webhook key is shown only once: tell the user to store it safely, and don't",
    "repeat it later.",
    "",
    h(1, "When no command fits"),
    "",
    "`scrapely api <METHOD> <path> [--data <json>] [--query key=value]` calls any endpoint of",
    "https://app.scrapely.co/api/v1 and prints JSON. Advanced: prefer a real command, and only use",
    `endpoints listed in the reference (${API_DOCS_URL}). Anything but GET needs`,
    "`--yes` and the same approval as above. If nothing fits, tell the user to do it in the dashboard",
    `(${DASHBOARD_URL}). For example, which events send a webhook (such as back-and-forth replies) is`,
    `chosen in the dashboard (${NOTIFICATION_SETTINGS_URL}); the CLI only adds URLs and turns them on/off.`,
    "",
    h(1, "Errors"),
    "",
    "Exit code 2: a wrong command or flag (read the message and the `--help` it suggests), or a `*`",
    "command run without `--yes` (show the preview to the user and ask, as above).",
    "Exit code 1: the request failed and the message says why. For a rejected key saved in a profile,",
    "the user runs `scrapely login --profile <name>`; for a rejected SCRAPELY_API_KEY, they unset it",
    "(or you pass `--profile <name>`). If it looks like a problem on Scrapely's side, offer to report it",
    "with `scrapely feedback send` (see its `--help`); never include keys, cookies or passwords in it.",
  ].join("\n") + "\n";
}

// The Claude Code skill: .claude/skills/scrapely/SKILL.md
export function skillFile(version) {
  return `---\nname: scrapely\ndescription: ${SKILL_DESCRIPTION}\n---\n\n${agentGuide(version, 1)}`;
}

// The AGENTS.md block, markers included, no trailing newline.
export function agentsBlock(version) {
  return `${AGENTS_START}\n${agentGuide(version, 2)}${AGENTS_END}`;
}

// Puts the block into an AGENTS.md text: replaces an existing block in place,
// otherwise appends it. Text outside the markers is never changed, and the block
// uses the file's line endings (CRLF files stay CRLF).
export function withAgentsBlock(existing, lfBlock) {
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const block = lfBlock.replace(/\n/g, eol);
  const start = existing.indexOf(AGENTS_START);
  const end = start < 0 ? -1 : existing.indexOf(AGENTS_END, start);
  if (start >= 0 && end >= 0) return existing.slice(0, start) + block + existing.slice(end + AGENTS_END.length);
  if (start >= 0 || existing.includes(AGENTS_END)) return null; // one marker without the other
  if (!existing.trim()) return block + eol;
  const gap = existing.endsWith(eol + eol) ? "" : existing.endsWith(eol) ? eol : eol + eol;
  return existing + gap + block + eol;
}
