// scrapely setup-agent: teaches the user's AI agent to use this CLI, with no copy-paste.
//   Claude Code: <home or project>/.claude/skills/scrapely/SKILL.md
//   AGENTS.md (Codex, Cursor and others): a delimited block in ./AGENTS.md

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { agentsBlock, skillFile, withAgentsBlock, AGENTS_END, AGENTS_START, WRITTEN_BY } from "./agent-guide.js";
import { parseFlags } from "./args.js";
import { CliError, UsageError } from "./errors.js";
import { confirm } from "./prompt.js";
import { colors } from "./style.js";

const OPTIONS = {
  claude: { type: "boolean" },
  "agents-md": { type: "boolean" },
  project: { type: "boolean" },
  print: { type: "boolean" },
  force: { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  json: { type: "boolean" },
  debug: { type: "boolean" },
};

const readText = (file) => (existsSync(file) ? readFileSync(file, "utf8") : null);

// [{ kind, file, label, before, after, content }] for the chosen targets:
// `after` is the whole new file, `content` is what --print shows.
function plan(values, version) {
  const both = !values.claude && !values["agents-md"];
  const targets = [];
  if (both || values.claude) {
    const base = values.project ? process.cwd() : process.env.HOME || homedir();
    const file = join(base, ".claude", "skills", "scrapely", "SKILL.md");
    const content = skillFile(version);
    const before = readText(file);
    // Someone's own SKILL.md (no WRITTEN_BY line) is only replaced on request.
    if (before !== null && !before.includes(WRITTEN_BY) && !values.force && !values.print) {
      throw new CliError(`${file} wasn't written by scrapely setup-agent, so it was left alone. Move it away, or pass --force to replace it (--print shows the new text).`);
    }
    targets.push({ kind: "claude", file, label: "Claude Code skill", before, after: content, content });
  }
  if (both || values["agents-md"]) {
    const file = resolve("AGENTS.md");
    const before = readText(file);
    const block = agentsBlock(version);
    const after = withAgentsBlock(before || "", block);
    if (after === null) {
      throw new CliError(`${file} has only one of the ${AGENTS_START} / ${AGENTS_END} markers. Fix or remove it, then run this again.`);
    }
    targets.push({ kind: "agents-md", file, label: "AGENTS.md block", before, after, content: block + "\n" });
  }
  return targets;
}

const verb = (t) => (t.before === null ? "create" : t.before === t.after ? "unchanged" : "update");

function printOnly(targets) {
  if (targets.length === 1) return process.stdout.write(targets[0].content);
  process.stdout.write(targets.map((t) => `==> ${t.file} (${t.label}) <==\n${t.content}`).join("\n"));
}

export async function runSetupAgent(argv, { version }) {
  const { values, positionals } = parseFlags(argv, OPTIONS, "setup-agent");
  if (positionals.length) throw new UsageError(`Unexpected argument "${positionals[0]}".`, "setup-agent");

  const targets = plan(values, version);
  if (values.print) return printOnly(targets);

  const c = colors(process.stdout);
  const changes = targets.filter((t) => verb(t) !== "unchanged");
  if (changes.length === 0) {
    process.stdout.write(`Already up to date:\n${targets.map((t) => `  ${t.file}`).join("\n")}\n`);
    return;
  }

  const lines = changes.map((t) => `  ${verb(t).padEnd(7)} ${t.file}${t.before !== null && t.kind === "agents-md" ? " (only the Scrapely block)" : ""}`);
  await confirm(`${colors(process.stderr).yellow("About to write")} instructions for your AI agent:\n${lines.join("\n")}`, { yes: values.yes, commandName: "setup-agent" });

  for (const t of changes) {
    mkdirSync(dirname(t.file), { recursive: true });
    writeFileSync(t.file, t.after);
  }
  const done = changes.map((t) => `  ${t.before === null ? "Created" : "Updated"} ${t.file} (${t.label})`);
  process.stdout.write(`${c.green("Done.")}\n${done.join("\n")}\n\n`);
  if (changes.some((t) => t.kind === "claude")) process.stdout.write("Start a new Claude Code session to load the skill.\n");
  process.stdout.write(`Try asking your agent: ${c.cyan("'show me my Scrapely campaigns'")}\n`);
}
