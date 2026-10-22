// Turns command-line flags into a tool's input object:
// parse (node:util parseArgs) -> coerce each value by its zod type -> validate with zod.

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { describeInputs } from "./schema.js";
import { UsageError } from "./errors.js";
import { readStdin } from "./prompt.js";
import { closest } from "./suggest.js";

export const GLOBAL_OPTIONS = {
  json: { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  debug: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

// Runs parseArgs, rewording its errors for humans.
export function parseFlags(argv, options, commandName) {
  try {
    return parseArgs({ args: argv, options, strict: true, allowPositionals: true });
  } catch (err) {
    const flag = err.message.match(/'(--?[^' ]+)/)?.[1] || "";
    if (err.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      const known = Object.keys(options).map((name) => `--${name}`);
      const guess = closest(flag.split("=")[0], known);
      const hint = guess ? ` Did you mean ${guess}?` : "";
      throw new UsageError(`Unknown option ${flag}.${hint}`, commandName);
    }
    if (/argument missing/.test(err.message)) throw new UsageError(`${flag} needs a value.`, commandName);
    if (/ambiguous/.test(err.message)) {
      throw new UsageError(`${flag} needs a value. For a value starting with "-", write ${flag}=<value>.`, commandName);
    }
    if (/does not take an argument/.test(err.message)) throw new UsageError(`${flag} doesn't take a value.`, commandName);
    throw new UsageError(err.message, commandName);
  }
}

// "--is-paused=false" -> "--no-is-paused", so on/off flags accept either style.
function normalizeBooleans(argv, booleanFlags) {
  return argv.map((arg) => {
    const match = arg.match(/^--([^=]+)=(true|false|yes|no)$/i);
    if (!match || !booleanFlags.has(match[1])) return arg;
    return /^(true|yes)$/i.test(match[2]) ? `--${match[1]}` : `--no-${match[1]}`;
  });
}

function buildOptions(fields) {
  const options = { ...GLOBAL_OPTIONS };
  for (const field of fields) {
    if (field.kind === "boolean") options[field.flag] = { type: "boolean" };
    else options[field.flag] = { type: "string", multiple: field.kind === "list" };
    // --no-<flag>: false for on/off flags, null ("clear it") for nullable fields
    if (field.kind === "boolean" || field.nullable) options[`no-${field.flag}`] = { type: "boolean" };
  }
  return options;
}

// JSON from the value itself, @path/to/file.json, or - (stdin)
async function readJsonValue(field, raw, commandName) {
  let text = raw;
  let from = "";
  if (raw === "-") {
    text = await readStdin();
    from = " (from stdin)";
  } else if (raw.startsWith("@")) {
    const path = raw.slice(1);
    try {
      text = readFileSync(path, "utf8");
    } catch (err) {
      throw new UsageError(`--${field.flag}: couldn't read ${path} (${err.code || err.message}).`, commandName);
    }
    from = ` (from ${path})`;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UsageError(`--${field.flag} must be JSON${from}: ${err.message}`, commandName);
  }
}

function toNumber(field, raw, commandName) {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n)) {
    throw new UsageError(`--${field.flag} must be a number (got "${raw}").`, commandName);
  }
  return n;
}

async function coerce(field, raw, commandName) {
  switch (field.kind) {
    case "number":
      return toNumber(field, raw, commandName);
    case "enum":
      if (!field.values.includes(raw)) {
        throw new UsageError(`--${field.flag} must be one of: ${field.values.join(", ")} (got "${raw}").`, commandName);
      }
      return raw;
    case "list": {
      // Repeat the flag or separate with commas; a JSON array also works.
      if (raw.length === 1 && raw[0].trim().startsWith("[")) return readJsonValue(field, raw[0], commandName);
      const items = raw.flatMap((value) => value.split(",")).map((s) => s.trim()).filter(Boolean);
      return field.itemKind === "number" ? items.map((item) => toNumber(field, item, commandName)) : items;
    }
    case "json":
      return readJsonValue(field, raw, commandName);
    default:
      return raw;
  }
}

function formatPath(path, fields) {
  const [key, ...rest] = path;
  const field = fields.find((f) => f.key === key);
  let out = field ? `--${field.flag}` : String(key);
  for (const part of rest) out += typeof part === "number" ? `[${part}]` : `.${part}`;
  return out;
}

function validationMessage(error, fields, values) {
  const lines = error.issues.map((issue) => {
    const where = formatPath(issue.path, fields);
    const missing = issue.code === "invalid_type" && issue.received === "undefined";
    if (missing && issue.path.length === 1) {
      const isSwitch = fields.find((f) => f.key === issue.path[0])?.kind === "boolean";
      return isSwitch ? `  ${where} or --no-${where.slice(2)} is required` : `  ${where} is required`;
    }
    if (missing) return `  ${where}: required`;
    return `  ${where}: ${issue.message}`;
  });
  const nothing = Object.keys(values).length === 0;
  return (nothing ? "Missing required options:\n" : "Some options aren't right:\n") + lines.join("\n");
}

// Returns { args, globals, positionals }; throws UsageError with friendly text.
export async function parseToolArgs(tool, argv, commandName) {
  const fields = describeInputs(tool.inputs);
  const booleanFlags = new Set(fields.filter((f) => f.kind === "boolean").map((f) => f.flag));
  const { values, positionals } = parseFlags(normalizeBooleans(argv, booleanFlags), buildOptions(fields), commandName);

  if (positionals.length > 0) {
    throw new UsageError(
      `Unexpected argument "${positionals[0]}". Pass values as --flags, e.g. --name "My campaign".`,
      commandName
    );
  }

  const args = {};
  for (const field of fields) {
    if (values[`no-${field.flag}`]) {
      args[field.key] = field.kind === "boolean" ? false : null;
    } else if (values[field.flag] !== undefined) {
      const raw = values[field.flag];
      args[field.key] = field.kind === "boolean" ? raw : await coerce(field, raw, commandName);
    }
  }

  const result = z.object(tool.inputs).safeParse(args);
  if (!result.success) throw new UsageError(validationMessage(result.error, fields, args), commandName);

  const globals = { json: values.json, yes: values.yes, debug: values.debug };
  return { args: result.data, globals };
}
