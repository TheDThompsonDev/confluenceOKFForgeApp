# Knowledge Graph for Confluence

Build an AI-native knowledge graph in Confluence with [Forge](https://developer.atlassian.com/platform/forge/).

Teams are drowning in information — articles, research papers, meeting notes, requirements docs. The LLM wiki pattern (popularized by Andrej Karpathy and standardized by the Open Knowledge Format) breaks sources down into cross-linked **concept**, **entity**, and **source** pages that both people and AI agents can navigate. Confluence already ships the primitives this pattern needs: page trees, labels, native page links, content properties, and permissions. This Forge app adds the rest:

| Module | What it does |
|---|---|
| 🕸️ **Graph visualizer** | A Confluence global page (Custom UI + D3) that renders any space as an interactive force-directed knowledge graph — colored by OKF type, orphans highlighted, click a node to open the page |
| ⏰ **Scheduled health checks** | A daily Forge scheduled trigger that sweeps watched spaces for orphaned pages and unresolved links, then writes a "Knowledge Graph Health" report page — deterministic verification of non-deterministic (AI-generated) work |
| 🤖 **Rovo agent** | "Knowledge Graph Agent" answers *"what does the wiki know about X?"* in chat, backed by two Forge actions that search the graph and report its health |

## How pages become a graph

Pages are classified by Confluence labels:

- `okf-concept` — ideas and topics (purple nodes)
- `okf-entity` — people, places, organizations (green nodes)
- `okf-source` — ingested articles, papers, notes (yellow nodes)
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
