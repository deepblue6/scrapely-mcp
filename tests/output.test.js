import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "../cli/output.js";

const plain = Object.fromEntries(["bold", "dim", "red", "green", "yellow", "cyan"].map((n) => [n, (s) => String(s)]));
const show = (data) => render(data, { c: plain });

test("lists become tables with the preset columns", () => {
  process.env.COLUMNS = "200";
  const out = show({
    campaigns: [{ name: "Launch", total: 10, completed: 4, pending: 6, replies: 1, progress: 40, is_paused: false, created_at: "2026-01-01T10:00:00Z" }],
    pagination: { limit: 20, offset: 0, count: 1, total: 1 },
  });
  const [header, row, , note] = out.split("\n");
  assert.match(header, /^NAME\s+TOTAL\s+COMPLETED\s+PENDING\s+REPLIES\s+PROGRESS\s+PAUSED$/);
  assert.match(row, /^Launch\s+10\s+4\s+6\s+1\s+40\s+no$/);
  assert.equal(note, undefined);
  assert.match(out, /Showing 1-1 of 1\./);
});

test("nested columns, dates and booleans read naturally", () => {
  process.env.COLUMNS = "200";
  const out = show({
    conversations: [{ conversation_id: "c1", account_handle: "me", receiver: { screen_name: "jack" }, last_message: { text: "hey\nthere" }, is_unread: true, updated_at: "2026-10-12T15:04:05Z" }],
  });
  assert.match(out, /LEAD/);
  assert.match(out, /jack/);
  assert.match(out, /hey there/);
  assert.match(out, /2026-10-12 15:04/);
  assert.match(out, /yes/);
});

test("long cells are truncated to the terminal width", () => {
  process.env.COLUMNS = "50";
  const out = show({ scheduled_tweets: [{ id: "t1", account_handle: "me", status: "pending", scheduled_at: "2026-10-12T15:04:05Z", tweet_text: "x".repeat(200) }] });
  for (const line of out.split("\n")) assert.ok(line.length <= 50, `too wide: ${line.length}`);
  assert.match(out, /…/);
});

test("unknown list shapes get automatic columns", () => {
  process.env.COLUMNS = "200";
  const out = show({ things: [{ zeta: 1, id: "a", name: "First", nested: { x: 1 } }] });
  assert.match(out.split("\n")[0], /^ID\s+NAME\s+ZETA$/);
});

test("empty lists say so", () => {
  assert.equal(show({ accounts: [] }), "No accounts found.");
});

test("single records render as aligned key/value lines", () => {
  const out = show({ success: true, message: "Campaign paused", settings: { send_days: [1, 2] } });
  assert.match(out, /^success\s+yes$/m);
  assert.match(out, /^message\s+Campaign paused$/m);
  assert.match(out, /^settings$/m);
  assert.match(out, /^ {2}send_days\s+1, 2$/m);
});

test("a cursor next to the pagination object is shown as the next page", () => {
  process.env.COLUMNS = "200";
  const out = show({
    conversations: [{ conversation_id: "c1", account_handle: "me", receiver: { screen_name: "bob" }, last_message: { text: "hi" }, is_unread: true }],
    pagination: { limit: 20, count: 1, has_more: true },
    next_cursor: "CUR123",
  });
  assert.match(out, /Next page: --cursor CUR123/);
});

test("empty top-level arrays and objects say so", () => {
  assert.equal(show([]), "No results.");
  assert.equal(show({}), "No results.");
});

test("control characters from API text never reach the terminal", () => {
  process.env.COLUMNS = "200";
  const evil = "hi \u001b[31mred\u001b[0m \u001b]0;title\u0007 \u009b";
  for (const out of [show([{ id: 1, text: evil }]), show({ message: evil }), show({ [`k\u001b[2J`]: 1 })]) {
    assert.doesNotMatch(out, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
  }
});

test("emoji are never cut in half and columns stay aligned", () => {
  process.env.COLUMNS = "40";
  const out = show([{ id: 1, name: "😀".repeat(40) }, { id: 2, name: "plain" }]);
  assert.doesNotMatch(out, /�|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  assert.match(out, /😀…$/m);
});

test("IDs, handles and campaign names are never truncated", () => {
  process.env.COLUMNS = "80";
  const id = "3f2b8c1e-9a7d-4e21-b6c5-1d2e3f4a5b6c";
  const accounts = show({ accounts: [{ handle: "acme_sales_team_main", name: "Acme Sales Team Main Account", id, is_paused: false, warmup_paused: true, dms_sent: 1234, tags: ["main", "agency", "q4"] }] });
  assert.match(accounts, /acme_sales_team_main/);
  assert.match(accounts, new RegExp(id));
  for (const line of accounts.split("\n")) assert.ok(line.length <= 80, `too wide: ${line}`);

  const campaigns = show({ campaigns: [{ name: "October SaaS founders outreach - wave 2 (EU)", total: 1, completed: 1, pending: 0, replies: 0, progress: 100, is_paused: false }] });
  assert.match(campaigns, /October SaaS founders outreach - wave 2 \(EU\)/);
});

test("wide tables drop trailing columns instead of overflowing", () => {
  process.env.COLUMNS = "40";
  const row = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`field_${i}`, `value ${i}`]));
  const out = show([{ id: "x1", ...row }]);
  for (const line of out.split("\n")) assert.ok(line.length <= 40, `too wide: ${line.length}`);
  assert.match(out, /\(\+\d+ columns?: see --json\)/);
});

test("a list under a summary gets a heading and keeps its extra columns", () => {
  process.env.COLUMNS = "200";
  const out = show({ success: true, campaign_name: "Launch", jobs_created: 250, distribution: [{ account_id: "a1", handle: "acme", jobs: 250 }] });
  assert.match(out, /^Distribution$/m);
  assert.match(out, /JOBS/);
  const accounts = show({ success: true, accounts: [{ account_id: "a1", handle: "acme", jobs: 250 }] });
  assert.match(accounts, /JOBS/);
});

test("webhook lists show the key preview, \"none\" without a key, and whole URLs", () => {
  process.env.COLUMNS = "40";
  const url = "https://hooks.example.com/" + "p".repeat(60);
  const out = show({ webhooks: [{ url, has_key: true, key_preview: "…abcd" }, { url: "https://a.example", has_key: false, key_preview: null }] });
  assert.match(out.split("\n")[0], /^URL\s+KEY$/);
  assert.ok(out.includes(url));
  assert.match(out, /https:\/\/a\.example\s+none/);
  assert.match(out, /…abcd/);
});
