// scrapely setup-agent: writes a Claude Code skill and an AGENTS.md block.
// Every run uses a throwaway HOME and working folder; nothing calls the API.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentGuide, withAgentsBlock, agentsBlock } from "../cli/agent-guide.js";
import { commands } from "../cli/registry.js";
import { runCli, tempHome } from "./helpers/run-cli.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// A fresh HOME and a fresh project folder for each test.
function setup() {
  const home = tempHome();
  const cwd = tempHome();
  return { home, cwd, run: (args) => runCli(["setup-agent", ...args], { home, cwd }) };
}

const userSkill = (home) => join(home, ".claude", "skills", "scrapely", "SKILL.md");
const agentsMd = (cwd) => join(cwd, "AGENTS.md");
const count = (text, part) => text.split(part).length - 1;

test("--print shows the skill with frontmatter and the key rules, and writes nothing", async () => {
  const { home, cwd, run } = setup();
  const { code, stdout } = await run(["--print", "--claude"]);
  assert.equal(code, 0);
  assert.match(stdout, /^---\nname: scrapely\ndescription: .*Scrapely.*campaigns.*leads.*webhooks.*\n---\n/);
  assert.match(stdout, /scrapely whoami/);
  assert.match(stdout, /scrapely login/);
  assert.match(stdout, /Never ask them to paste an API key/);
  assert.match(stdout, /--json/);
  assert.match(stdout, /scrapely <group> --help/);
  assert.match(stdout, /--yes/);
  assert.match(stdout, /explicitly\s+approve/);
  assert.match(stdout, /--profile <name>/);
  assert.match(stdout, /scrapely profiles list/);
  assert.match(stdout, /webhook key/);
  assert.match(stdout, /scrapely api/);
  assert.match(stdout, /scrapely feedback send/);
  assert.match(stdout, new RegExp(`v${version.replace(/\./g, "\\.")}`));
  assert.ok(stdout.split("\n").length < 150, "short enough for an agent's context");
  assert.equal(existsSync(userSkill(home)), false);
  assert.equal(existsSync(agentsMd(cwd)), false);

  const block = await run(["--print", "--agents-md"]);
  assert.match(block.stdout, /^<!-- scrapely:start -->\n## Scrapely CLI\n[\s\S]*\n<!-- scrapely:end -->\n$/);
  assert.doesNotMatch(block.stdout, /^---/);

  const both = await run(["--print"]);
  assert.match(both.stdout, /SKILL\.md \(Claude Code skill\)/);
  assert.match(both.stdout, /AGENTS\.md \(AGENTS\.md block\)/);
});

test("the command map covers every registry command and marks the ones that need --yes", () => {
  const guide = agentGuide(version);
  for (const command of commands) {
    const line = guide.split("\n").find((l) => l.startsWith(`- \`${command.cli.group}\``));
    assert.ok(line, `group ${command.cli.group} is listed`);
    const actions = line.split("): ").pop().split(", ");
    assert.ok(actions.includes(command.cli.action + (command.destructive ? "*" : "")), `${command.cli.group} ${command.cli.action}`);
  }
  assert.match(guide, /- Other: .*profiles \(list, use, remove\*\).*setup-agent/);
});

test("the guide covers the traps agents hit in trials", () => {
  const guide = agentGuide(version).replace(/\n\s*/g, " ");
  assert.match(guide, /scrapely whoami --json/);
  assert.match(guide, /If `source` is the SCRAPELY_API_KEY environment variable, tell the user/);
  assert.match(guide, /Run the command without `--yes` first, show the preview to the user/);
  assert.match(guide, /in an interactive terminal they ask `Continue\? \[y\/N\]` instead/);
  assert.match(guide, /`people search --count-only` is free and runs without `--yes`/);
  assert.match(guide, /`dm send`: reply from the account that owns the conversation/);
  assert.match(guide, /pass `--profile <name>` on every command until they switch/);
  assert.match(guide, /Don't run `profiles use` unless they ask/);
  assert.match(guide, /SCRAPELY_API_KEY environment variable beats the default profile/);
  assert.match(guide, /https:\/\/app\.scrapely\.co\/documentation/);
  assert.match(guide, /Exit code 2: a wrong command or flag .* or a `\*` command run without `--yes`/);
  assert.match(guide, /rejected SCRAPELY_API_KEY, they unset it/);
  // This version can't manage webhooks: point to the dashboard, don't promise a webhook key.
  assert.match(guide, /Webhooks can't be created from the CLI yet.*settings\/integrations/);
  assert.doesNotMatch(guide, /newly generated webhook key/);
});

test("writes the user-level skill and ./AGENTS.md with --yes, and says what it wrote", async () => {
  const { home, cwd, run } = setup();
  const { code, stdout } = await run(["--yes"]);
  assert.equal(code, 0);
  assert.match(stdout, /Created .*SKILL\.md/);
  assert.match(stdout, /Created .*AGENTS\.md/);
  assert.match(stdout, /Try asking your agent: 'show me my Scrapely campaigns'/);
  assert.match(readFileSync(userSkill(home), "utf8"), /^---\nname: scrapely\n/);
  assert.match(readFileSync(agentsMd(cwd), "utf8"), /^<!-- scrapely:start -->\n[\s\S]*<!-- scrapely:end -->\n$/);
  assert.equal(existsSync(join(cwd, ".claude")), false, "the skill goes to HOME unless --project");
});

test("--project puts the skill in the project; --claude / --agents-md pick one target", async () => {
  const { home, cwd, run } = setup();
  const project = await run(["--claude", "--project", "-y"]);
  assert.equal(project.code, 0);
  assert.ok(existsSync(join(cwd, ".claude", "skills", "scrapely", "SKILL.md")));
  assert.equal(existsSync(userSkill(home)), false);
  assert.equal(existsSync(agentsMd(cwd)), false);

  const only = await run(["--agents-md", "-y"]);
  assert.equal(only.code, 0);
  assert.ok(existsSync(agentsMd(cwd)));
  assert.equal(existsSync(userSkill(home)), false);
});

test("AGENTS.md: the block is added once, updated in place, and nothing else changes", async () => {
  const { cwd, run } = setup();
  writeFileSync(agentsMd(cwd), "# My project\n\nRun npm test before committing.\n");
  assert.equal((await run(["--agents-md", "--yes"])).code, 0);
  const first = readFileSync(agentsMd(cwd), "utf8");
  assert.ok(first.startsWith("# My project\n\nRun npm test before committing.\n\n<!-- scrapely:start -->"));

  // Stale block in the middle, with the user's own notes after it.
  const stale = first.replace(/<!-- scrapely:start -->[\s\S]*<!-- scrapely:end -->/, "<!-- scrapely:start -->\nold text\n<!-- scrapely:end -->") + "\n## Notes\nMine.\n";
  writeFileSync(agentsMd(cwd), stale);
  const again = await run(["--agents-md", "--yes"]);
  assert.equal(again.code, 0);
  assert.match(again.stdout, /Updated .*AGENTS\.md/);
  const second = readFileSync(agentsMd(cwd), "utf8");
  assert.equal(count(second, "<!-- scrapely:start -->"), 1);
  assert.equal(count(second, "<!-- scrapely:end -->"), 1);
  assert.doesNotMatch(second, /old text/);
  assert.ok(second.startsWith("# My project\n\nRun npm test before committing.\n\n<!-- scrapely:start -->\n## Scrapely CLI"));
  assert.ok(second.endsWith("<!-- scrapely:end -->\n\n## Notes\nMine.\n"));

  const third = await run(["--agents-md"]); // nothing to change: no question, no --yes needed
  assert.equal(third.code, 0);
  assert.match(third.stdout, /Already up to date/);
  assert.equal(readFileSync(agentsMd(cwd), "utf8"), second);
});

test("a SKILL.md the user wrote is never replaced without --force", async () => {
  const { home, run } = setup();
  mkdirSync(join(home, ".claude", "skills", "scrapely"), { recursive: true });
  writeFileSync(userSkill(home), "my own notes, custom\n");
  const refused = await run(["--claude", "--yes"]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /wasn't written by scrapely setup-agent, so it was left alone\. Move it away, or pass --force/);
  assert.equal(readFileSync(userSkill(home), "utf8"), "my own notes, custom\n");

  assert.equal((await run(["--claude", "--print"])).code, 0, "--print still works");
  const forced = await run(["--claude", "--yes", "--force"]);
  assert.equal(forced.code, 0);
  assert.match(readFileSync(userSkill(home), "utf8"), /^---\nname: scrapely\n/);

  // A file this command wrote (older version) is refreshed without --force.
  writeFileSync(userSkill(home), readFileSync(userSkill(home), "utf8").replace(/v\d+\.\d+\.\d+/, "v0.0.1"));
  const refresh = await run(["--claude", "--yes"]);
  assert.equal(refresh.code, 0);
  assert.match(refresh.stdout, /Updated .*SKILL\.md/);
});

test("withAgentsBlock refuses a file with only one marker", () => {
  const block = agentsBlock(version);
  assert.equal(withAgentsBlock("intro\n<!-- scrapely:start -->\nhalf", block), null);
  assert.equal(withAgentsBlock("<!-- scrapely:end -->\n", block), null);
  assert.equal(withAgentsBlock("no newline", block), `no newline\n\n${block}\n`);
});

test("withAgentsBlock keeps a CRLF file CRLF, and stays idempotent", () => {
  const block = agentsBlock(version);
  const once = withAgentsBlock("Line one\r\nLine two\r\n", block);
  assert.ok(once.startsWith("Line one\r\nLine two\r\n\r\n<!-- scrapely:start -->\r\n"));
  assert.doesNotMatch(once, /[^\r]\n/, "no bare LF line endings");
  assert.equal(withAgentsBlock(once, block), once);
});

test("without a terminal it refuses to write unless --yes, and lists the files", async () => {
  const { home, cwd, run } = setup();
  const { code, stdout, stderr } = await run([]);
  assert.equal(code, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /create\s+.*SKILL\.md/);
  assert.match(stderr, /create\s+.*AGENTS\.md/);
  assert.match(stderr, /Re-run with --yes/);
  assert.doesNotMatch(stderr, /--help/);
  assert.equal(existsSync(userSkill(home)), false);
  assert.equal(existsSync(agentsMd(cwd)), false);
});

test("a broken AGENTS.md (one marker) is left alone", async () => {
  const { cwd, run } = setup();
  const broken = "# Mine\n<!-- scrapely:start -->\nno end marker\n";
  writeFileSync(agentsMd(cwd), broken);
  const { code, stderr } = await run(["--agents-md", "--yes"]);
  assert.equal(code, 1);
  assert.match(stderr, /only one of the/);
  assert.equal(readFileSync(agentsMd(cwd), "utf8"), broken);
});

test("setup-agent shows in --help and has its own help", async () => {
  const root = await runCli(["--help"]);
  assert.match(root.stdout, /\n {2}setup-agent\s+Teach your AI agent/);
  for (const args of [["setup-agent", "--help"], ["help", "setup-agent"]]) {
    const { code, stdout } = await runCli(args);
    assert.equal(code, 0);
    assert.match(stdout, /--agents-md/);
    assert.match(stdout, /--project/);
  }
  const bad = await runCli(["setup-agent", "--claud"]);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /Did you mean --claude\?/);
});
