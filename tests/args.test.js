import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tools } from "../tools.js";
import { parseToolArgs } from "../cli/args.js";
import { UsageError } from "../cli/errors.js";
import { describeField, toFlag } from "../cli/schema.js";

const tool = (name) => tools.find((t) => t.name === name);
const parse = (name, argv) => parseToolArgs(tool(name), argv, "test");

async function usageError(promise, pattern) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof UsageError, `expected UsageError, got ${err}`);
    assert.match(err.message, pattern);
    return true;
  });
}

test("flag names are kebab-case of input keys", () => {
  assert.equal(toFlag("campaign_name"), "campaign-name");
  assert.equal(toFlag("firstName"), "first-name");
  assert.equal(toFlag("id"), "id");
});

test("field kinds come from the zod types", () => {
  const launch = tool("launch_campaign").inputs;
  assert.equal(describeField("name", launch.name).kind, "string");
  assert.equal(describeField("max_leads", launch.max_leads).kind, "number");
  assert.equal(describeField("enable_follow", launch.enable_follow).kind, "boolean");
  assert.equal(describeField("send_days", launch.send_days).itemKind, "number");
  assert.equal(describeField("followups", launch.followups).kind, "json");
  assert.deepEqual(describeField("status", tool("list_scheduled_tweets").inputs.status).values, ["pending", "posted", "failed"]);
});

test("strings and numbers", async () => {
  const { args } = await parse("list_campaigns", ["--limit", "5", "--offset=10"]);
  assert.deepEqual(args, { limit: 5, offset: 10 });
  await usageError(parse("list_campaigns", ["--limit", "ten"]), /--limit must be a number/);
});

test("camelCase inputs get kebab flags", async () => {
  const { args } = await parse("enrich_twitter", ["--first-name", "Ada", "--last-name", "Lovelace", "--company-name", "Acme"]);
  assert.deepEqual(args, { firstName: "Ada", lastName: "Lovelace", companyName: "Acme" });
});

test("booleans: --flag, --no-flag, --flag=false", async () => {
  assert.equal((await parse("pause_campaign", ["--campaign-name", "X", "--is-paused"])).args.is_paused, true);
  assert.equal((await parse("pause_campaign", ["--campaign-name", "X", "--no-is-paused"])).args.is_paused, false);
  assert.equal((await parse("pause_campaign", ["--campaign-name", "X", "--is-paused=false"])).args.is_paused, false);
  await usageError(parse("pause_campaign", ["--campaign-name", "X"]), /--is-paused or --no-is-paused is required/);
});

test("enums are validated and list the allowed values", async () => {
  assert.equal((await parse("list_scheduled_tweets", ["--status", "posted"])).args.status, "posted");
  await usageError(parse("list_scheduled_tweets", ["--status", "sent"]), /one of: pending, posted, failed/);
});

test("lists: repeated flags and commas", async () => {
  const { args } = await parse("set_account_tags", ["--account-id", "a1", "--tags", "vip, warm", "--tags", "new"]);
  assert.deepEqual(args.tags, ["vip", "warm", "new"]);
  const days = await parse("edit_campaign", ["--campaign-name", "X", "--send-days", "1,2,3"]);
  assert.deepEqual(days.args.send_days, [1, 2, 3]);
  const handles = await parse("add_leads_to_campaign", ["--campaign-name", "X", "--twitter-handles", "@jack,naval"]);
  assert.deepEqual(handles.args.twitter_handles, ["@jack", "naval"]);
});

test("JSON values: inline and @file", async () => {
  const inline = await parse("update_cookies", ["--account-id", "a1", "--cookies", '[{"name":"ct0","value":"v","domain":".x.com"}]']);
  assert.equal(inline.args.cookies[0].name, "ct0");

  const dir = mkdtempSync(join(tmpdir(), "scrapely-args-"));
  const file = join(dir, "leads.json");
  writeFileSync(file, JSON.stringify([{ twitter_handle: "jack", custom_fields: { company: "Acme" } }]));
  const fromFile = await parse("add_leads_to_campaign", ["--campaign-name", "X", "--leads", `@${file}`]);
  assert.equal(fromFile.args.leads[0].custom_fields.company, "Acme");

  await usageError(parse("update_cookies", ["--account-id", "a1", "--cookies", "{nope"]), /--cookies must be JSON/);
  await usageError(parse("update_cookies", ["--account-id", "a1", "--cookies", "@/does/not/exist.json"]), /couldn't read/);
});

test("nested JSON is validated with per-field paths", async () => {
  const bad = JSON.stringify([{ message: "hi", followups: [{ wait_time: 1, wait_unit: "fortnights", message: "x" }] }]);
  await usageError(parse("edit_campaign", ["--campaign-name", "X", "--message-variants", bad]),
    /--message-variants\[0\]\.followups\[0\]\.wait_unit/);
});

test("nullable fields can be cleared with --no-<flag>", async () => {
  const { args } = await parse("update_crm", ["--conversation-id", "c1", "--account-handle", "me", "--no-tag"]);
  assert.equal(args.tag, null);
});

test("required fields, unknown flags and stray arguments are usage errors", async () => {
  await usageError(parse("get_campaign_detail", []), /--campaign-name is required/);
  await usageError(parse("get_campaign_detail", ["--campain-name", "X"]), /Did you mean --campaign-name\?/);
  await usageError(parse("get_campaign_detail", ["October"]), /Unexpected argument "October"/);
  await usageError(parse("list_campaigns", ["--limit"]), /--limit needs a value/);
});

test("global flags are picked up anywhere", async () => {
  const { globals } = await parse("list_campaigns", ["--json", "-y", "--limit", "1"]);
  assert.equal(globals.json, true);
  assert.equal(globals.yes, true);
});
