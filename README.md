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

## Command-line tool (CLI)

The same package also gives you a `scrapely` command, so you can run your Scrapely outreach from the terminal or from your own scripts. It can do everything the MCP server can: same features, same options.

### Install

```bash
npm install -g scrapely-mcp
```

This installs the `scrapely` command. To try it without installing anything, put `npx -p scrapely-mcp` in front of any command:

```bash
npx -p scrapely-mcp scrapely campaigns list
```

> `npx scrapely` (without `-p scrapely-mcp`) is **not** this tool. It downloads a different npm package that happens to have the same name.

Requires Node.js 18.3 or newer.

### Log in

```bash
scrapely login
```

Create an API key at [app.scrapely.co/settings/integrations](https://app.scrapely.co/settings/integrations), then paste it when asked (what you type stays hidden). Scrapely checks the key before saving it.

- The key is saved in `~/.config/scrapely/config.json` (`%APPDATA%\scrapely\config.json` on Windows), and only your user can read that file.
- `scrapely whoami` shows which key is in use (only its last 4 characters) and where it comes from.
- `scrapely logout` removes the saved key.
- In scripts and CI you can skip `login` and set the `SCRAPELY_API_KEY` environment variable instead. When it is set, it wins over saved keys (unless you pass `--profile`).

### Several workspaces (agencies)

Save one key per workspace under a profile name, then pick it per command or make it the default:

```bash
scrapely login --profile bitvault
scrapely campaigns list --profile bitvault
scrapely profiles use bitvault      # use it by default
scrapely profiles list              # names, masked keys, which one is the default
scrapely profiles remove bitvault
```

The key used is, first match wins: `--profile`, `SCRAPELY_API_KEY`, `SCRAPELY_PROFILE` (a profile name), the default profile, then a profile named `default` if it is the only one. Commands that change things show the profile in their "Continue?" question (and print it when you pass `--yes`), so you always know which workspace you're changing. When `SCRAPELY_API_KEY` is set while you have saved profiles, every command prints a note saying it is being used instead.

### Use with AI agents (Claude Code, Codex, Cursor)

One command teaches your coding agent to use the CLI, with nothing to copy and paste:

```bash
scrapely setup-agent
```

It writes a Claude Code skill to `~/.claude/skills/scrapely/SKILL.md` and a Scrapely section to `./AGENTS.md` (read by Codex, Cursor and many other agents), after showing you the files and asking first. In `AGENTS.md` it only touches the block between `<!-- scrapely:start -->` and `<!-- scrapely:end -->`, so running it again (for example after upgrading) updates that block and leaves the rest of the file alone.

- `--claude` or `--agents-md` writes just one of them; `--project` puts the skill in this project's `.claude/skills` instead of your home folder.
- `--print` shows the instructions without writing anything.
- A `SKILL.md` you wrote yourself is never replaced unless you add `--force`.

The instructions tell your agent to check `scrapely whoami` first, to ask you to run `scrapely login` yourself (never to paste a key into the chat), to use `--json`, and to get your explicit OK before anything that sends, spends, launches, pauses or deletes. For agencies, they tell it to pick the workspace with `--profile <name>` and always say which profile it used. Then try asking your agent: "show me my Scrapely campaigns".

### Your first 5 minutes

```bash
# 1. See your connected X accounts (copy an ID from the ID column for later)
scrapely accounts list

# 2. See your campaigns and how they are doing
scrapely campaigns list

# 3. Look at one campaign in detail: replies, per-account stats, messages and settings
scrapely campaigns get --campaign-name "Agency owners"

# 4. Count founders in New York with 1,000+ followers in the People database
#    (counting is free; it still asks "Continue?" because full searches use credits)
scrapely people search --bio-contains founder --location-contains "New York" --min-followers 1000 --count-only

# 5. Reply to someone: find the conversation, then send the DM from one of your accounts
scrapely conversations list --limit 10
scrapely dm send --conversation-id <conversation-id> --account-id <account-id> --message "Thanks, talk soon!"
```

Help is built in at every level:

```bash
scrapely --help                    # every group of commands
scrapely campaigns --help          # every command in a group
scrapely campaigns launch --help   # every option of a command, with an example
```

Options are written as `--flags`. For yes/no options, `--include-messages` means yes and `--no-include-messages` means no. For lists, repeat the flag or separate values with commas (`--bio-contains founder,ceo`). Options that take structured data (like a campaign's message variants) accept JSON text, `@file.json` to read it from a file, or `-` to read it from stdin.

### Use it in scripts: `--json`

Results print as easy-to-read tables. Add `--json` to get the raw JSON instead, which is ideal for scripts and tools like `jq`:

```bash
scrapely campaigns list --json | jq '.campaigns[].name'
```

### Confirmation before changes, and `--yes`

Commands that send DMs, spend credits, launch, pause, delete or overwrite something show what they are about to do and ask `Continue? [y/N]` first. Nothing happens unless you answer yes. These commands are marked "yes" in the "Asks first" column below, and with `*` in `scrapely <group> --help`.

To skip the question, add `--yes` (or `-y`). In a script, where there is nobody to answer, these commands stop and do nothing unless you pass `--yes`:

```bash
scrapely campaigns pause --campaign-name "Agency owners" --yes
```

### Call any API endpoint: `scrapely api`

If something you need doesn't have a command yet, `scrapely api` calls any endpoint of the Scrapely API directly with your API key and prints the JSON response. Paths are relative to `https://app.scrapely.co/api/v1`.

```bash
scrapely api GET /campaigns --query limit=5
scrapely api POST /campaigns/pause --data '{"campaign_name":"Agency owners","is_paused":true}'
```

`--data` takes JSON text, `@file.json`, or `-` for stdin. Anything other than a `GET` asks for confirmation first (or pass `--yes`).

### Other options

| Option | What it does |
|--------|--------------|
| `--json` | Print raw JSON instead of tables |
| `-y`, `--yes` | Don't ask "Continue?" before commands that change things |
| `--debug` | Show technical details when something fails |
| `-h`, `--help` | Show help |
| `--version` | Show the installed version |

Once a day the CLI checks npm for a newer version and, if there is one, prints an "Update available" line (on stderr, so `--json` output stays clean). Set `SCRAPELY_NO_UPDATE_CHECK=1` to turn this off; it's also off when `CI` is set.

### All commands

| Command | What it does | Asks first |
|---------|--------------|:----------:|
| `scrapely accounts list` | List all connected Twitter/X accounts in the workspace |  |
| `scrapely accounts add` | Add a new Twitter/X account to the workspace |  |
| `scrapely accounts remove` | Remove a Twitter/X account from the workspace | yes |
| `scrapely accounts update-cookies` | Update cookies for an existing Twitter/X account |  |
| `scrapely accounts pause` | Pause or unpause DM sending for a Twitter/X account | yes |
| `scrapely accounts resume` | Resume DM sending for a paused Twitter/X account | yes |
| `scrapely accounts pause-followups` | Pause or unpause follow-up messages for a Twitter/X account | yes |
| `scrapely accounts resume-followups` | Resume follow-up messages for a Twitter/X account | yes |
| `scrapely accounts update-handle` | Update the Twitter/X handle for an existing account |  |
| `scrapely accounts update-proxy` | Update proxy settings for an existing Twitter/X account |  |
| `scrapely accounts warmup` | Enable or disable warmup mode for a Twitter/X account | yes |
| `scrapely accounts reassign-pending` | Move pending DMs from some accounts to others, split evenly (`--dry-run` previews without asking) | yes |
| `scrapely tags get` | Get tags for a specific account or all accounts |  |
| `scrapely tags set` | Replace all tags for an account | yes |
| `scrapely tags update` | Add or remove individual tags on an account |  |
| `scrapely sources create` | Create a new lead source by scraping followers/following from Twitter/X accounts | yes |
| `scrapely sources list` | List your lead sources (IDs, status, lead counts) |  |
| `scrapely sources performance` | Reply rates by lead source, or by seed within one source (`--lead-source-id`) |  |
| `scrapely sources leads` | Get leads from a specific scraping source |  |
| `scrapely sources import` | Import your own list of leads (e.g. from a CSV) into a new lead source, ready to use in campaigns |  |
| `scrapely campaigns launch` | Launch a DM campaign targeting leads from scraping sources | yes |
| `scrapely campaigns launch-import` | Launch a DM campaign from your own lead list (e.g. a CSV) with custom data columns — same as Import Campaign in the dashboard | yes |
| `scrapely campaigns pause` | Pause or unpause a campaign | yes |
| `scrapely campaigns resume` | Resume a paused campaign | yes |
| `scrapely campaigns leads` | List the leads in a campaign with their status, sending account, reply info and custom_fields (the columns from an import campaign, e.g. a personalized link) |  |
| `scrapely campaigns add-leads` | Add leads to an existing campaign (same as adding leads in the dashboard) | yes |
| `scrapely campaigns add-source` | Add every lead from a lead source (a scrape or import) to an existing campaign, same as Add to Campaign in the dashboard | yes |
| `scrapely campaigns rename` | Rename a campaign |  |
| `scrapely campaigns update` | Edit settings for an existing campaign — message variants, followups, engagement actions, send window/days | yes |
| `scrapely campaigns list` | List campaigns with basic stats |  |
| `scrapely campaigns get` | Get detailed analytics for a single campaign — totals, per-account breakdown, replies, settings (message variants, followups, engagement, send window), and pause state |  |
| `scrapely campaigns analytics` | Get detailed campaign analytics with optional date range filtering |  |
| `scrapely media upload` | Upload an image to attach to campaign DMs or follow-ups |  |
| `scrapely conversations list` | Fetch conversations, with the campaign, lead source and seed each lead came from (filter with `--campaign-name`, `--lead-source-id`) |  |
| `scrapely dm send` | Send a direct message to an existing conversation | yes |
| `scrapely crm get` | Get conversations organized by CRM tags |  |
| `scrapely crm update` | Update CRM data for a conversation |  |
| `scrapely listeners list` | List follower listeners: X accounts being watched for new followers and/or new following |  |
| `scrapely listeners add` | Start watching an X account for new followers and/or new following (same as adding a listener in the dashboard) |  |
| `scrapely listeners update` | Change what a listener watches (followers, following or both), or pause/resume it | yes |
| `scrapely listeners events` | Query the new followers / new following your follower listeners have detected, newest first — including any you missed in your webhook |  |
| `scrapely listeners remove` | Stop watching an X account and delete its listener | yes |
| `scrapely people search` | Search the Scrapely People database — millions of Twitter/X profiles | yes |
| `scrapely people credits` | Check your People database search credits balance and reset date |  |
| `scrapely people schema` | Get the People database table schema — all available columns and their data types |  |
| `scrapely enrich twitter` | Find a person's Twitter/X profile from their name and company | yes |
| `scrapely enrich email` | Find a person's email from their Twitter/X handle | yes |
| `scrapely enrich profile` | Get a public Twitter/X profile from a handle (free) |  |
| `scrapely enrich credits` | Check your enrichment credit balance |  |
| `scrapely tweets schedule` | Schedule a tweet to be posted at a specific time | yes |
| `scrapely tweets list` | List scheduled tweets with optional filters |  |
| `scrapely tweets cancel` | Cancel a pending scheduled tweet | yes |
| `scrapely webhooks info` | Get documentation for webhook events and payload structure |  |
| `scrapely webhooks list` | List your webhook URLs, keys (last 4 characters only) and settings |  |
| `scrapely webhooks add` | Add a webhook URL (`https://` with a domain name, not an IP address), optionally with your own key or a generated one (`--generate-key`, shown once) |  |
| `scrapely webhooks set-key` | Change, rotate or remove a webhook's key | yes |
| `scrapely webhooks remove` | Remove a webhook URL | yes |
| `scrapely webhooks settings` | Turn webhooks on or off | yes |
| `scrapely webhooks test` | Send a sample event to one or all of your webhook URLs |  |
| `scrapely feedback send` | Report a bug or a confusing tool to the Scrapely team |  |

Plus `scrapely login`, `scrapely logout`, `scrapely whoami`, `scrapely profiles`, `scrapely api` and `scrapely help`. Run any command with `--help` to see all of its options.

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
| `reassign_pending_dms` | Move pending DMs to other accounts, split evenly (`dry_run` to preview) |
| `get_account_tags` | Get tags for accounts |
| `set_account_tags` | Replace all tags for an account |
| `update_account_tags` | Add or remove individual tags |
| `create_scraping_source` | Scrape followers/following with keyword and count filters |
| `check_scraping_status` | Check progress of scraping jobs |
| `get_source_performance` | Reply rates by lead source, or by seed within one source |
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
| `fetch_conversations` | Fetch conversations with optional message history, each with its campaign, lead source and seed; filter by campaign or lead source |
| `send_dm` | Send a DM to an existing conversation |
| `get_crm_data` | Get conversations organized by CRM tags |
| `update_crm` | Update notes, deal value, and tags |
| `enrich_twitter` | Find a person's Twitter profile from name + company |
| `enrich_email` | Find a person's email from their Twitter handle |
| `enrich_profile` | Get a public Twitter/X profile from a handle (free) |
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
| `list_webhooks` | List webhook URLs (key previews only, never full keys), on/off settings and event names |
| `add_webhook` | Add a webhook URL (max 10), optionally with an X-Webhook-Key: your own, or generated and shown once |
| `update_webhook_key` | Change, rotate (generate) or remove a webhook's X-Webhook-Key |
| `remove_webhook` | Remove a webhook URL |
| `update_webhook_settings` | Turn webhooks on or off (follower-listener events keep sending) |
| `test_webhook` | Send a sample event to one or all webhook URLs and report each result |
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
- "Add https://hooks.example.com/scrapely as a webhook with a generated key, then send it a test event"

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

- Node.js 18.3+
- A Scrapely account with an API key

## License

MIT
