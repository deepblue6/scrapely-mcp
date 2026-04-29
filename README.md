# Scrapely MCP Server

An MCP (Model Context Protocol) server that wraps the [Scrapely](https://scrapely.co) API, letting AI assistants like Claude directly manage your Twitter/X DM outreach — campaigns, lead scraping, conversations, CRM, and scheduled tweets — all through natural language.

## Install

```bash
npm install -g scrapely-mcp
```

Or run it directly without installing:

```bash
npx scrapely-mcp
```

## Setup

You need a Scrapely API key. Generate one from **Settings** in your [Scrapely dashboard](https://app.scrapely.co).

### Claude Code

```bash
claude mcp add scrapely -e SCRAPELY_API_KEY=sk_live_your_key_here -- npx scrapely-mcp
```

### Claude Desktop

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
| `get_account_tags` | Get tags for accounts |
| `set_account_tags` | Replace all tags for an account |
| `update_account_tags` | Add or remove individual tags |
| `create_scraping_source` | Scrape followers/following with keyword and count filters |
| `check_scraping_status` | Check progress of scraping jobs |
| `launch_campaign` | Launch a DM campaign with A/B testing, auto-follow/like/comment |
| `list_campaigns` | List campaigns with stats |
| `get_campaign_analytics` | Detailed analytics: reply rates, sentiment, variant stats |
| `fetch_conversations` | Fetch conversations with optional message history |
| `send_dm` | Send a DM to an existing conversation |
| `get_crm_data` | Get conversations organized by CRM tags |
| `update_crm` | Update notes, deal value, and tags |
| `enrich_twitter` | Find a person's Twitter profile from name + company |
| `enrich_email` | Find a person's email from their Twitter handle |
| `get_webhook_info` | Get webhook event types and payload structure docs |
| `schedule_tweet` | Schedule a tweet for later |
| `list_scheduled_tweets` | List scheduled tweets with filters |
| `cancel_scheduled_tweet` | Cancel a pending scheduled tweet |

## Example Prompts

Once connected to Claude, you can say things like:

- "Show me all my connected accounts"
- "Scrape followers of @naval and @paulg, filter for founders with 1k+ followers"
- "Launch a campaign called Q1 Outreach targeting my Tech Founders source"
- "What are my campaign analytics? Which variant is performing best?"
- "Show me all interested replies in the CRM"
- "Send a followup to conversation 123456-789012"
- "Schedule a tweet from my main account for tomorrow at 9am"
- "Find the Twitter profile for John Doe at Acme Corp"
- "Find the email for @elonmusk"
- "Pause DM sending on my backup account"

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
