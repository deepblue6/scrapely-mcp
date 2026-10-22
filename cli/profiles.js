// scrapely profiles list | use <name> | remove <name>
// One saved API key per workspace, for people (agencies) who run several.

import { parseFlags } from "./args.js";
import { checkProfileName, listProfiles, loadConfig, maskKey, missingProfile, removeApiKey, setDefaultProfile } from "./config.js";
import { UsageError } from "./errors.js";
import { printResult } from "./output.js";
import { confirm } from "./prompt.js";
import { colors } from "./style.js";

const OPTIONS = {
  json: { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  debug: { type: "boolean" },
};

const ACTIONS = ["list", "use", "remove"];
const SYNONYMS = { ls: "list", rm: "remove", delete: "remove", default: "use", switch: "use" };

function envKeyNote() {
  if (process.env.SCRAPELY_API_KEY) {
    process.stderr.write("Note: SCRAPELY_API_KEY is set in your environment and is used instead of saved profiles (unless you pass --profile).\n");
  }
}

// The profile a use/remove acts on: `profiles use bitvault` or `profiles use --profile bitvault`.
function existingProfile(name, action) {
  if (!name) throw new UsageError(`Usage: scrapely profiles ${action} <name>`, "profiles");
  checkProfileName(name, `profiles ${action}`);
  if (!loadConfig().profiles[name]) throw missingProfile(name);
  return name;
}

function list({ json }) {
  const profiles = listProfiles();
  if (json) return printResult({ default_profile: loadConfig().default_profile || null, profiles }, { json: true });
  if (profiles.length === 0) {
    process.stdout.write("No saved profiles. Add one with: scrapely login --profile <name>\n");
    return;
  }
  printResult({ profiles });
  envKeyNote();
}

function use(name) {
  setDefaultProfile(name);
  process.stdout.write(`${colors(process.stdout).green("Default profile is now")} ${name}.\n`);
  envKeyNote();
}

async function remove(name, { yes }) {
  const key = loadConfig().profiles[name].api_key;
  const c = colors(process.stderr);
  const summary = `${c.yellow("About to remove")} the saved API key for profile ${c.bold(name)} from this computer.\n  Profile: ${name} (${maskKey(key)})`;
  await confirm(summary, { yes, commandName: "profiles" });
  const { wasDefault } = removeApiKey(name);
  process.stdout.write(`Removed profile "${name}".\n`);
  if (wasDefault && listProfiles().length) {
    process.stdout.write("That was the default profile. Pick a new one with: scrapely profiles use <name>\n");
  }
}

export async function runProfiles(argv, { profile } = {}) {
  const { values, positionals } = parseFlags(argv, OPTIONS, "profiles");
  const [typed, name = profile, extra] = positionals;
  const action = SYNONYMS[typed] || typed;
  if (!ACTIONS.includes(action)) {
    const hint = typed ? `Unknown command "profiles ${typed}". ` : "";
    throw new UsageError(`${hint}Commands in profiles: ${ACTIONS.join(", ")}.`, "profiles");
  }
  if (extra !== undefined || (action === "list" && positionals[1] !== undefined)) {
    throw new UsageError(`Unexpected argument "${extra ?? positionals[1]}".`, "profiles");
  }
  if (action === "list") return list(values);
  if (action === "use") return use(existingProfile(name, "use"));
  return remove(existingProfile(name, "remove"), values);
}
