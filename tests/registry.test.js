import { test } from "node:test";
import assert from "node:assert/strict";
import { tools } from "../tools.js";
import { GROUPS } from "../cli/registry.js";

test("there are 55 tools", () => {
  assert.equal(tools.length, 55);
});

test("every tool has a unique `scrapely <group> <action>` command", () => {
  const seen = new Map();
  for (const tool of tools) {
    assert.ok(tool.cli, `${tool.name} has no cli mapping`);
    assert.match(tool.cli.group, /^[a-z][a-z-]*$/, `${tool.name} group`);
    assert.match(tool.cli.action, /^[a-z][a-z-]*$/, `${tool.name} action`);
    const command = `${tool.cli.group} ${tool.cli.action}`;
    assert.ok(!seen.has(command), `${command} is used by both ${seen.get(command)} and ${tool.name}`);
    seen.set(command, tool.name);
  }
});

test("every group has a summary for scrapely --help", () => {
  for (const tool of tools) assert.ok(GROUPS[tool.cli.group], `no GROUPS entry for ${tool.cli.group}`);
});

test("exactly the tools that send, spend, launch, pause, delete or overwrite ask first", () => {
  const destructive = tools.filter((t) => t.destructive).map((t) => t.name).sort();
  assert.deepEqual(destructive, [
    "add_lead_source_to_campaign", "add_leads_to_campaign", "cancel_scheduled_tweet", "create_scraping_source",
    "edit_campaign", "enrich_email", "enrich_twitter", "launch_campaign", "launch_import_campaign", "pause_campaign",
    "remove_account", "remove_listener", "remove_webhook", "schedule_tweet", "search_people", "send_dm", "set_account_tags",
    "toggle_followups_pause", "toggle_pause", "toggle_warmup", "update_listener", "update_webhook_key", "update_webhook_settings",
  ]);
});

test("pause commands pause by default, and resume commands exist", async () => {
  const { findTool } = await import("../cli/registry.js");
  const { parseToolArgs } = await import("../cli/args.js");
  const pause = findTool("campaigns", "pause");
  assert.equal((await parseToolArgs(pause, ["--campaign-name", "X"], "t")).args.is_paused, true);
  assert.equal((await parseToolArgs(pause, ["--campaign-name", "X", "--no-is-paused"], "t")).args.is_paused, false);

  const sent = [];
  const call = async (...req) => sent.push(req);
  for (const [group, action, key] of [["campaigns", "resume", "is_paused"], ["accounts", "resume", "is_paused"], ["accounts", "resume-followups", "followups_paused"]]) {
    const command = findTool(group, action);
    assert.ok(command, `${group} ${action}`);
    assert.ok(command.destructive);
    assert.ok(!(key in command.inputs), `${key} is fixed, not a flag`);
    const flags = group === "campaigns" ? ["--campaign-name", "X"] : ["--account-id", "a1"];
    const { args } = await parseToolArgs(command, flags, "t");
    await command.run(args, call);
    assert.equal(sent.at(-1)[2][key], false);
  }
});

test("every help example parses (apart from files and placeholders)", async () => {
  const { commands, commandName } = await import("../cli/registry.js");
  const { commandHelp } = await import("../cli/help.js");
  const { parseToolArgs } = await import("../cli/args.js");
  for (const command of commands) {
    const line = commandHelp(command).split("Example\n")[1].split("\n")[0].trim();
    const words = line.match(/"[^"]*"|\S+/g).map((w) => w.replace(/^"|"$/g, "")).slice(3);
    if (words.some((w) => w.startsWith("@") || w === "--file-path")) continue; // reads a file
    const name = commandName(command);
    await assert.doesNotReject(parseToolArgs(command, words, name), `${name}: ${line}`);
  }
});
