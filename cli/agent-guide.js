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
    "1. Run `scrapely whoami`. If it says \"Not logged in\", ask the user to run `scrapely login` in their",
    "   own terminal. Never ask them to paste an API key into the chat, and never pass one yourself.",
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
    `- Other: ${Object.keys(BUILTINS).join(", ")}`,
    "",
    h(1, "Ask before changing anything"),
    "",
    "Commands that send DMs, launch, pause or resume campaigns, spend credits, or remove or overwrite",
    "something refuse to run without `--yes` (they exit with code 2 and do nothing). Before adding `--yes`,",
    "tell the user exactly what will happen (the command, which campaign, accounts or leads, and which",
    "profile) and get their explicit approval in this conversation. One approval covers one action.",
    "Read-only commands (list, get, analytics, credits) are fine to run any time.",
    "",
    h(1, "Several workspaces"),
    "",
    "Agencies save one key per workspace as a profile. `scrapely profiles list --json` shows them; add",
    "`--profile <name>` to any command to use one. Always tell the user which profile you used, and",
    "confirm it before any `*` command.",
    "",
    h(1, "Secrets"),
    "",
    "Never print, log, echo or repeat API keys or webhook keys, and don't read the CLI's config file.",
    "The CLI shows keys masked; keep it that way. A newly generated webhook key is shown only once:",
    "tell the user to store it safely, and don't repeat it later.",
    "",
    h(1, "When no command fits"),
    "",
    "`scrapely api <METHOD> <path> [--data <json>] [--query key=value]` calls any endpoint of",
    "https://app.scrapely.co/api/v1 and prints JSON. Advanced: prefer a real command. Anything but GET",
    "needs `--yes` and the same approval as above.",
    "",
    h(1, "Errors"),
    "",
    "Exit code 2 means a wrong command or flag: read the message and the `--help` it suggests.",
    "Exit code 1 means the request failed and the message says why (for an invalid key, the user runs",
    "`scrapely login`). If it looks like a problem on Scrapely's side, offer to report it with",
    "`scrapely feedback send` (see its `--help`); never include keys, cookies or passwords in it.",
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
