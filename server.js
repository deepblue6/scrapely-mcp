#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── Configuration ───────────────────────────────────────────────────────────

const API_BASE = "https://app.scrapely.co/api/v1";
const API_KEY = process.env.SCRAPELY_API_KEY;

if (!API_KEY) {
  console.error("ERROR: SCRAPELY_API_KEY environment variable is required.");
  console.error("Set it with: export SCRAPELY_API_KEY=sk_live_your_key_here");
  process.exit(1);
}

// ─── API Helper ──────────────────────────────────────────────────────────────

async function apiCall(method, path, body = null, queryParams = null) {
  let url = `${API_BASE}${path}`;

  if (queryParams) {
    const filtered = Object.fromEntries(
      Object.entries(queryParams).filter(([, v]) => v !== undefined && v !== null)
    );
    const qs = new URLSearchParams(filtered).toString();
    if (qs) url += `?${qs}`;
  }

  const options = {
    method,
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
    },
  };

  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      `API Error ${res.status}: ${data.message || data.error || JSON.stringify(data)}`
    );
  }

  return data;
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "Scrapely",
  version: "1.0.0",
});

// ─── ACCOUNTS ────────────────────────────────────────────────────────────────

server.tool(
  "list_accounts",
  "List all connected Twitter/X accounts in the workspace with their status, proxy info, and sending stats",
  {},
  async () => {
    const data = await apiCall("GET", "/accounts");
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "add_account",
  "Add a new Twitter/X account to the workspace. Requires cookies (ct0 + auth_token), a proxy, proxy auth credentials, and the X chat PIN.",
  {
    handle: z.string().describe("Twitter handle (with or without @)"),
    cookies: z
      .array(
        z.object({
          name: z.string(),
          value: z.string(),
          domain: z.string(),
        })
      )
      .describe("Array of cookie objects — must include ct0 and auth_token"),
    proxy: z.string().describe("Proxy URL (e.g., http://proxy.example.com:8080)"),
    proxy_auth: z.string().describe("Proxy auth in username:password format"),
    xchat_pin: z.string().describe("X chat PIN code"),
  },
  async ({ handle, cookies, proxy, proxy_auth, xchat_pin }) => {
    const data = await apiCall("POST", "/accounts", {
      handle,
      cookies,
      proxy,
      proxy_auth,
      xchat_pin,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "remove_account",
  "Remove a Twitter/X account from the workspace. Provide either the account UUID or the handle.",
  {
    account_id: z.string().optional().describe("The account UUID to remove"),
    handle: z.string().optional().describe("Twitter handle to remove"),
  },
  async ({ account_id, handle }) => {
    const body = {};
    if (account_id) body.account_id = account_id;
    if (handle) body.handle = handle;
    const data = await apiCall("DELETE", "/accounts", body);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "update_cookies",
  "Update cookies for an existing Twitter/X account (e.g., when the session expires). This also reactivates the account if it was disabled.",
  {
    account_id: z.string().describe("The account UUID"),
    cookies: z
      .array(
        z.object({
          name: z.string(),
          value: z.string(),
          domain: z.string(),
        })
      )
      .describe("Array of cookie objects — must include ct0 and auth_token"),
  },
  async ({ account_id, cookies }) => {
    const data = await apiCall("PUT", "/accounts/cookies", {
      account_id,
      cookies,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "toggle_pause",
  "Pause or unpause DM sending for a Twitter/X account",
  {
    account_id: z.string().describe("The account UUID"),
    is_paused: z.boolean().describe("true to pause, false to unpause"),
  },
  async ({ account_id, is_paused }) => {
    const data = await apiCall("PATCH", "/accounts/pause", {
      account_id,
      is_paused,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "toggle_followups_pause",
  "Pause or unpause follow-up messages for a Twitter/X account",
  {
    account_id: z.string().describe("The account UUID"),
    followups_paused: z.boolean().describe("true to pause, false to unpause"),
  },
  async ({ account_id, followups_paused }) => {
    const data = await apiCall("PATCH", "/accounts/pause-followups", {
      account_id,
      followups_paused,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "update_proxy",
  "Update the proxy settings for an existing Twitter/X account. Requires the account UUID, a new proxy URL, and proxy auth credentials.",
  {
    account_id: z.string().describe("The account UUID"),
    proxy: z.string().describe("Proxy URL (e.g., http://proxy.example.com:8080 or 161.77.187.46:12323)"),
    proxy_auth: z.string().describe("Proxy auth in username:password format"),
  },
  async ({ account_id, proxy, proxy_auth }) => {
    const data = await apiCall("PUT", "/accounts/proxy", {
      account_id,
      proxy,
      proxy_auth,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "get_account_tags",
  "Get tags for a specific account or all accounts. Tags are labels you can assign to accounts for organization.",
  {
    account_id: z
      .string()
      .optional()
      .describe("Account UUID. Omit to get tags for all accounts."),
  },
  async ({ account_id }) => {
    const data = await apiCall("GET", "/accounts/tags", null, { account_id });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "set_account_tags",
  "Replace all tags for an account. Pass an empty array to clear all tags. Tags are normalized to lowercase alphanumeric with hyphens.",
  {
    account_id: z.string().describe("The account UUID"),
    tags: z
      .array(z.string())
      .describe("Array of tag strings to set (replaces existing tags)"),
  },
  async ({ account_id, tags }) => {
    const data = await apiCall("PUT", "/accounts/tags", { account_id, tags });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "update_account_tags",
  "Add or remove individual tags on an account without replacing the full list. Provide add and/or remove arrays.",
  {
    account_id: z.string().describe("The account UUID"),
    add: z
      .array(z.string())
      .optional()
      .describe("Tags to add"),
    remove: z
      .array(z.string())
      .optional()
      .describe("Tags to remove"),
  },
  async ({ account_id, add, remove }) => {
    const body = { account_id };
    if (add) body.add = add;
    if (remove) body.remove = remove;
    const data = await apiCall("PATCH", "/accounts/tags", body);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// ─── LEAD SCRAPING ───────────────────────────────────────────────────────────

server.tool(
  "create_scraping_source",
  "Create a new lead source by scraping followers and/or following from Twitter/X accounts. Supports keyword filters, follower count ranges, location exclusions, and website filters.",
  {
    name: z.string().describe("Name for the lead source"),
    sources: z
      .array(
        z.object({
          handle: z.string().describe("Twitter handle to scrape"),
          followers: z.boolean().optional().describe("Scrape their followers"),
          following: z.boolean().optional().describe("Scrape who they follow"),
        })
      )
      .describe("Array of accounts to scrape from"),
    filters: z
      .object({
        includeKeywords: z
          .array(z.array(z.string()))
          .optional()
          .describe("Keyword groups to include (bio matching)"),
        excludeKeywords: z
          .array(z.array(z.string()))
          .optional()
          .describe("Keyword groups to exclude"),
        includeWithinLogic: z
          .enum(["AND", "OR"])
          .optional()
          .describe("Logic within each include group"),
        includeBetweenLogic: z
          .enum(["AND", "OR"])
          .optional()
          .describe("Logic between include groups"),
        excludeWithinLogic: z
          .enum(["AND", "OR"])
          .optional()
          .describe("Logic within each exclude group"),
        excludeBetweenLogic: z
          .enum(["AND", "OR"])
          .optional()
          .describe("Logic between exclude groups"),
        locationExcludeKeywords: z
          .array(z.string())
          .optional()
          .describe("Location keywords to exclude"),
        followers: z
          .object({
            min: z.number().optional(),
            max: z.number().optional(),
          })
          .optional()
          .describe("Follower count range filter"),
        following: z
          .object({
            min: z.number().optional(),
            max: z.number().optional(),
          })
          .optional()
          .describe("Following count range filter"),
        hasWebsite: z
          .boolean()
          .nullable()
          .optional()
          .describe("true = only with website, false = only without, null = no filter"),
      })
      .optional()
      .describe("Filter configuration for scraped leads"),
  },
  async ({ name, sources, filters }) => {
    const body = { name, sources };
    if (filters) body.filters = filters;
    const data = await apiCall("POST", "/scraping-sources", body);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "check_scraping_status",
  "Check the status of scraping jobs. Pass an ID for a specific source, or omit for a paginated list.",
  {
    id: z.string().optional().describe("Specific scraping source ID"),
    limit: z.number().optional().describe("Results per page (max 100)"),
    offset: z.number().optional().describe("Pagination offset"),
  },
  async ({ id, limit, offset }) => {
    const data = await apiCall("GET", "/scraping-sources", null, {
      id,
      limit,
      offset,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// ─── CAMPAIGNS ───────────────────────────────────────────────────────────────

server.tool(
  "launch_campaign",
  "Launch a DM campaign targeting leads from scraping sources. Supports A/B testing with message variants, follow-ups, auto-follow, auto-like, and auto-comment before DM.",
  {
    name: z.string().describe("Campaign name"),
    message: z
      .string()
      .optional()
      .describe("Message text (supports {{firstName}} placeholder)"),
    message_variants: z
      .array(
        z.object({
          message: z.string().describe("Variant message text"),
          followups: z
            .array(
              z.object({
                wait_time: z.number().describe("Wait time before followup"),
                wait_unit: z.enum(["hours", "days", "weeks"]).describe("Time unit"),
                message: z.string().describe("Followup message text"),
              })
            )
            .optional()
            .describe("Follow-up messages for this variant"),
        })
      )
      .optional()
      .describe("Message variants for A/B testing (max 5)"),
    lead_source_ids: z
      .array(z.string())
      .describe("Lead source IDs to target"),
    account_ids: z
      .array(z.string())
      .optional()
      .describe("Account IDs to send from (defaults to all)"),
    followups: z
      .array(
        z.object({
          wait_time: z.number(),
          wait_unit: z.enum(["hours", "days", "weeks"]),
          message: z.string(),
        })
      )
      .optional()
      .describe("Follow-up messages (when not using message_variants)"),
    max_leads: z.number().optional().describe("Max leads to target (max 25,000)"),
    enable_follow: z
      .boolean()
      .optional()
      .describe("Follow the lead before DMing"),
    enable_like: z
      .boolean()
      .optional()
      .describe("Like the lead's recent post before DMing"),
    enable_comment: z
      .boolean()
      .optional()
      .describe("Comment on the lead's post before DMing"),
    comment_template: z
      .string()
      .optional()
      .describe("AI personalization template for auto-comments"),
  },
  async (args) => {
    const body = { ...args };
    const data = await apiCall("POST", "/campaigns", body);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "list_campaigns",
  "List campaigns with basic stats (total, completed, pending, failed, progress)",
  {
    limit: z.number().optional().describe("Results per page"),
    offset: z.number().optional().describe("Pagination offset"),
  },
  async ({ limit, offset }) => {
    const data = await apiCall("GET", "/campaigns", null, { limit, offset });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "get_campaign_analytics",
  "Get detailed campaign analytics including reply rates, sentiment analysis (positive/negative/neutral), 24-hour reply and positive reply counts, per-variant A/B testing stats, full DM copy (message variants with follow-up sequences), engagement action settings (auto-follow, auto-like, auto-comment), and individual reply records per campaign (conversation_id, replier_handle, sentiment, dm_job_id) for linking to conversations/CRM",
  {
    campaign_name: z
      .string()
      .optional()
      .describe("Filter to a specific campaign"),
    account_id: z
      .string()
      .optional()
      .describe("Filter to a specific account"),
  },
  async ({ campaign_name, account_id }) => {
    const data = await apiCall("GET", "/campaigns/analytics", null, {
      campaign_name,
      account_id,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// ─── CONVERSATIONS ───────────────────────────────────────────────────────────

server.tool(
  "fetch_conversations",
  "Fetch conversations or list conversations with optional filters.",
  {
    conversation_id: z
      .string()
      .optional()
      .describe("Get a single conversation with all messages"),
    account_id: z
      .string()
      .optional()
      .describe("Filter by Twitter account"),
    handle: z
      .string()
      .optional()
      .describe("Filter by receiver handle"),
    limit: z.number().optional().describe("Results per page (max 100)"),
    cursor: z.string().optional().describe("Pagination cursor (recommended)"),
    offset: z.number().optional().describe("Pagination offset (deprecated, use cursor)"),
    include_messages: z
      .boolean()
      .optional()
      .describe("Include full message history in list view"),
  },
  async ({ conversation_id, account_id, handle, limit, cursor, offset, include_messages }) => {
    const data = await apiCall("GET", "/conversations", null, {
      conversation_id,
      account_id,
      handle,
      limit,
      cursor,
      offset,
      include_messages,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "send_dm",
  "Send a direct message to an existing conversation",
  {
    conversation_id: z.string().describe("The conversation ID"),
    message: z.string().describe("Message text (max 10,000 chars)"),
    account_id: z.string().describe("Twitter account ID to send from"),
  },
  async ({ conversation_id, message, account_id }) => {
    const data = await apiCall("POST", "/dm/send", {
      conversation_id,
      message,
      account_id,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// ─── CRM ─────────────────────────────────────────────────────────────────────

server.tool(
  "get_crm_data",
  "Get conversations organized by CRM tags (interested, negative, booked, etc.). Returns columns with conversations sorted by tag.",
  {
    tag: z.string().optional().describe("Filter to a specific tag"),
    limit: z.number().optional().describe("Results per page"),
    include_messages: z
      .boolean()
      .optional()
      .describe("Include full message history"),
  },
  async ({ tag, limit, include_messages }) => {
    const data = await apiCall("GET", "/crm/conversations", null, {
      tag,
      limit,
      include_messages,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "update_crm",
  "Update CRM data for a conversation — notes, deal value, currency, and/or tag",
  {
    conversation_id: z.string().describe("The conversation ID"),
    account_handle: z.string().describe("The account handle"),
    notes: z.string().optional().describe("Notes for the conversation"),
    deal_value: z.number().optional().describe("Deal value"),
    deal_currency: z
      .string()
      .optional()
      .describe("Currency code (default: USD)"),
    tag: z
      .string()
      .nullable()
      .optional()
      .describe("Tag to set (null to remove)"),
  },
  async ({ conversation_id, account_handle, notes, deal_value, deal_currency, tag }) => {
    const body = { conversation_id, account_handle };
    if (notes !== undefined) body.notes = notes;
    if (deal_value !== undefined) body.deal_value = deal_value;
    if (deal_currency !== undefined) body.deal_currency = deal_currency;
    if (tag !== undefined) body.tag = tag;
    const data = await apiCall("PATCH", "/crm/update", body);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// ─── WEBHOOKS ───────────────────────────────────────────────────────────────

server.tool(
  "get_webhook_info",
  "Get documentation for webhook events and payload structure. Describes the flat payload format sent for new_reply and reply_back_and_forth events, including all lead fields (lead_reply_sentiment, lead_website, etc.).",
  {},
  async () => {
    const info = {
      description:
        "Webhooks send real-time POST requests to your configured URL(s) when events occur. Reply payloads use a flat structure (no nested 'data' object). Lead fields are prefixed with 'lead_'.",
      events: {
        new_reply:
          "Sent when a prospect replies to your DM for the first time. Includes sentiment and response_count.",
        reply_back_and_forth:
          "Sent when a prospect sends a follow-up reply in an existing conversation. sentiment and response_count are null.",
        account_paused:
          "Sent when a Twitter account is disconnected or paused.",
      },
      reply_payload_fields: {
        event: "string — 'new_reply' or 'reply_back_and_forth'",
        timestamp: "string (ISO 8601)",
        is_back_and_forth: "boolean",
        conversation_id: "string | null",
        unibox_url: "string | null — direct link to conversation in Scrapely",
        account_twitter_handle: "string — your account handle",
        account_id: "string",
        sender_id: "string | null",
        sender_screen_name: "string — the prospect's handle",
        message_text: "string",
        message_time: "string (ISO 8601)",
        profile_url: "string | null — https://x.com/{handle}",
        sentiment:
          "string | null — AI-detected sentiment (positive/negative/neutral). Only for new_reply.",
        response_count: "integer | null — only for new_reply",
        lead_id: "string | null",
        lead_lead_id: "string | null",
        lead_twitter_handle: "string",
        lead_name: "string | null",
        lead_description: "string | null — Twitter bio",
        lead_follower_count: "integer | null",
        lead_following_count: "integer | null",
        lead_location: "string | null",
        lead_website: "string — extracted website or 'no website'",
        lead_replied: "boolean | null",
        lead_replied_at: "string (ISO 8601) | null",
        lead_reply_message: "string | null",
        lead_reply_sentiment:
          "string | null — AI-detected sentiment of the lead's reply (positive/negative/neutral)",
        lead_created_at: "string (ISO 8601) | null",
        lead_dm_status: "string | null",
      },
      configuration:
        "Configure webhook URLs in Settings. Supports multiple URLs per workspace. Slack webhooks get a formatted message; all other endpoints receive the flat JSON payload.",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
    };
  }
);

// ─── ENRICHMENT ─────────────────────────────────────────────────────────────

server.tool(
  "enrich_twitter",
  "Find a person's Twitter/X profile from their name and company. Uses search + AI matching to return the best profile match with a confidence score. Results are cached for 24 hours.",
  {
    firstName: z.string().describe("Person's first name"),
    lastName: z.string().describe("Person's last name"),
    companyName: z.string().describe("Person's company name"),
  },
  async ({ firstName, lastName, companyName }) => {
    const data = await apiCall("POST", "/enrich/twitter", {
      firstName,
      lastName,
      companyName,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "enrich_email",
  "Find a person's email address from their Twitter/X handle. Fetches the profile, extracts name and company, resolves the company domain, and finds + verifies the email. Typical response time is 10-30 seconds.",
  {
    handle: z.string().describe("Twitter/X handle (e.g. 'elonmusk' or '@elonmusk')"),
  },
  async ({ handle }) => {
    const data = await apiCall("POST", "/enrich/email", { handle });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// ─── SCHEDULED TWEETS ────────────────────────────────────────────────────────

server.tool(
  "schedule_tweet",
  "Schedule a tweet to be posted at a specific time from one of your accounts",
  {
    account_id: z.string().describe("The account UUID to post from"),
    tweet_text: z.string().describe("Tweet content (max 10,000 chars for X Premium)"),
    scheduled_at: z
      .string()
      .describe("ISO 8601 timestamp for when to post (must be in the future)"),
  },
  async ({ account_id, tweet_text, scheduled_at }) => {
    const data = await apiCall("POST", "/scheduled-tweets", {
      account_id,
      tweet_text,
      scheduled_at,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "list_scheduled_tweets",
  "List scheduled tweets with optional filters for account, status, and pagination",
  {
    account_id: z
      .string()
      .optional()
      .describe("Filter by specific account UUID"),
    status: z
      .enum(["pending", "posted", "failed"])
      .optional()
      .describe("Filter by status"),
    limit: z.number().optional().describe("Max results (default 50, max 100)"),
    offset: z.number().optional().describe("Pagination offset"),
  },
  async ({ account_id, status, limit, offset }) => {
    const data = await apiCall("GET", "/scheduled-tweets", null, {
      account_id,
      status,
      limit,
      offset,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "cancel_scheduled_tweet",
  "Cancel a pending scheduled tweet before it gets posted",
  {
    tweet_id: z.string().describe("The scheduled tweet UUID to cancel"),
  },
  async ({ tweet_id }) => {
    const data = await apiCall("DELETE", "/scheduled-tweets", { tweet_id });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// ─── Start Server ────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Scrapely MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
