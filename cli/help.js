// Help text, generated from the tool registry (descriptions + zod .describe()).

import { describeInputs } from "./schema.js";
import { BUILTINS, GROUPS, commandName, groupNames, groupTools } from "./registry.js";
import { colors, terminalWidth, wrap } from "./style.js";
import { cliText, fieldText, findWith } from "./wording.js";

const GLOBAL_FLAGS = [
  ["--json", "Print raw JSON instead of tables"],
  ["-y, --yes", "Don't ask \"Continue?\" before commands that change things"],
  ["--debug", "Show technical details when something fails"],
  ["-h, --help", "Show help"],
];

const width = () => Math.min(terminalWidth(), 100);

function firstSentence(text) {
  // Split at ". " + capital letter, so "e.g. a CSV" stays in one piece.
  return text.split(/(?<=\.)\s+(?=[A-Z])/)[0].replace(/\.$/, "");
}

// Two-column rows: name on the left, wrapped text on the right.
function rows(items, c, nameWidth = 0) {
  const col = Math.min(34, Math.max(nameWidth, ...items.map(([name]) => name.length)) + 2);
  return items.map(([name, text, extra = []]) => {
    const body = [text, ...extra].filter(Boolean).map((t) => wrap(t, width(), " ".repeat(col + 2)).trimStart());
    const left = `  ${c.cyan(name)}`;
    if (body.length === 0) return left;
    const gap = name.length + 2 > col ? `\n${" ".repeat(col + 2)}` : " ".repeat(col - name.length);
    return left + gap + body.join(`\n${" ".repeat(col + 2)}`);
  }).join("\n");
}

function placeholder(field) {
  if (field.kind === "number") return "<number>";
  if (field.kind === "enum") return "<value>";
  if (field.kind === "list") return field.itemKind === "number" ? "<n,n,...>" : "<a,b,...>";
  if (field.kind === "json") return "<json>";
  return "<text>";
}

function flagUsage(field) {
  if (field.kind === "boolean") return `--[no-]${field.flag}`;
  return `--${field.flag} ${placeholder(field)}`;
}

// A small JSON skeleton of what an object/array flag expects.
function sampleJson(schema) {
  const def = schema._def;
  switch (def.typeName) {
    case "ZodOptional": case "ZodNullable": case "ZodDefault": return sampleJson(def.innerType);
    case "ZodObject": return Object.fromEntries(Object.entries(def.shape()).map(([k, v]) => [k, sampleJson(v)]));
    case "ZodArray": return [sampleJson(def.type)];
    case "ZodRecord": return { column: "value" };
    case "ZodUnion": return sampleJson(def.options[0]);
    case "ZodEnum": return def.values[0];
    case "ZodNumber": return 1;
    case "ZodBoolean": return true;
    default: return "text";
  }
}

function fieldNotes(field, schema, tool) {
  const notes = [];
  const found = findWith(field, tool);
  if (found) notes.push(found);
  if (field.kind === "boolean" && !fieldText(field).includes(`--${field.flag}`)) {
    notes.push(`--${field.flag} for yes, --no-${field.flag} for no`);
  }
  if (field.kind === "enum") notes.push(`One of: ${field.values.join(", ")}`);
  if (field.kind === "list") notes.push(`Repeat the flag or separate with commas (for a value with a comma: '["a, b"]')`);
  if (field.kind === "json") {
    notes.push("JSON text, @file.json, or - to read from stdin");
    notes.push(`Shape: ${JSON.stringify(sampleJson(schema)).replace(/,/g, ", ")}`);
  }
  if (field.nullable && field.kind !== "boolean") notes.push(`--no-${field.flag} clears it`);
  if (field.defaultValue !== undefined) {
    const shown = field.kind === "boolean" ? `--${field.defaultValue ? "" : "no-"}${field.flag}` : JSON.stringify(field.defaultValue);
    notes.push(`Default: ${shown}`);
  }
  return notes;
}

// A week from now at 09:00 UTC, for fields that must be in the future.
function futureTimestamp() {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return `${date.toISOString().slice(0, 10)}T09:00:00Z`;
}

function exampleValue(field, tool) {
  const key = field.key.toLowerCase();
  switch (field.kind) {
    case "number": return "10";
    case "enum": return field.values[0];
    case "list":
      if (field.itemKind === "number") return "1,2,3";
      return key.includes("handle") ? "jack,naval" : `<${field.flag.replace(/s$/, "")}>`;
    case "json": return "@data.json";
    default:
      if (key === "id") return `<${tool.cli.group.replace(/s$/, "")}-id>`;
      if (key.endsWith("_id")) return `<${field.flag}>`;
      if (key.includes("handle")) return "jack";
      if (key === "proxy_auth") return "user:pass";
      if (key === "proxy") return "http://1.2.3.4:8080";
      if (key.includes("pin")) return "1234";
      if (key === "scheduled_at") return futureTimestamp();
      if (key.includes("date") || key.endsWith("_at") || key === "since" || key === "until") return "2026-01-01";
      if (key.includes("name")) return '"My campaign"';
      return '"..."';
  }
}

function example(tool, fields) {
  if (tool.cli.example) return `scrapely ${commandName(tool)} ${tool.cli.example}`;
  const required = fields.filter((f) => !f.optional);
  const parts = required.map((f) => (f.kind === "boolean" ? `--${f.flag}` : `--${f.flag} ${exampleValue(f, tool)}`));
  return `scrapely ${commandName(tool)} ${parts.join(" ")}`.trim();
}

export function rootHelp(version) {
  const c = colors(process.stdout);
  const groups = groupNames().map((g) => [g, GROUPS[g] || groupTools(g).map((t) => t.cli.action).join(", ")]);
  return [
    `${c.bold("Scrapely CLI")} ${c.dim(`v${version}`)}`,
    "Run your Scrapely X/Twitter outreach from the terminal.",
    "",
    c.bold("Usage"),
    "  scrapely <group> <command> [options]",
    "",
    c.bold("Get started"),
    rows([
      ["scrapely login", "Save your API key"],
      ["scrapely campaigns list", "See your campaigns"],
      ["scrapely campaigns --help", "See everything you can do with campaigns"],
    ], c),
    "",
    c.bold("Groups"),
    rows(groups, c, 14),
    "",
    c.bold("Other commands"),
    rows(Object.entries(BUILTINS), c, 14),
    "",
    c.bold("Options (work everywhere)"),
    rows([...GLOBAL_FLAGS, ["--version", "Show the version"]], c, 14),
    "",
    `Run ${c.cyan("scrapely <group> --help")} to see a group's commands.`,
    c.dim("Part of the scrapely-mcp npm package. Without installing: npx -p scrapely-mcp scrapely <command>"),
  ].join("\n");
}

export function groupHelp(group) {
  const c = colors(process.stdout);
  const list = groupTools(group).map((t) => [
    t.cli.action + (t.destructive ? " *" : ""),
    t.cli.summary || cliText(firstSentence(t.description)),
  ]);
  const anyDestructive = groupTools(group).some((t) => t.destructive);
  return [
    `${c.bold(`scrapely ${group}`)}${GROUPS[group] ? ` - ${GROUPS[group]}` : ""}`,
    "",
    c.bold("Commands"),
    rows(list, c, 14),
    ...(anyDestructive ? ["", c.dim("* asks you to confirm first: it sends, spends credits, launches, pauses, deletes or overwrites")] : []),
    "",
    `Run ${c.cyan(`scrapely ${group} <command> --help`)} to see its options.`,
  ].join("\n");
}

export function commandHelp(tool) {
  const c = colors(process.stdout);
  const fields = describeInputs(tool.inputs);
  const toRow = (f) => [flagUsage(f), fieldText(f), fieldNotes(f, tool.inputs[f.key], tool)];
  const required = fields.filter((f) => !f.optional);
  const optional = fields.filter((f) => f.optional);

  const usage = [`scrapely ${commandName(tool)}`, ...required.map(flagUsage), optional.length ? "[options]" : ""]
    .filter(Boolean).join(" ");

  const out = [c.bold(`scrapely ${commandName(tool)}`), "", wrap(tool.cli.description || cliText(tool.description), width()), "", c.bold("Usage"), wrap(usage, width(), "  ")];
  const nameWidth = Math.max(0, ...fields.map((f) => flagUsage(f).length)); // same column in both sections
  if (required.length) out.push("", c.bold("Required"), rows(required.map(toRow), c, nameWidth));
  if (optional.length) out.push("", c.bold("Options"), rows(optional.map(toRow), c, nameWidth));
  out.push("", c.bold("Example"), `  ${example(tool, fields)}`);
  if (tool.destructive) {
    out.push("", c.yellow("This sends, spends credits, launches, pauses, deletes or overwrites something in your account."),
      c.yellow("You'll be asked to confirm first; add --yes to skip the question."));
  }
  out.push("", c.dim("Also: --json, --yes, --debug"));
  return out.join("\n");
}

export function apiHelp() {
  const c = colors(process.stdout);
  return [
    c.bold("scrapely api"),
    "",
    "Call any Scrapely API endpoint directly and print the JSON response.",
    "For when a command doesn't exist yet. Paths are relative to https://app.scrapely.co/api/v1",
    "",
    c.bold("Usage"),
    "  scrapely api <METHOD> <path> [--data <json>] [--query key=value ...]",
    "",
    c.bold("Options"),
    rows([
      ["--data <json>", "Request body: JSON text, @file.json, or - to read from stdin"],
      ["--query key=value", "Query parameter (repeat for more)"],
      ["-y, --yes", "Don't ask before non-GET requests"],
    ], c),
    "",
    c.bold("Examples"),
    "  scrapely api GET /campaigns --query limit=5",
    "  scrapely api POST /campaigns/pause --data '{\"campaign_name\":\"Launch\",\"is_paused\":true}'",
  ].join("\n");
}

export function loginHelp() {
  return [
    "scrapely login",
    "",
    "Save your Scrapely API key on this computer (checked with Scrapely first).",
    "",
    "Usage",
    "  scrapely login             Paste your key when asked (it stays hidden)",
    "  echo $KEY | scrapely login Read the key from stdin",
    "  scrapely login --key <key> Pass the key directly (less safe: it stays in",
    "                             your shell history and shows up in ps)",
    "",
    "Create a key at https://app.scrapely.co/settings/integrations",
  ].join("\n");
}
