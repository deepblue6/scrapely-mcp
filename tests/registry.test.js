import { test } from "node:test";
import assert from "node:assert/strict";
import { tools } from "../tools.js";
import { GROUPS } from "../cli/registry.js";

test("there are 48 tools", () => {
  assert.equal(tools.length, 48);
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
    "remove_account", "remove_listener", "schedule_tweet", "search_people", "send_dm", "set_account_tags",
    "toggle_followups_pause", "toggle_pause", "toggle_warmup", "update_listener",
  ]);
});
