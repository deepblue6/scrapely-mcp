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

test("tools that send, spend or remove are marked destructive", () => {
  const destructive = tools.filter((t) => t.destructive).map((t) => t.name);
  for (const name of ["send_dm", "launch_campaign", "launch_import_campaign", "pause_campaign", "remove_account",
    "remove_listener", "schedule_tweet", "cancel_scheduled_tweet", "enrich_email", "enrich_twitter", "search_people",
    "add_leads_to_campaign", "add_lead_source_to_campaign"]) {
    assert.ok(destructive.includes(name), `${name} should be destructive`);
  }
  for (const name of ["list_accounts", "list_campaigns", "get_campaign_detail", "get_crm_data"]) {
    assert.ok(!destructive.includes(name), `${name} should not ask for confirmation`);
  }
});
