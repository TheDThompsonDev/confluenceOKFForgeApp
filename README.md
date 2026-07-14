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

## Capturing links from Slack (optional, no code)

Turn your team's reading channel into a knowledge-graph inbox using the [official Atlassian Rovo app for Slack](https://slack.com/marketplace/A08B0EYMUPR-atlassian-rovo) — no webhooks, no Workflow Builder, no third-party apps.

1. A Slack admin installs the Atlassian Rovo app and connects it to your site (one-time).
2. Add the **Knowledge Graph Agent** to your reading channel and configure its trigger — an emoji like 📚, an @mention, or every message, per the Rovo Slack app's channel-agent settings.
3. Share a link with a comment about why it matters. When the agent is triggered, it calls the `file-to-inbox` action: a `📥` stub page appears in Confluence, labeled `okf-inbox` — a blue node in the graph, listed in the health report under "Awaiting ingestion" — and the agent confirms in the thread.

The same action works anywhere the agent runs: in Rovo Chat in Confluence, just say *"file this to the knowledge graph: <url> — great breakdown of event sourcing."*

Duplicate URLs are skipped automatically. The action does **no** AI extraction and fetches **nothing** external — it files the URL + context, and the distillation belongs to your ingest agent (see the wiki-constitution instructions embedded in every stub page). The app remains fully egress-free and Runs on Atlassian eligible.

> **Design note:** an earlier iteration used a Forge webtrigger fed by Slack Workflow Builder. Two reasons it was replaced: Workflow Builder has no native outgoing-webhook step (only third-party workarounds), and webtrigger modules end Runs on Atlassian eligibility (verify with `forge eligibility`). Routing capture through the Rovo agent solved both — the official Rovo Slack app is the bridge, and the app keeps zero egress.

## Project structure

```
manifest.yml              # modules: global page, scheduled trigger, Rovo agent + actions
src/
  index.js                # function handler exports
  resolvers.js            # Custom UI resolver (spaces, graph data, watch/health)
  maintenance.js          # scheduled trigger + health report writer
  rovo.js                 # Rovo agent action handlers
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
