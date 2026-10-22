// Renders API results for people: tables for lists, aligned key/value blocks
// for single records. --json skips all of this and prints the raw data.

import { colors, displayWidth, padEnd, stripControl, terminalWidth, truncate } from "./style.js";

// Columns to show for known lists, by the key the API returns the list under.
// Only columns present in the data are shown; unknown lists get automatic columns.
const COLUMN_PRESETS = {
  accounts: ["handle", "name", "id", "account_id", "jobs", "is_paused", "warmup_paused", "dms_sent", "tags"],
  campaigns: ["name", "total", "completed", "pending", "replies", "progress", "is_paused"],
  scraping_sources: ["id", "name", "status", "leads_imported", "progress", "created_at"],
  leads: ["twitter_handle", "name", "status", "account_handle", "replied", "followers_count", "location"],
  conversations: ["conversation_id", "account_handle", "receiver.screen_name", "last_message.text", "is_unread", "updated_at"],
  scheduled_tweets: ["id", "account_handle", "status", "scheduled_at", "tweet_text"],
  listeners: ["id", "target_handle", "listen_followers", "listen_following", "is_active", "last_error"],
  events: ["event", "detected_at", "target_handle", "user.screen_name", "user.name", "user.followers_count"],
};

const LABELS = {
  is_paused: "PAUSED",
  warmup_paused: "WARMUP PAUSED",
  "receiver.screen_name": "LEAD",
  "last_message.text": "LAST MESSAGE",
  "user.screen_name": "PERSON",
  "user.followers_count": "FOLLOWERS",
};

// Columns people copy into the next command (IDs, handles): never cut short.
const isIdentifier = (path, key) => /(^|[._])id$|handle$|screen_name$/.test(path) || (key === "campaigns" && path === "name");

const AUTO_FIRST = ["id", "name", "handle", "twitter_handle", "status"];
const MAX_AUTO_COLUMNS = 8;
const MAX_COLUMN_WIDTH = 50;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isScalar = (v) => v === null || typeof v !== "object";
const isScalarList = (v) => Array.isArray(v) && v.every(isScalar);
const isObjectList = (v) => Array.isArray(v) && v.every(isPlainObject);

function get(row, path) {
  return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), row);
}

function label(path) {
  if (LABELS[path]) return LABELS[path];
  return stripControl(path.split(".").pop().replace(/^is_/, "").replace(/_/g, " ").toUpperCase());
}

// One value as short, readable text.
function formatValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    return value.slice(0, 16).replace("T", " ");
  }
  if (Array.isArray(value)) return value.length ? value.map(formatValue).join(", ") : "-";
  if (typeof value === "object") return stripControl(JSON.stringify(value));
  return stripControl(value);
}

function pickColumns(rows, key) {
  const has = (path) => rows.some((row) => get(row, path) !== undefined);
  const preset = (COLUMN_PRESETS[key] || []).filter(has);
  if (preset.length >= 2) return preset;

  const keys = [];
  for (const row of rows.slice(0, 20)) {
    for (const [k, v] of Object.entries(row)) {
      if (!keys.includes(k) && (isScalar(v) || isScalarList(v))) keys.push(k);
    }
  }
  const first = AUTO_FIRST.filter((k) => keys.includes(k));
  return [...first, ...keys.filter((k) => !first.includes(k))].slice(0, MAX_AUTO_COLUMNS);
}

const sum = (list) => list.reduce((a, b) => a + b, 0);

// Narrows the widest column (never below its minimum) until the total fits.
function shrink(widths, minimum, available) {
  while (sum(widths) > available) {
    const room = widths.map((w, i) => (w > minimum[i] ? w : -1));
    const widest = room.indexOf(Math.max(...room));
    if (room[widest] < 0) return;
    widths[widest]--;
  }
}

// Which columns to show, and how wide, to fit the terminal.
// Descriptive columns shrink first; if that isn't enough the rightmost ones are dropped.
// Identifier columns keep their full width (a line may wrap rather than cut an ID).
function layout(header, cells, ids, available) {
  const natural = header.map((h, i) => {
    const width = Math.max(displayWidth(h), ...cells.map((r) => displayWidth(r[i])));
    return ids[i] ? width : Math.min(MAX_COLUMN_WIDTH, width);
  });
  const shown = header.map((_, i) => i);

  for (;;) {
    const widths = shown.map((i) => natural[i]);
    const room = available - 2 * (shown.length - 1);
    // The longest columns give way first; headers are only cut if that isn't enough.
    shrink(widths, shown.map((i) => (ids[i] ? natural[i] : Math.max(6, displayWidth(header[i])))), room);
    shrink(widths, shown.map((i) => (ids[i] ? natural[i] : 6)), room);
    const drop = shown.findLastIndex((i, n) => n > 0 && !ids[i]);
    if (sum(widths) <= room || drop < 0 || shown.length <= 2) return { shown, widths };
    shown.splice(drop, 1);
  }
}

export function renderTable(rows, key, { indent = "", c = colors(process.stdout) } = {}) {
  const columns = pickColumns(rows, key);
  if (columns.length === 0) return rows.map((row) => indent + stripControl(JSON.stringify(row))).join("\n");

  const header = columns.map(label);
  const cells = rows.map((row) => columns.map((col) => formatValue(get(row, col)).replace(/\s+/g, " ")));
  const ids = columns.map((col) => isIdentifier(col, key));
  const { shown, widths } = layout(header, cells, ids, terminalWidth() - indent.length);

  const line = (values, style = (s) => s) =>
    indent + shown.map((col, n) => {
      const text = truncate(values[col], widths[n]);
      return style(n === shown.length - 1 ? text : padEnd(text, widths[n]));
    }).join("  ");

  const out = [line(header, c.bold), ...cells.map((r) => line(r))];
  const hidden = columns.length - shown.length;
  if (hidden) out.push(c.dim(`${indent}(+${hidden} column${hidden === 1 ? "" : "s"}: see --json)`));
  return out.join("\n");
}

function renderDetail(obj, { indent = "", c }) {
  const entries = Object.entries(obj);
  const pad = Math.max(0, ...entries.filter(([, v]) => isScalar(v) || isScalarList(v)).map(([k]) => k.length));
  const lines = [];
  for (const [key, value] of entries) {
    if (isScalar(value) || isScalarList(value)) {
      const text = formatValue(value).replace(/\n/g, `\n${indent}${" ".repeat(pad + 2)}`);
      lines.push(`${indent}${c.dim(stripControl(key).padEnd(pad))}  ${text}`);
    } else if (isPlainObject(value)) {
      lines.push(`${indent}${c.bold(stripControl(key))}`);
      lines.push(renderDetail(value, { indent: indent + "  ", c }));
    } else if (isObjectList(value)) {
      lines.push(`${indent}${c.bold(stripControl(key))} ${c.dim(`(${value.length})`)}`);
      if (value.length) lines.push(renderTable(value, key, { indent: indent + "  ", c }));
    } else {
      lines.push(`${indent}${c.bold(stripControl(key))}`);
      lines.push(indent + "  " + stripControl(JSON.stringify(value)));
    }
  }
  return lines.join("\n");
}

function paginationNote(p) {
  if (!isPlainObject(p)) return "";
  const shown = p.count ?? null;
  const parts = [];
  if (p.total !== undefined && shown !== null) {
    const start = (p.offset || 0) + (shown ? 1 : 0);
    parts.push(`Showing ${start}-${(p.offset || 0) + shown} of ${p.total}.`);
  }
  if (p.has_more && p.offset !== undefined) parts.push(`Next page: --offset ${(p.offset || 0) + (shown ?? p.limit ?? 0)}`);
  else if (p.next_cursor) parts.push(`Next page: --cursor ${p.next_cursor}`);
  return parts.join(" ");
}

// The single list in a response like { campaigns: [...], pagination: {...} }, if that's its shape.
function findMainList(obj) {
  const lists = Object.keys(obj).filter((k) => isObjectList(obj[k]));
  if (lists.length !== 1) return null;
  const others = Object.entries(obj).filter(([k]) => k !== lists[0] && k !== "pagination" && k !== "next_cursor");
  return others.every(([, v]) => isScalar(v) || isScalarList(v)) ? lists[0] : null;
}

const isEmpty = (v) => (Array.isArray(v) ? v.length === 0 : isPlainObject(v) && Object.keys(v).length === 0);

export function render(data, { c = colors(process.stdout) } = {}) {
  if (isEmpty(data)) return "No results.";
  if (isScalar(data)) return formatValue(data);
  if (isScalarList(data)) return data.map(formatValue).join("\n");
  if (isObjectList(data)) return renderTable(data, "", { c });

  const listKey = findMainList(data);
  if (!listKey) return renderDetail(data, { c });

  const { [listKey]: rows, pagination, next_cursor, ...rest } = data;
  const parts = [];
  const title = listKey.replace(/_/g, " ");
  if (Object.keys(rest).length) parts.push(renderDetail(rest, { c }), "", c.bold(title[0].toUpperCase() + title.slice(1)));
  parts.push(rows.length ? renderTable(rows, listKey, { c }) : `No ${title} found.`);
  // The cursor can sit next to the pagination object rather than inside it.
  const note = paginationNote(pagination || next_cursor ? { ...pagination, ...(next_cursor ? { next_cursor } : {}) } : null);
  if (note && rows.length) parts.push(c.dim(note));
  return parts.join("\n");
}

// --json: raw data, pretty-printed (still valid JSON when piped).
export function printResult(data, { json } = {}) {
  const text = json ? JSON.stringify(data, null, 2) : render(data);
  process.stdout.write(text + "\n");
}
