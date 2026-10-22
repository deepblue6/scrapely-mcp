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
