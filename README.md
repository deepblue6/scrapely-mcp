# Scrapely MCP Server

An MCP (Model Context Protocol) server that wraps the [Scrapely](https://scrapely.co) API, letting AI assistants like Claude directly manage your Twitter/X DM outreach — campaigns, lead scraping, conversations, CRM, and scheduled tweets — all through natural language.

**GitHub:** [github.com/deepblue6/scrapely-mcp](https://github.com/deepblue6/scrapely-mcp)

## Quick Start

You need a Scrapely API key. Generate one from **Settings** in your [Scrapely dashboard](https://app.scrapely.co).

### Use in Claude (claude.ai) — Recommended

Add Scrapely as a connector in Claude. No install needed.

1. Go to **Claude Settings → Connectors → Add custom connector**
2. Fill in:
   - **Name:** `Scrapely`
   - **Remote MCP server URL:** `https://mcp.scrapely.co/mcp`
3. Click **Add**
4. When prompted, enter your Scrapely API key

That's it. Open any Claude conversation and start using Scrapely tools.

### Use in Claude Code

One command (replace `sk_live_...` with your real key):

```bash
claude mcp add --transport http --scope user scrapely https://mcp.scrapely.co/mcp \
  --header "Authorization: Bearer sk_live_your_key_here"
```

No install, no Node.js required. The `--scope user` flag makes it available across all your projects.

To update or rotate your key, remove and re-add:

```bash
claude mcp remove scrapely --scope user
claude mcp add --transport http --scope user scrapely https://mcp.scrapely.co/mcp \
  --header "Authorization: Bearer sk_live_new_key_here"
```

### Use in Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "scrapely": {
      "command": "npx",
      "args": ["scrapely-mcp"],
      "env": {
        "SCRAPELY_API_KEY": "sk_live_your_key_here"
      }
    }
  }
}
```

### Other MCP clients

Any MCP-compatible client works. Just run `npx scrapely-mcp` with `SCRAPELY_API_KEY` set in the environment.

## Available Tools

| Tool | Description |
|------|-------------|
| `list_accounts` | List all connected Twitter/X accounts |
| `add_account` | Add a new account (cookies + proxy) |
| `remove_account` | Remove an account by ID or handle |
| `update_cookies` | Refresh cookies for an existing account |
| `update_proxy` | Update proxy settings for an account |
| `toggle_pause` | Pause/unpause DM sending |
| `toggle_followups_pause` | Pause/unpause follow-up messages |
| `update_handle` | Update an account's stored handle after renaming it on X |
| `toggle_warmup` | Enable/disable warmup mode |
| `get_account_tags` | Get tags for accounts |
| `set_account_tags` | Replace all tags for an account |
| `update_account_tags` | Add or remove individual tags |
| `create_scraping_source` | Scrape followers/following with keyword and count filters |
| `check_scraping_status` | Check progress of scraping jobs |
| `get_scraping_source_leads` | Get leads from a scraping source |
| `import_leads` | Import your own list of leads (handles or x.com URLs) into a new lead source |
| `launch_campaign` | Launch a DM campaign with A/B testing, auto-follow/like/comment |
| `launch_import_campaign` | Launch a campaign from your own lead list with custom {{variables}}, send window and days |
| `pause_campaign` | Pause or unpause a campaign |
| `list_campaigns` | List campaigns with stats |
| `get_campaign_detail` | Get detailed campaign info and settings |
| `get_campaign_leads` | List a campaign's leads with status, reply info and custom_fields |
| `add_leads_to_campaign` | Add leads to a campaign by handle, or with custom_fields for import campaigns (any number; chunked automatically) |
| `add_lead_source_to_campaign` | Add every lead from a lead source to a campaign |
| `rename_campaign` | Rename a campaign (DMs, stats and pause state carry over) |
| `edit_campaign` | Edit a campaign's messages, follow-ups, engagement actions and send window |
| `upload_media` | Upload an image (link, base64, or local file with `npx`) to attach to campaign DMs and follow-ups |
| `get_campaign_analytics` | Detailed analytics: reply rates, sentiment, variant stats. Supports date range filtering. |
| `fetch_conversations` | Fetch conversations with optional message history |
| `send_dm` | Send a DM to an existing conversation |
| `get_crm_data` | Get conversations organized by CRM tags |
| `update_crm` | Update notes, deal value, and tags |
| `enrich_twitter` | Find a person's Twitter profile from name + company |
| `enrich_email` | Find a person's email from their Twitter handle |
| `get_enrichment_credits` | Check enrichment credit balance |
| `search_people` | Search the People database of X profiles by bio, location, follower counts and more |
| `get_people_credits` | Check your People search credit balance |
| `get_people_schema` | Get the People database columns and types |
| `list_listeners` | List follower listeners (accounts watched for new followers/following) |
| `add_listener` | Watch an X account for new followers and/or following (webhook events) |
| `update_listener` | Switch followers/following on or off, or pause/resume a listener |
| `get_listener_events` | Query detected new followers/following with filters (watched handle, type, date range, handle, keyword, follower count, verified) |
| `remove_listener` | Stop watching an account and delete its listener |
| `get_webhook_info` | Get webhook event types and payload structure docs |
| `schedule_tweet` | Schedule a tweet for later |
| `list_scheduled_tweets` | List scheduled tweets with filters |
| `cancel_scheduled_tweet` | Cancel a pending scheduled tweet |
| `submit_feedback` | Report a bug or confusing tool to the Scrapely team |

## Example Prompts

Once connected to Claude, you can say things like:

- "Show me all my connected accounts"
- "Scrape followers of @naval and @paulg, filter for founders with 1k+ followers"
- "Launch a campaign called Q1 Outreach targeting my Tech Founders source"
- "What are my campaign analytics? Which variant is performing best?"
- "Show me campaign stats from January 1st to January 31st"
- "Show me all interested replies in the CRM"
- "Send a followup to conversation 123456-789012"
- "Schedule a tweet from my main account for tomorrow at 9am"
- "Find the Twitter profile for John Doe at Acme Corp"
- "Find the email for @elonmusk"
- "Pause DM sending on my backup account"
- "Watch @naval for new followers and send them to my webhook"

## Self-Hosting the Remote Server

If you want to host the MCP server yourself instead of using `mcp.scrapely.co`:

```bash
# Clone and install
git clone https://github.com/deepblue6/scrapely-mcp.git
cd scrapely-mcp
npm install

# Run in HTTP mode
PORT=3100 node server.js
```

The server listens on `/mcp` and authenticates via `Authorization: Bearer <scrapely_api_key>`.

Put it behind nginx/caddy with TLS, then use your domain as the connector URL.

## Testing with MCP Inspector

```bash
SCRAPELY_API_KEY=sk_live_your_key npx @modelcontextprotocol/inspector npx scrapely-mcp
```

This opens a browser GUI where you can test every tool before connecting it to Claude.

## Requirements

- Node.js 18+
- A Scrapely account with an API key

## License

MIT
