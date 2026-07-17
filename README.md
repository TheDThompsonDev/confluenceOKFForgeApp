# Knowledge Graph for Confluence

Build an AI-native knowledge graph in Confluence with [Forge](https://developer.atlassian.com/platform/forge/).

Teams are drowning in information — articles, research papers, meeting notes, requirements docs. The LLM wiki pattern (popularized by Andrej Karpathy and standardized by the Open Knowledge Format) breaks sources down into cross-linked **concept**, **entity**, and **source** pages that both people and AI agents can navigate. Confluence already ships the primitives this pattern needs: page trees, labels, native page links, content properties, and permissions. This Forge app adds the rest:

| Module | What it does |
|---|---|
| 🕸️ **Graph visualizer** | A Confluence global page (Custom UI + D3) that renders any space as an interactive force-directed knowledge graph — colored by OKF type, orphans highlighted, click a node to open the page |
| ⏰ **Scheduled health checks** | A daily Forge scheduled trigger that sweeps watched spaces for orphaned pages and unresolved links, then writes a "Knowledge Graph Health" report page — deterministic verification of non-deterministic (AI-generated) work |
| 🤖 **Rovo agent** | "Knowledge Graph Agent" answers *"what does the wiki know about X?"* in chat, backed by two Forge actions that search the graph and report its health |
| 📥 **Inbox capture** | A `file-to-inbox` Rovo action: share a link with the Knowledge Graph Agent — in Rovo Chat, or in Slack via the official Atlassian Rovo app — and it's filed as an `okf-inbox` stub page, a raw source awaiting distillation by your ingest agent |

## How pages become a graph

Pages are classified by Confluence labels:

- `okf-concept` — ideas and topics (purple nodes)
- `okf-entity` — people, places, organizations (green nodes)
- `okf-source` — ingested articles, papers, notes (yellow nodes)
- `okf-inbox` — raw sources captured via the agent, awaiting distillation (blue nodes; never flagged as orphans)
- anything else renders as a plain page (gray nodes)

Edges come from the page links Confluence already stores in each page body — no extra bookkeeping. Ingest content with any AI tooling you like (for example, Claude Code via the [Atlassian Remote MCP server](https://www.atlassian.com/platform/remote-mcp-server)) and the graph stays current.

## Requirements

- [Forge CLI](https://developer.atlassian.com/platform/forge/set-up-forge/) 13+ (`npm install -g @forge/cli`), logged in via `forge login`
- Node.js 22+
- An Atlassian cloud developer site — get one free at [go.atlassian.com/cloud-dev](https://go.atlassian.com/cloud-dev)

## Quick start

```bash
# backend deps (repo root)
npm install

# frontend deps + build
cd static/graph
npm install
npm run build
cd ../..

# ship it
forge deploy
forge install   # choose Confluence and your site
```

Then in Confluence: **Apps → Knowledge Graph**, pick a space, and watch it render. Click **Watch this space** to enable the daily health checks, or **Run health check now** to generate a report immediately. Find the Rovo agent in Rovo Chat as **Knowledge Graph Agent**.

## Capturing links from Slack

Two ways to turn your team's reading channel into a knowledge-graph inbox. Both end at the same place: a `📥` stub page labeled `okf-inbox` — a blue node in the graph, listed in the health report under "Awaiting ingestion." Duplicate URLs are skipped automatically, and neither path does AI extraction — distillation belongs to your ingest agent (see the wiki-constitution instructions embedded in every stub page).

### Option A — the built-in Slack bridge (custom Slack app → webtrigger)

The app ships a webtrigger that speaks Slack's Events API directly: every channel message containing a link is filed to the inbox, with the rest of the message preserved as the "why this matters" comment. No Rovo required. The bridge enriches each stub with *metadata only* — the sharer's display name and channel name (Slack API) and the link's title (YouTube oEmbed, or the page's `<title>`) — while content distillation stays with the ingest agent.

1. Deploy and get your webtrigger URL:

   ```sh
   forge deploy
   forge install --upgrade    # adding a module bumps the major version — installs stay pinned until you upgrade
   forge webtrigger           # choose slack-events, copy the URL
   ```

2. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps) → **Create New App → From a manifest**, pasting (fill in your webtrigger URL):

   ```yaml
   display_information:
     name: Knowledge Graph Bridge
     description: Files shared links into the Confluence knowledge-graph inbox
   features:
     bot_user:
       display_name: kg-bridge
       always_online: true
   oauth_config:
     scopes:
       bot:
         - channels:history   # required to pair with the message.channels event
         - users:read         # resolve "shared by" display names
         - channels:read      # resolve channel names
   settings:
     event_subscriptions:
       request_url: <your webtrigger URL>
       bot_events:
         - message.channels
   ```

3. **Install to Workspace**, then collect two credentials from the app pages — the **Signing Secret** (Basic Information) and the **Bot User OAuth Token** (`xoxb-…`, OAuth & Permissions) — and store both in Forge, then redeploy so the running function picks them up:

   ```sh
   forge variables set --encrypt SLACK_SIGNING_SECRET <value>
   forge variables set --encrypt SLACK_BOT_TOKEN <value>
   forge deploy
   ```

4. `/invite @kg-bridge` in your reading channel. Post a link with a sentence about why it matters — the stub page appears in Confluence within seconds, titled after the shared page or video.

Optionally, set a `YOUTUBE_API_KEY` (official YouTube Data API v3, free) the same way — video stubs then capture the channel, duration, tags, and full description instead of just the title, giving automated distillation something real to work with. Transcripts are deliberately not fetched (the official API is owner-only; scraping is fragile and ToS-gray) — full video distillation belongs to the ingest agent.

Slack retries deliveries that don't get a fast 200; the KVS dedup makes those retries harmless. Requests are verified against the signing secret (HMAC, 5-minute replay window). If `SLACK_BOT_TOKEN` is unset or a lookup fails, stubs degrade gracefully to raw Slack IDs and domain-based titles — capture never depends on enrichment.

### Option B — the official Rovo app for Slack (no code)

If your org has the [Atlassian Rovo app for Slack](https://slack.com/marketplace/A08B0EYMUPR-atlassian-rovo) connected (org admin, one-time), add the **Knowledge Graph Agent** to your channel and configure its trigger — an emoji like 📚, an @mention, or every message. When triggered, the agent calls the same `file-to-inbox` action and confirms in the thread. This route also resolves sharer names and lets the agent respond conversationally, which the raw bridge doesn't.

The action works anywhere the agent runs: in Rovo Chat in Confluence, just say *"file this to the knowledge graph: <url> — great breakdown of event sourcing."*

> **Design note:** an earlier iteration used a Forge webtrigger fed by Slack **Workflow Builder** — abandoned because Workflow Builder has no native outgoing-webhook step. The current bridge instead pairs the webtrigger with a proper Slack app using the Events API, which posts natively to any URL. Heads-up: the webtrigger module and the `external.fetch` egress permission each end **Runs on Atlassian** eligibility (verify with `forge eligibility`); if RoA matters to you, delete the `webtrigger` module, `src/slack-bridge.js`, and the `permissions.external` block, and use Option B.

## Automated ingestion (optional, bring your own model)

With a `GEMINI_API_KEY` set (`forge variables set --encrypt GEMINI_API_KEY <key>`, free at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)), the app distills inbox stubs automatically: an hourly scheduled trigger (or the `ingest-now` webtrigger, for demos) sweeps `okf-inbox` pages and, for each one, produces an `okf-source` summary page plus created-or-reused `okf-concept` / `okf-entity` pages, cross-linked per the wiki constitution — then retires the stub.

The division of labor embodies the app's core principle — **non-deterministic work executed by AI, verified and written by deterministic code**: Gemini only produces structured JSON (summary, key points, concepts, entities); Forge code does all page creation, deduplication against existing graph pages, linking, and labeling. Gemini is the default because it's the only major model API that ingests a **YouTube URL natively** (it watches the video — no transcript scraping); articles use the text captured at share time, and anything else falls back to Gemini's `url_context` tool. Stubs that fail three times are labeled `okf-ingest-failed` and skipped. No key set → the sweep is a no-op and stubs wait for a human-driven ingest agent (Rovo, or any MCP-connected assistant).

One invocation ingests one stub (video distillation needs most of Forge's 55-second function budget); a backlog drains across hourly runs, or hit the `ingest-now` webtrigger repeatedly (`forge webtrigger` for the URL).

## Project structure

```
manifest.yml              # modules: global page, scheduled trigger, Rovo agent + actions
src/
  index.js                # function handler exports
  resolvers.js            # Custom UI resolver (spaces, graph data, watch/health)
  maintenance.js          # scheduled trigger + health report writer
  rovo.js                 # Rovo agent action handlers
  inbox.js                # file-to-inbox action: link → okf-inbox stub page
  slack-bridge.js         # webtrigger: Slack Events API → fileToInbox
  ingest.js               # scheduled/on-demand: okf-inbox stubs → Gemini → source/concept/entity pages
  lib/
    confluence.js         # Confluence REST helpers (v1 CQL search + v2 pages/spaces)
    graph.js              # graph builder: pages → nodes, page links → edges
static/graph/             # Custom UI frontend (React + D3 force graph)
```

## Development

- `forge deploy` after backend/manifest changes; rebuild `static/graph` first when the frontend changes
- `forge tunnel` for live backend iteration
- `forge lint` validates the manifest and required scopes
- `forge logs` shows scheduled-trigger runs
- ⚠️ Adding or removing modules/scopes bumps the app's **major version**, and installed sites stay pinned to the old major version until you run `forge install --upgrade`. If your deployed changes mysteriously don't show up, check `forge install list` — an "Update available" (or an older major version) means you need the upgrade.

## Support

See [Get help](https://developer.atlassian.com/platform/forge/get-help/) for how to get help and provide feedback.
