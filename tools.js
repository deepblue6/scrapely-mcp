// The single registry of Scrapely tools, shared by the MCP server and the CLI.
//
// Each tool:
//   name, description  - shown to MCP clients (keep stable: agents rely on them)
//   inputs             - zod raw shape, used for MCP schemas and CLI flags/validation
//   run(args, call)    - does the work; `call(method, path, body, query)` hits the API.
//                        Returns plain data; the MCP server wraps it as JSON text.
//   cli                - { group, action } -> `scrapely <group> <action>`, plus optional
//                        validate(args): a message (in CLI flag terms) when the input
//                        can't work, checked before asking or calling the API
//   destructive        - true when it sends messages, spends credits, posts tweets,
//                        launches, pauses or removes things, or overwrites live
//                        campaign settings or tags (the CLI asks before running it)

import { accessSync, constants } from "node:fs";
import { z } from "zod";

// Statuses get_campaign_leads documents (the API filters by any string and returns nothing for others).
const LEAD_STATUSES = ["pending", "completed", "dms_closed", "already_contacted", "blocklisted", "needs_verified_sender", "failed"];

const MEDIA_URL_HINT = "Image to attach: a media_url from upload_media (recommended), or any public image link. Outside links are downloaded when each DM sends; if one stops working, that DM goes out without the image.";

// ─── ACCOUNTS ────────────────────────────────────────────────────────────────

const accountTools = [
  {
    name: "list_accounts",
    description: "List all connected Twitter/X accounts in the workspace",
    inputs: {},
    run: (args, call) => call("GET", "/accounts"),
    cli: { group: "accounts", action: "list" },
  },
  {
    name: "add_account",
    description: "Add a new Twitter/X account to the workspace.",
    inputs: {
      handle: z.string().describe("Twitter handle (with or without @)"),
      cookies: z.array(z.object({ name: z.string(), value: z.string(), domain: z.string() })).describe("Cookie objects — must include ct0 and auth_token"),
      proxy: z.string().describe("Proxy URL"),
      proxy_auth: z.string().describe("Proxy auth in username:password format"),
      xchat_pin: z.string().describe("X chat PIN code"),
    },
    run: ({ handle, cookies, proxy, proxy_auth, xchat_pin }, call) =>
      call("POST", "/accounts", { handle, cookies, proxy, proxy_auth, xchat_pin }),
    cli: { group: "accounts", action: "add" },
  },
  {
    name: "remove_account",
    description: "Remove a Twitter/X account from the workspace.",
    inputs: {
      account_id: z.string().optional().describe("The account UUID to remove"),
      handle: z.string().optional().describe("Twitter handle to remove"),
    },
    run: ({ account_id, handle }, call) => {
      const body = {};
      if (account_id) body.account_id = account_id;
      if (handle) body.handle = handle;
      return call("DELETE", "/accounts", body);
    },
    cli: {
      group: "accounts",
      action: "remove",
      validate: ({ account_id, handle }) => (account_id || handle ? null : "Pass --account-id or --handle to say which account to remove."),
    },
    destructive: true,
  },
  {
    name: "update_cookies",
    description: "Update cookies for an existing Twitter/X account.",
    inputs: {
      account_id: z.string().describe("The account UUID"),
      cookies: z.array(z.object({ name: z.string(), value: z.string(), domain: z.string() })).describe("Cookie objects — must include ct0 and auth_token"),
    },
    run: ({ account_id, cookies }, call) => call("PUT", "/accounts/cookies", { account_id, cookies }),
    cli: { group: "accounts", action: "update-cookies" },
  },
  {
    name: "toggle_pause",
    description: "Pause or unpause DM sending for a Twitter/X account",
    inputs: {
      account_id: z.string().describe("The account UUID"),
      is_paused: z.boolean().describe("true to pause, false to unpause"),
    },
    run: ({ account_id, is_paused }, call) => call("PATCH", "/accounts/pause", { account_id, is_paused }),
    cli: { group: "accounts", action: "pause" },
    destructive: true,
  },
  {
    name: "toggle_followups_pause",
    description: "Pause or unpause follow-up messages for a Twitter/X account",
    inputs: {
      account_id: z.string().describe("The account UUID"),
      followups_paused: z.boolean().describe("true to pause, false to unpause"),
    },
    run: ({ account_id, followups_paused }, call) =>
      call("PATCH", "/accounts/pause-followups", { account_id, followups_paused }),
    cli: { group: "accounts", action: "pause-followups" },
    destructive: true,
  },
  {
    name: "update_handle",
    description: "Update the Twitter/X handle for an existing account. Useful when the account's username has changed.",
    inputs: {
      account_id: z.string().describe("The account UUID"),
      handle: z.string().describe("The new Twitter handle (with or without @)"),
    },
    run: ({ account_id, handle }, call) => call("PATCH", "/accounts/handle", { account_id, handle }),
    cli: { group: "accounts", action: "update-handle" },
  },
  {
    name: "update_proxy",
    description: "Update proxy settings for an existing Twitter/X account.",
    inputs: {
      account_id: z.string().describe("The account UUID"),
      proxy: z.string().describe("Proxy URL"),
      proxy_auth: z.string().describe("Proxy auth in username:password format"),
    },
    run: ({ account_id, proxy, proxy_auth }, call) => call("PUT", "/accounts/proxy", { account_id, proxy, proxy_auth }),
    cli: { group: "accounts", action: "update-proxy" },
  },
  {
    name: "get_account_tags",
    description: "Get tags for a specific account or all accounts.",
    inputs: {
      account_id: z.string().optional().describe("Account UUID. Omit to get tags for all accounts."),
    },
    run: ({ account_id }, call) => call("GET", "/accounts/tags", null, { account_id }),
    cli: { group: "tags", action: "get" },
  },
  {
    name: "set_account_tags",
    description: "Replace all tags for an account.",
    inputs: {
      account_id: z.string().describe("The account UUID"),
      tags: z.array(z.string()).describe("Array of tag strings to set"),
    },
    run: ({ account_id, tags }, call) => call("PUT", "/accounts/tags", { account_id, tags }),
    cli: { group: "tags", action: "set" },
    destructive: true,
  },
  {
    name: "update_account_tags",
    description: "Add or remove individual tags on an account.",
    inputs: {
      account_id: z.string().describe("The account UUID"),
      add: z.array(z.string()).optional().describe("Tags to add"),
      remove: z.array(z.string()).optional().describe("Tags to remove"),
    },
    run: ({ account_id, add, remove }, call) => {
      const body = { account_id };
      if (add) body.add = add;
      if (remove) body.remove = remove;
      return call("PATCH", "/accounts/tags", body);
    },
    cli: { group: "tags", action: "update" },
  },
  {
    name: "toggle_warmup",
    description: "Enable or disable warmup mode for a Twitter/X account",
    inputs: {
      account_id: z.string().describe("The account UUID"),
      warmup_enabled: z.boolean().describe("true to enable warmup, false to disable"),
    },
    run: ({ account_id, warmup_enabled }, call) => call("PATCH", "/accounts/warmup", { account_id, warmup_enabled }),
    cli: { group: "accounts", action: "warmup" },
    destructive: true,
  },
];

// ─── LEAD SCRAPING ───────────────────────────────────────────────────────────

const scrapingTools = [
  {
    name: "create_scraping_source",
    description: "Create a new lead source by scraping followers/following from Twitter/X accounts. Supports keyword filters, follower/following ranges, location exclusions, website, blue verified, DMs open/closed, and last active filters.",
    inputs: {
      name: z.string().describe("Name for the lead source"),
      sources: z.array(z.object({
        handle: z.string().describe("Twitter handle to scrape"),
        followers: z.boolean().optional().describe("Scrape their followers"),
        following: z.boolean().optional().describe("Scrape who they follow"),
      })).describe("Array of accounts to scrape from"),
      filters: z.object({
        includeKeywords: z.array(z.array(z.string())).optional(),
        excludeKeywords: z.array(z.array(z.string())).optional(),
        includeWithinLogic: z.enum(["AND", "OR"]).optional(),
        includeBetweenLogic: z.enum(["AND", "OR"]).optional(),
        excludeWithinLogic: z.enum(["AND", "OR"]).optional(),
        excludeBetweenLogic: z.enum(["AND", "OR"]).optional(),
        locationExcludeKeywords: z.array(z.string()).optional(),
        followers: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
        following: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
        hasWebsite: z.boolean().nullable().optional(),
        isBlueVerified: z.boolean().nullable().optional().describe("true = only Blue Verified, false = only non-verified, null = no filter"),
        dmsOpen: z.boolean().nullable().optional().describe("true = only DMs open, false = only DMs closed, null = no filter"),
        lastActiveHours: z.number().nullable().optional().describe("Only keep leads active within this many hours (e.g. 24)"),
      }).optional().describe("Filter configuration"),
    },
    run: ({ name, sources, filters }, call) => {
      const body = { name, sources };
      if (filters) body.filters = filters;
      return call("POST", "/scraping-sources", body);
    },
    cli: { group: "sources", action: "create" },
    destructive: true,
  },
  {
    name: "check_scraping_status",
    description: "Check the status of scraping jobs, including the filters used when creating the source.",
    inputs: {
      id: z.string().optional().describe("Specific scraping source ID"),
      limit: z.number().optional().describe("Results per page (max 100)"),
      offset: z.number().optional().describe("Pagination offset"),
    },
    run: ({ id, limit, offset }, call) => call("GET", "/scraping-sources", null, { id, limit, offset }),
    cli: { group: "sources", action: "list" },
  },
  {
    name: "get_scraping_source_leads",
    description: "Get leads from a specific scraping source.",
    inputs: {
      source_id: z.string().describe("The scraping source ID"),
      limit: z.number().optional().describe("Results per page (max 100)"),
      offset: z.number().optional().describe("Pagination offset"),
    },
    run: ({ source_id, limit, offset }, call) =>
      call("GET", `/scraping-sources/${encodeURIComponent(source_id)}/leads`, null, { limit, offset }),
    cli: { group: "sources", action: "leads" },
  },
  {
    name: "import_leads",
    description: "Import your own list of leads (e.g. from a CSV) into a new lead source, ready to use in campaigns. Handles can be 'name', '@name', or x.com profile URLs. Duplicates and handles already in the account are skipped. Large lists are sent in 5,000-lead chunks automatically.",
    inputs: {
      name: z.string().describe("Name for the new lead source (must not already exist)"),
      leads: z.array(z.object({
        twitter_handle: z.string().describe("Twitter handle, @handle, or x.com profile URL"),
        name: z.string().optional(),
        description: z.string().optional().describe("Bio"),
        follower_count: z.number().optional(),
        following_count: z.number().optional(),
        website: z.string().optional(),
        location: z.string().optional(),
      })).min(1).describe("Leads to import"),
    },
    run: async ({ name, leads }, call) => {
      // The API takes max 5,000 leads per request; later chunks with the same
      // name append to the lead source created by the first one.
      const CHUNK_SIZE = 5000;
      const summary = { lead_source_id: null, lead_source_name: name, imported_count: 0, skipped_count: 0, invalid_count: 0 };

      for (let i = 0; i < leads.length; i += CHUNK_SIZE) {
        try {
          const data = await call("POST", "/import-leads", { name, leads: leads.slice(i, i + CHUNK_SIZE) });
          summary.lead_source_id = data.lead_source_id;
          summary.imported_count += data.imported_count || 0;
          summary.skipped_count += data.skipped_count || 0;
          summary.invalid_count += data.invalid_count || 0;
        } catch (err) {
          summary.error = err.message;
          summary.not_sent_count = leads.length - i;
          break;
        }
      }

      return summary;
    },
    cli: { group: "sources", action: "import" },
  },
];

// ─── CAMPAIGNS ───────────────────────────────────────────────────────────────

// Images: file_path only on the local (npx/CLI) build; the hosted server must never read its own files.
function uploadMediaTool(hosted) {
  const choices = `url, base64${hosted ? "" : " or file_path"}`;
  return {
    name: "upload_media",
    description: `Upload an image to attach to campaign DMs or follow-ups. Pass exactly one of ${choices}. Returns a media_url: put it on a message variant (image on the first DM) or a follow-up in launch_campaign, launch_import_campaign or edit_campaign. JPEG, PNG, GIF or WebP, up to 5MB.`,
    inputs: {
      url: z.string().optional().describe("Public link to an image; Scrapely downloads and stores a copy"),
      base64: z.string().optional().describe("Base64-encoded image (max ~3MB before encoding)"),
      ...(hosted ? {} : { file_path: z.string().optional().describe("Path to an image file on this computer") }),
    },
    run: async ({ url, base64, file_path }, call) => {
      const given = [url, base64, file_path].filter(Boolean).length;
      if (given !== 1) {
        throw new Error(`Pass exactly one of ${choices}`);
      }
      let body = url ? { url } : { data: base64 };
      if (file_path) {
        const { readFile } = await import("node:fs/promises");
        body = { data: (await readFile(file_path)).toString("base64") };
      }
      return call("POST", "/media/upload", body);
    },
    cli: {
      group: "media",
      action: "upload",
      validate: ({ url, base64, file_path }) => {
        if ([url, base64, file_path].filter(Boolean).length !== 1) {
          return `Pass exactly one of --url, --base64${hosted ? "" : " or --file-path"}.`;
        }
        if (file_path) {
          try {
            accessSync(file_path, constants.R_OK);
          } catch (err) {
            return `--file-path: couldn't read ${file_path} (${err.code || err.message}).`;
          }
        }
        return null;
      },
    },
  };
}

function campaignTools(hosted) {
  return [
    {
      name: "launch_campaign",
      description: "Launch a DM campaign targeting leads from scraping sources.",
      inputs: {
        name: z.string().describe("Campaign name"),
        message: z.string().optional().describe("Message text (supports {{firstName}}). To attach an image to the first DM, use message_variants with media_url instead"),
        message_variants: z.array(z.object({
          message: z.string(),
          media_url: z.string().optional().describe(MEDIA_URL_HINT),
          followups: z.array(z.object({
            wait_time: z.number(),
            wait_unit: z.enum(["seconds", "minutes", "hours", "days", "weeks"]),
            message: z.string(),
            media_url: z.string().optional().describe(MEDIA_URL_HINT),
          })).max(25).optional().describe("Up to 25 follow-ups for this variant"),
        })).max(50).optional().describe("Message variants for A/B testing (max 50)"),
        lead_source_ids: z.array(z.string()).describe("Lead source IDs to target"),
        account_ids: z.array(z.string()).optional().describe("Account IDs to send from"),
        followups: z.array(z.object({ wait_time: z.number(), wait_unit: z.enum(["seconds", "minutes", "hours", "days", "weeks"]), message: z.string(), media_url: z.string().optional().describe(MEDIA_URL_HINT) })).max(25).optional().describe("Up to 25 follow-ups"),
        max_leads: z.number().optional().describe("Max leads to target (max 25,000)"),
        enable_follow: z.boolean().optional(),
        enable_like: z.boolean().optional(),
        enable_comment: z.boolean().optional(),
        comment_template: z.string().optional(),
        send_window_start: z.string().optional().describe("Start time for send window in HH:MM 24h format (e.g. '09:00')"),
        send_window_end: z.string().optional().describe("End time for send window in HH:MM 24h format (e.g. '17:00')"),
        send_timezone: z.string().optional().describe("IANA timezone for send window (e.g. 'Australia/Sydney')"),
        send_days: z.array(z.number()).optional().describe("Days of week to send (0=Sun, 1=Mon, ..., 6=Sat)"),
      },
      run: (args, call) => call("POST", "/campaigns", { ...args }),
      cli: { group: "campaigns", action: "launch" },
      destructive: true,
    },
    {
      name: "launch_import_campaign",
      description: "Launch a DM campaign from your own lead list (e.g. a CSV) with custom data columns — same as Import Campaign in the dashboard. Each lead's custom_fields fill {{variables}} in the message, follow-ups and comment; {{Hi|Hey}} spintax is supported. Duplicate handles and handles already in the campaign are skipped. Large lists are sent in chunks automatically.",
      inputs: {
        name: z.string().describe("Campaign name (must not already exist)"),
        message: z.string().optional().describe("Message template, e.g. '{{Hey|Hi}} {{firstName}}, loved what {{company}} is doing'. Required unless message_variants is set"),
        message_variants: z.array(z.object({
          message: z.string(),
          media_url: z.string().optional().describe(MEDIA_URL_HINT),
          followups: z.array(z.object({
            wait_time: z.number(),
            wait_unit: z.enum(["seconds", "minutes", "hours", "days", "weeks"]),
            message: z.string(),
            media_url: z.string().optional().describe(MEDIA_URL_HINT),
          })).max(25).optional().describe("Up to 25 follow-ups for this variant"),
        })).max(50).optional().describe("Up to 50 message templates for A/B testing; each lead gets a random one. A variant without its own followups uses the top-level followups"),
        leads: z.array(z.object({
          twitter_handle: z.string().describe("Twitter handle, @handle, or x.com profile URL"),
          custom_fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe("{ columnName: value } used by {{columnName}} in templates"),
          comment: z.string().optional().describe("Comment for this lead (overrides comment_template)"),
        })).min(1).describe("Leads to message"),
        followups: z.array(z.object({ wait_time: z.number(), wait_unit: z.enum(["seconds", "minutes", "hours", "days", "weeks"]), message: z.string(), media_url: z.string().optional().describe(MEDIA_URL_HINT) })).max(25).optional().describe("Up to 25 follow-up templates (same {{variables}} allowed)"),
        account_ids: z.array(z.string()).optional().describe("Account IDs to send from (defaults to all active)"),
        enable_follow: z.boolean().optional(),
        enable_like: z.boolean().optional(),
        enable_comment: z.boolean().optional(),
        comment_template: z.string().optional().describe("Comment for every lead ({{variables}} allowed)"),
        send_window_start: z.string().optional().describe("Start time for send window in HH:MM 24h format (e.g. '09:00')"),
        send_window_end: z.string().optional().describe("End time for send window in HH:MM 24h format (e.g. '17:00')"),
        send_timezone: z.string().optional().describe("IANA timezone for send window (e.g. 'Australia/Sydney'); required with a send window"),
        send_days: z.array(z.number()).optional().describe("Days of week to send (0=Sun, 1=Mon, ..., 6=Sat)"),
      },
      run: async ({ leads, ...settings }, call) => {
        // The API takes max 5,000 leads and ~4MB per request; later chunks with
        // the same name append to the campaign created by the first one.
        const MAX_LEADS = 5000;
        const MAX_BYTES = 3 * 1024 * 1024;
        const chunks = [];
        let current = [];
        let currentBytes = 0;
        for (const lead of leads) {
          const bytes = Buffer.byteLength(JSON.stringify(lead));
          if (current.length > 0 && (current.length >= MAX_LEADS || currentBytes + bytes > MAX_BYTES)) {
            chunks.push(current);
            current = [];
            currentBytes = 0;
          }
          current.push(lead);
          currentBytes += bytes;
        }
        if (current.length > 0) chunks.push(current);

        const summary = { campaign_name: settings.name, jobs_created: 0, skipped_count: 0, invalid_count: 0 };
        let sent = 0;

        for (const chunk of chunks) {
          try {
            const data = await call("POST", "/campaigns/import", { ...settings, leads: chunk });
            summary.jobs_created += data.jobs_created || 0;
            summary.skipped_count += data.skipped_count || 0;
            summary.invalid_count += data.invalid_count || 0;
            summary.message_variants = data.message_variants;
            summary.accounts_used = data.accounts_used;
            sent += chunk.length;
          } catch (err) {
            summary.error = err.message;
            summary.not_sent_count = leads.length - sent;
            break;
          }
        }

        return summary;
      },
      cli: { group: "campaigns", action: "launch-import" },
      destructive: true,
    },
    {
      name: "pause_campaign",
      description: "Pause or unpause a campaign.",
      inputs: {
        campaign_name: z.string().describe("Campaign name"),
        is_paused: z.boolean().describe("true to pause, false to unpause"),
      },
      run: (args, call) => call("POST", "/campaigns/pause", { ...args }),
      cli: { group: "campaigns", action: "pause" },
      destructive: true,
    },
    {
      name: "get_campaign_leads",
      description: "List the leads in a campaign with their status, sending account, reply info and custom_fields (the columns from an import campaign, e.g. a personalized link). Paginated, oldest first.",
      inputs: {
        campaign_name: z.string().describe("Campaign name"),
        status: z.string().optional().describe("Only leads with this status: pending, completed, dms_closed, already_contacted, blocklisted, needs_verified_sender (recipient only accepts DMs from verified accounts), failed"),
        replied: z.boolean().optional().describe("Only leads who replied (true) or didn't (false)"),
        handle: z.string().optional().describe("One lead by X handle (case-insensitive)"),
        limit: z.number().optional().describe("Max leads to return (default 100, max 1000)"),
        offset: z.number().optional().describe("Pagination offset"),
      },
      run: ({ campaign_name, ...params }, call) =>
        call("GET", `/campaigns/${encodeURIComponent(campaign_name)}/leads`, null, params),
      cli: {
        group: "campaigns",
        action: "leads",
        validate: ({ status }) =>
          (status === undefined || LEAD_STATUSES.includes(status) ? null : `--status must be one of: ${LEAD_STATUSES.join(", ")} (got "${status}").`),
      },
    },
    {
      name: "add_leads_to_campaign",
      description: "Add leads to an existing campaign (same as adding leads in the dashboard). They get the campaign's messages, variants, images, follow-ups, engagement settings and send window, spread across its active accounts. Handles already in the campaign are skipped. Pass either twitter_handles, or leads with custom_fields: for an import campaign, custom_fields fill the {{columns}} its messages use — leads added without them get a warning in the response. No limit on list size: large lists are sent in 5,000-lead chunks automatically.",
      inputs: {
        campaign_name: z.string().describe("Name of the existing campaign"),
        twitter_handles: z.array(z.string()).optional().describe("Handles to add: 'name' or '@name'"),
        leads: z.array(z.object({
          twitter_handle: z.string().describe("Handle: 'name' or '@name'"),
          custom_fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe("Values for the campaign's {{columns}}, e.g. { first_name: 'Jane', company: 'Acme' }"),
          comment: z.string().optional().describe("This lead's comment, for import campaigns that comment per lead"),
        })).optional().describe("Leads with their own custom_fields (use instead of twitter_handles for import campaigns)"),
      },
      run: async ({ campaign_name, twitter_handles, leads }, call) => {
        const items = leads?.length ? leads : (twitter_handles || []);
        if (items.length === 0) throw new Error("Pass twitter_handles or leads");
        const CHUNK_SIZE = 5000;
        const summary = { campaign_name, jobs_created: 0, duplicates_skipped: 0 };
        const warnings = new Set();
        const missingColumns = new Set();
        let leadsMissingColumns = 0;

        for (let i = 0; i < items.length; i += CHUNK_SIZE) {
          const chunk = items.slice(i, i + CHUNK_SIZE);
          try {
            const body = leads?.length ? { campaign_name, leads: chunk } : { campaign_name, twitter_handles: chunk };
            const data = await call("POST", "/campaigns/add-lead", body);
            summary.jobs_created += data.jobs_created || 0;
            summary.duplicates_skipped += data.duplicates_skipped || 0;
            (data.warnings || []).forEach((w) => warnings.add(w));
            (data.missing_columns || []).forEach((c) => missingColumns.add(c));
            leadsMissingColumns += data.leads_missing_columns || 0;
          } catch (err) {
            summary.error = err.message;
            summary.not_sent_count = items.length - i;
            break;
          }
        }

        if (warnings.size) {
          summary.warnings = [...warnings];
          summary.missing_columns = [...missingColumns];
          summary.leads_missing_columns = leadsMissingColumns;
        }
        return summary;
      },
      cli: {
        group: "campaigns",
        action: "add-leads",
        validate: ({ twitter_handles, leads }) =>
          (leads?.length || twitter_handles?.length ? null : "Pass --twitter-handles or --leads (a JSON list) with the leads to add."),
      },
      destructive: true,
    },
    {
      name: "add_lead_source_to_campaign",
      description: "Add every lead from a lead source (a scrape or import) to an existing campaign, same as Add to Campaign in the dashboard. They get the campaign's settings, including its send window. Leads already in the campaign are skipped. Lead sources have no custom_fields, so adding one to an import campaign that uses {{columns}} returns a warning. Get lead source ids from check_scraping_status.",
      inputs: {
        campaign_name: z.string().describe("Name of the existing campaign"),
        lead_source_id: z.string().describe("Lead source UUID"),
      },
      run: ({ campaign_name, lead_source_id }, call) =>
        call("POST", "/campaigns/add-lead-source", { campaign_name, lead_source_id }),
      cli: { group: "campaigns", action: "add-source" },
      destructive: true,
    },
    uploadMediaTool(hosted),
    {
      name: "rename_campaign",
      description: "Rename a campaign. Its DMs, follow-ups, stats and paused state carry over. Use the new name in every later call — the old name stops working.",
      inputs: {
        campaign_name: z.string().describe("Current campaign name"),
        new_name: z.string().describe("New name, 1-200 characters. Can't match another of the user's campaigns, including deleted ones."),
      },
      run: (args, call) => call("POST", "/campaigns/rename", { ...args }),
      cli: { group: "campaigns", action: "rename" },
    },
    {
      name: "edit_campaign",
      description: "Edit settings for an existing campaign — message variants, followups, engagement actions, send window/days.",
      inputs: {
        campaign_name: z.string().describe("Campaign name"),
        message_variants: z.array(z.object({
          message: z.string(),
          media_url: z.string().optional().describe(MEDIA_URL_HINT),
          followups: z.array(z.object({
            wait_time: z.number(),
            wait_unit: z.enum(["seconds", "minutes", "hours", "days", "weeks"]),
            message: z.string(),
            media_url: z.string().optional().describe(MEDIA_URL_HINT),
          })).max(25).optional().describe("Up to 25 follow-ups for this variant"),
        })).optional().describe("Updated message variants"),
        followups: z.array(z.object({ wait_time: z.number(), wait_unit: z.enum(["seconds", "minutes", "hours", "days", "weeks"]), message: z.string(), media_url: z.string().optional().describe(MEDIA_URL_HINT) })).max(25).optional().describe("Up to 25 follow-ups"),
        enable_follow: z.boolean().optional(),
        enable_like: z.boolean().optional(),
        enable_comment: z.boolean().optional(),
        comment_template: z.string().optional(),
        send_window_start: z.string().optional().describe("Start time HH:MM 24h format (e.g. '09:00')"),
        send_window_end: z.string().optional().describe("End time HH:MM 24h format (e.g. '17:00')"),
        send_timezone: z.string().optional().describe("IANA timezone (e.g. 'Australia/Sydney')"),
        send_days: z.array(z.number()).optional().describe("Days of week (0=Sun ... 6=Sat)"),
      },
      run: (args, call) => call("POST", "/campaigns/settings", { ...args }),
      cli: { group: "campaigns", action: "update" },
      destructive: true,
    },
    {
      name: "list_campaigns",
      description: "List campaigns with basic stats",
      inputs: {
        limit: z.number().optional(),
        offset: z.number().optional(),
      },
      run: ({ limit, offset }, call) => call("GET", "/campaigns", null, { limit, offset }),
      cli: { group: "campaigns", action: "list" },
    },
    {
      name: "get_campaign_detail",
      description: "Get detailed analytics for a single campaign — totals, per-account breakdown, replies, settings (message variants, followups, engagement, send window), and pause state.",
      inputs: {
        campaign_name: z.string().describe("The campaign name (unique per workspace). Use list_campaigns to find names."),
      },
      run: ({ campaign_name }, call) => call("GET", `/campaigns/${encodeURIComponent(campaign_name)}`),
      cli: { group: "campaigns", action: "get" },
    },
    {
      name: "get_campaign_analytics",
      description: "Get detailed campaign analytics with optional date range filtering.",
      inputs: {
        campaign_name: z.string().optional().describe("Filter to a specific campaign"),
        account_id: z.string().optional().describe("Filter to a specific account"),
        start_date: z.string().optional().describe("ISO 8601 start date"),
        end_date: z.string().optional().describe("ISO 8601 end date"),
      },
      run: ({ campaign_name, account_id, start_date, end_date }, call) =>
        call("GET", "/campaigns/analytics", null, { campaign_name, account_id, start_date, end_date }),
      cli: { group: "campaigns", action: "analytics" },
    },
  ];
}

// ─── CONVERSATIONS & CRM ─────────────────────────────────────────────────────

const conversationTools = [
  {
    name: "fetch_conversations",
    description: "Fetch conversations with optional filters.",
    inputs: {
      conversation_id: z.string().optional().describe("Get a single conversation with all messages"),
      account_id: z.string().optional().describe("Filter by Twitter account"),
      handle: z.string().optional().describe("Filter by receiver handle"),
      limit: z.number().optional().describe("Results per page (max 100)"),
      cursor: z.string().optional().describe("Pagination cursor"),
      offset: z.number().optional().describe("Pagination offset"),
      include_messages: z.boolean().optional().describe("Include full message history"),
    },
    run: ({ conversation_id, account_id, handle, limit, cursor, offset, include_messages }, call) =>
      call("GET", "/conversations", null, { conversation_id, account_id, handle, limit, cursor, offset, include_messages }),
    cli: { group: "conversations", action: "list" },
  },
  {
    name: "send_dm",
    description: "Send a direct message to an existing conversation",
    inputs: {
      conversation_id: z.string().describe("The conversation ID"),
      message: z.string().describe("Message text (max 10,000 chars)"),
      account_id: z.string().describe("Twitter account ID to send from"),
    },
    run: ({ conversation_id, message, account_id }, call) =>
      call("POST", "/dm/send", { conversation_id, message, account_id }),
    cli: { group: "dm", action: "send" },
    destructive: true,
  },
  {
    name: "get_crm_data",
    description: "Get conversations organized by CRM tags.",
    inputs: {
      tag: z.string().optional().describe("Filter to a specific tag"),
      limit: z.number().optional().describe("Results per page (max 500, default 20)"),
      page: z.number().optional().describe("Page number (default 1)"),
      include_messages: z.boolean().optional().describe("Include full message history"),
    },
    run: ({ tag, limit, page, include_messages }, call) =>
      call("GET", "/crm/conversations", null, { tag, limit, page, include_messages }),
    cli: { group: "crm", action: "get" },
  },
  {
    name: "update_crm",
    description: "Update CRM data for a conversation",
    inputs: {
      conversation_id: z.string().describe("The conversation ID"),
      account_handle: z.string().describe("The account handle"),
      notes: z.string().optional(),
      deal_value: z.number().optional(),
      deal_currency: z.string().optional(),
      tag: z.string().nullable().optional(),
    },
    run: ({ conversation_id, account_handle, notes, deal_value, deal_currency, tag }, call) => {
      const body = { conversation_id, account_handle };
      if (notes !== undefined) body.notes = notes;
      if (deal_value !== undefined) body.deal_value = deal_value;
      if (deal_currency !== undefined) body.deal_currency = deal_currency;
      if (tag !== undefined) body.tag = tag;
      return call("PATCH", "/crm/update", body);
    },
    cli: { group: "crm", action: "update" },
  },
];

// ─── FOLLOWER LISTENERS ──────────────────────────────────────────────────────

const listenerTools = [
  {
    name: "list_listeners",
    description: "List follower listeners: X accounts being watched for new followers and/or new following. Each new one is sent to your webhook as a new_follower or new_following event. Shows each listener's id, handle, what it listens to, whether it's active, last check times and last error.",
    inputs: {},
    run: (args, call) => call("GET", "/follower-listeners"),
    cli: { group: "listeners", action: "list" },
  },
  {
    name: "add_listener",
    description: "Start watching an X account for new followers and/or new following (same as adding a listener in the dashboard). Max 25 listeners per workspace, one per handle. New followers/following are sent to your webhook URL (set in Settings) as new_follower / new_following events.",
    inputs: {
      handle: z.string().describe("X handle to watch: 'name', '@name', or an x.com profile URL"),
      listen_followers: z.boolean().optional().describe("Send an event when this account gains a new follower (default true)"),
      listen_following: z.boolean().optional().describe("Send an event when this account follows someone new (default true)"),
    },
    run: ({ handle, listen_followers, listen_following }, call) => {
      const body = { handle };
      if (listen_followers !== undefined) body.listen_followers = listen_followers;
      if (listen_following !== undefined) body.listen_following = listen_following;
      return call("POST", "/follower-listeners", body);
    },
    cli: { group: "listeners", action: "add" },
  },
  {
    name: "update_listener",
    description: "Change what a listener watches (followers, following or both), or pause/resume it. Get the listener id from list_listeners. Only the fields you pass are changed.",
    inputs: {
      id: z.string().describe("Listener id from list_listeners"),
      listen_followers: z.boolean().optional().describe("Watch for new followers"),
      listen_following: z.boolean().optional().describe("Watch for new following"),
      is_active: z.boolean().optional().describe("false to pause the listener, true to resume it"),
    },
    run: ({ id, listen_followers, listen_following, is_active }, call) => {
      const body = { id };
      if (listen_followers !== undefined) body.listen_followers = listen_followers;
      if (listen_following !== undefined) body.listen_following = listen_following;
      if (is_active !== undefined) body.is_active = is_active;
      return call("PATCH", "/follower-listeners", body);
    },
    cli: { group: "listeners", action: "update" },
    destructive: true,
  },
  {
    name: "get_listener_events",
    description: "Query the new followers / new following your follower listeners have detected, newest first — including any you missed in your webhook. Each event has the watched handle, when it was detected, and the person's full profile (handle, name, bio, location, website, follower/following counts, verified). All filters are optional.",
    inputs: {
      listener_id: z.string().optional().describe("Only events from this listener (id from list_listeners)"),
      target_handle: z.string().optional().describe("Only events for this watched account"),
      type: z.enum(["followers", "following"]).optional().describe("followers = new_follower events, following = new_following events"),
      since: z.string().optional().describe("Only events detected on/after this ISO date or datetime, e.g. 2026-10-12"),
      until: z.string().optional().describe("Only events detected on/before this ISO date or datetime"),
      handle: z.string().optional().describe("The person's X handle (exact match, case-insensitive)"),
      search: z.string().optional().describe("Keyword in the person's name, handle or bio"),
      min_followers: z.number().optional().describe("Person has at least this many followers"),
      max_followers: z.number().optional().describe("Person has at most this many followers"),
      verified: z.boolean().optional().describe("Only verified (true) or unverified (false) people"),
      limit: z.number().optional().describe("Max events to return (default 50, max 500)"),
      offset: z.number().optional().describe("Pagination offset"),
    },
    run: (params, call) => call("GET", "/follower-listeners/events", null, params),
    cli: { group: "listeners", action: "events" },
  },
  {
    name: "remove_listener",
    description: "Stop watching an X account and delete its listener. Get the listener id from list_listeners. To stop temporarily instead, use update_listener with is_active false.",
    inputs: {
      id: z.string().describe("Listener id from list_listeners"),
    },
    run: ({ id }, call) => call("DELETE", "/follower-listeners", { id }),
    cli: { group: "listeners", action: "remove" },
    destructive: true,
  },
];

// ─── WEBHOOKS, ENRICHMENT, PEOPLE ────────────────────────────────────────────

const dataTools = [
  {
    name: "get_webhook_info",
    description: "Get documentation for webhook events and payload structure.",
    inputs: {},
    // Static docs: no API call.
    run: async () => ({
      description: "Webhooks send real-time POST requests when events occur.",
      events: { new_reply: "First reply from prospect.", reply_back_and_forth: "Follow-up reply.", account_paused: "Account disconnected.", new_follower: "A watched account (see list_listeners) gained a new follower.", new_following: "A watched account followed someone new." },
      configuration: "Configure webhook URLs in Settings.",
    }),
    cli: { group: "webhooks", action: "info" },
  },
  {
    name: "enrich_twitter",
    description: "Find a person's Twitter/X profile from their name and company.",
    inputs: {
      firstName: z.string().describe("Person's first name"),
      lastName: z.string().describe("Person's last name"),
      companyName: z.string().describe("Person's company name"),
    },
    run: ({ firstName, lastName, companyName }, call) =>
      call("POST", "/enrich/twitter", { firstName, lastName, companyName }),
    cli: { group: "enrich", action: "twitter" },
    destructive: true,
  },
  {
    name: "enrich_email",
    description: "Find a person's email from their Twitter/X handle.",
    inputs: {
      handle: z.string().describe("Twitter/X handle (e.g. 'elonmusk' or '@elonmusk')"),
    },
    run: ({ handle }, call) => call("POST", "/enrich/email", { handle }),
    cli: { group: "enrich", action: "email" },
    destructive: true,
  },
  {
    name: "get_enrichment_credits",
    description: "Check your enrichment credit balance.",
    inputs: {},
    run: (args, call) => call("GET", "/enrichment/credits"),
    cli: { group: "enrich", action: "credits" },
  },
  {
    name: "search_people",
    description: "Search the Scrapely People database — millions of Twitter/X profiles. Filter by bio keywords, location, follower/following counts, website, and more. Count-only queries are free; row queries cost 1 credit per row.",
    inputs: {
      bio_contains: z.array(z.string()).optional().describe("Bio must contain ANY of these keywords (case-insensitive)"),
      bio_contains_all: z.array(z.string()).optional().describe("Bio must contain ALL of these keywords"),
      bio_excludes: z.array(z.string()).optional().describe("Exclude profiles whose bio contains any of these"),
      name_contains: z.array(z.string()).optional().describe("Name must contain ANY of these keywords"),
      name_contains_all: z.array(z.string()).optional().describe("Name must contain ALL of these keywords"),
      location_contains: z.array(z.string()).optional().describe("Location must contain ANY of these keywords"),
      location_contains_all: z.array(z.string()).optional().describe("Location must contain ALL of these keywords"),
      location_excludes: z.array(z.string()).optional().describe("Exclude profiles with location containing any of these"),
      handle_contains: z.string().optional().describe("Handle must contain this substring"),
      min_followers: z.number().optional().describe("Minimum follower count"),
      max_followers: z.number().optional().describe("Maximum follower count"),
      min_following: z.number().optional().describe("Minimum following count"),
      max_following: z.number().optional().describe("Maximum following count"),
      has_website: z.boolean().optional().describe("Filter by whether profile has a website"),
      min_updated_at: z.string().optional().describe("Only profiles updated on or after this date (ISO 8601)"),
      max_updated_at: z.string().optional().describe("Only profiles updated on or before this date (ISO 8601)"),
      fields: z.array(z.string()).optional().describe("Specific fields to return"),
      count_only: z.boolean().optional().describe("Return only the count (free, no credits used)"),
      sort_by: z.enum(["follower_count", "following_count", "updated_at", "twitter_handle", "name"]).optional(),
      sort_order: z.enum(["desc", "asc"]).optional(),
      limit: z.number().optional().describe("Max rows to return (max 1,000)"),
      offset: z.number().optional().describe("Pagination offset"),
    },
    run: (params, call) => call("POST", "/people/search", params),
    cli: { group: "people", action: "search" },
    destructive: true,
  },
  {
    name: "get_people_credits",
    description: "Check your People database search credits balance and reset date.",
    inputs: {},
    run: (args, call) => call("GET", "/people/credits"),
    cli: { group: "people", action: "credits" },
  },
  {
    name: "get_people_schema",
    description: "Get the People database table schema — all available columns and their data types.",
    inputs: {},
    run: (args, call) => call("GET", "/people/schema"),
    cli: { group: "people", action: "schema" },
  },
];

// ─── SCHEDULED TWEETS & FEEDBACK ─────────────────────────────────────────────

const tweetTools = [
  {
    name: "schedule_tweet",
    description: "Schedule a tweet to be posted at a specific time",
    inputs: {
      account_id: z.string().describe("The account UUID to post from"),
      tweet_text: z.string().describe("Tweet content"),
      scheduled_at: z.string().describe("ISO 8601 timestamp (must be in the future)"),
    },
    run: ({ account_id, tweet_text, scheduled_at }, call) =>
      call("POST", "/scheduled-tweets", { account_id, tweet_text, scheduled_at }),
    cli: { group: "tweets", action: "schedule" },
    destructive: true,
  },
  {
    name: "list_scheduled_tweets",
    description: "List scheduled tweets with optional filters",
    inputs: {
      account_id: z.string().optional(),
      status: z.enum(["pending", "posted", "failed"]).optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    run: ({ account_id, status, limit, offset }, call) =>
      call("GET", "/scheduled-tweets", null, { account_id, status, limit, offset }),
    cli: { group: "tweets", action: "list" },
  },
  {
    name: "cancel_scheduled_tweet",
    description: "Cancel a pending scheduled tweet",
    inputs: {
      tweet_id: z.string().describe("The scheduled tweet UUID to cancel"),
    },
    run: ({ tweet_id }, call) => call("DELETE", "/scheduled-tweets", { tweet_id }),
    cli: { group: "tweets", action: "cancel" },
    destructive: true,
  },
  {
    name: "submit_feedback",
    description: "Report a bug or a confusing tool to the Scrapely team. Use this when a tool returns an error you believe is Scrapely's fault, or when a tool's description didn't match how it behaved. Never include cookies, proxy credentials, PINs or API keys.",
    inputs: {
      tool: z.string().describe("Name of the tool that failed or confused you (e.g. launch_campaign)"),
      what_happened: z.string().describe("What you were trying to do and what went wrong, in your own words"),
      error_message: z.string().optional().describe("The error text the tool returned, if any"),
      suggestion: z.string().optional().describe("What would have made this work or clearer"),
    },
    run: ({ tool, what_happened, error_message, suggestion }, call) =>
      call("POST", "/feedback", { source: "mcp", tool, what_happened, error_message, suggestion }),
    cli: { group: "feedback", action: "send" },
  },
];

// ─── Registry ────────────────────────────────────────────────────────────────

// hosted: true for the remote HTTP server, which must not offer upload_media's file_path.
export function buildTools({ hosted = false } = {}) {
  return [
    ...accountTools,
    ...scrapingTools,
    ...campaignTools(hosted),
    ...conversationTools,
    ...listenerTools,
    ...dataTools,
    ...tweetTools,
  ];
}

// The local build (npx MCP server and CLI).
export const tools = buildTools();
