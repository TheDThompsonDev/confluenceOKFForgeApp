# Knowledge Graph for Confluence — Project Brief

**Status:** Working prototype, deployed and verified on a dev site
**Author:** Danny Thompson (DevRel) — drafted 2026-07-13
**Purpose of this doc:** Complete record of the project — what it is, how it was built, what we learned positioning it, and a draft video script — to evaluate whether this becomes an Atlassian Developers YouTube tutorial series or dies here. Written to be self-contained and agent-readable.

---

## 1. Executive summary

Knowledge Graph for Confluence is a Forge app that demonstrates the "LLM-maintained wiki" pattern (popularized by Andrej Karpathy, standardized as the Open Knowledge Format) running natively on Confluence. An AI agent ingests external content — research papers, articles, notes — and distills it into cross-linked Confluence pages typed as **concepts**, **entities**, and **sources**. The Forge app adds three capabilities on top: a D3 force-graph visualizer of any space, a daily scheduled trigger that deterministically verifies the AI-curated content (orphaned pages, unresolved links), and a Rovo agent that answers questions from the curated knowledge.

The proposed deliverable is a 2–3 video tutorial series for the Atlassian Developers YouTube channel, with this repo as the companion "clone and forge deploy" asset.

**The pitch in one hardened sentence:** *Teamwork Graph and Rovo are phenomenal at connecting and surfacing what your org has. This is a Forge pattern for growing what your org has — turning the reading your teams already do into durable, verifiable Confluence knowledge that the whole platform gets smarter on.*

**The ask:** validate the positioning with the Teamwork Graph and Rovo PM teams (Section 6 lists the specific questions), then green-light or kill.

---

## 2. Origin and the underlying idea

The idea came from a developer meetup talk (Tim Raburn, Improving) demonstrating Karpathy's technique in Obsidian:

1. **Don't file documents whole.** When ingesting a source, have an LLM break it into typed wiki entries: *concepts* (ideas discussed), *entities* (people, places, organizations), and *sources* (a summary of the original, linking back to it). Cross-link everything.
2. **Google standardized the structure** as the **Open Knowledge Format (OKF)**: each entry carries a title, timestamp, entry type, and tags. Deliberately minimal.
3. **The payoff is agent navigation.** Agents can't hold a whole wiki in context. Small, typed, densely linked pages let an agent discover knowledge progressively — read a summary, follow a link — like a person browsing Wikipedia. The talk's best moment: wiping the LLM's context entirely, then asking about an ingested paper; the amnesiac agent answered with specifics *by walking the wiki*. The intelligence lives in the structure, not the model.

**The Confluence translation is the thesis of the series:** Confluence already ships every primitive this pattern needs — pages, labels for typing, native tracked links, permissions, content properties — and upgrades the pattern from single-player (Obsidian) to a permissioned, multiplayer, org-level capability. The pattern was invented for personal notes; Confluence is where a team can actually run it.

| Obsidian original | Confluence equivalent |
|---|---|
| Vault | A space |
| Folders (/concepts, /entities, /sources) | Labels: `okf-concept`, `okf-entity`, `okf-source` |
| YAML frontmatter | Labels + Content Properties API |
| Wikilinks | Native page links (tracked by the platform) |
| agents.md | A pinned "wiki constitution" page the ingest agent reads |
| CLI link verification | Forge scheduled trigger + REST sweep |
| Graph view | Forge Custom UI page (D3) |
| Ingest tooling | Any AI assistant via Atlassian Remote MCP (e.g., Claude Code) |

---

## 3. What we built

One Forge app (`knowledge-graph-for-confluence`), three modules, all standard platform features:

1. **`confluence:globalPage` (Custom UI, React + D3)** — force-directed graph of any space. Nodes = pages (colored by OKF type, orphans ringed red), edges = the page links Confluence already stores in page bodies. Space picker, stats bar, click-to-open. Includes a "Seed demo data" button (resolver-backed) that populates a space with a realistic mini knowledge base for demos.
2. **`scheduledTrigger` (daily)** — sweeps every "watched" space (stored in Forge KVS), detects orphaned pages and unresolved links, writes a human-readable "Knowledge Graph Health" report page, and stores the summary in KVS. Principle on display: **non-deterministic work (AI curation) verified by deterministic code.** A "Run health check now" button exists for demos.
3. **`rovo:agent` + two `action` modules** — "Knowledge Graph Agent." `find-knowledge-entries` searches the curated pages via CQL (scoped to watched spaces); `get-graph-health` reads the stored health summaries. The agent prompt instructs it to always link to underlying pages and never invent entries.

4. **`file-to-inbox` Rovo action — Slack/anywhere capture (added after the initial build)** — the Knowledge Graph Agent gained a third action: share a link with a comment and it files a lightweight `okf-inbox` stub page (URL, sharer's "why this matters" comment, channel) — **no AI extraction, no external fetch, no LLM keys, zero egress**. The distillation belongs to the ingest agent, which drains the inbox on its own schedule. The Slack bridge is the **official Atlassian Rovo app for Slack**: deploy the agent into a reading channel with an emoji/mention trigger and sharing + reacting — behaviors the team already has — grow the graph, with the agent confirming in-thread. The same action works in Rovo Chat in Confluence. Inbox stubs render as blue nodes, are exempt from orphan detection (unlinked is their normal state), and the health report gains an "Awaiting ingestion" backlog section. Duplicates are KVS-deduped by URL hash.

   **Architecture history worth recording:** the first implementation was a Forge webtrigger fed by Slack Workflow Builder (per a Rovo-assisted design session). Two things killed it: (a) Workflow Builder has **no native outgoing-webhook step** — that step was an AI hallucination in the design conversation, only third-party apps provide it; (b) the webtrigger module ended Runs on Atlassian eligibility (verified live via `forge eligibility`). A Jira-issue bridge (Slack's official Jira connector step → Jira Automation web request) was considered and rejected as process junk — throwaway tickets as a message bus. Routing capture through the Rovo agent solved everything at once: all-official components, conversational confirmation, zero egress, RoA restored. The episode is itself a positioning asset: *verify non-deterministic advice with deterministic checks* applies to AI-assisted architecture design, not just wiki curation.

**Key technical facts**

- Edges are parsed from `<ri:page ri:content-title=...>` references in storage-format bodies — zero extra bookkeeping; any tool that creates normally-linked pages feeds the graph.
- One CQL search returns bodies + labels together (O(pages/100) requests, capped at 500 pages/space).
- Graph reads run `asUser` (permissions respected); the scheduled sweep runs `asApp`; demo seeding runs `asUser` (pages attributed to the clicking user).
- The generated health report page is excluded from the graph build (it links to the orphans it finds, which would otherwise un-orphan them on the next sweep).
- The seed data includes one deliberate orphan page and one deliberate unresolved link so the health check has real findings on camera.
- **Runs on Atlassian eligible** — no egress. This was deliberately preserved (see learnings).

**Current status:** deployed to the development environment, installed on a dev site, and verified end-to-end in the browser: space listing, graph rendering, health check (report page written), Rovo agent registered. Demo space `KGD` ("Knowledge Graph Demo") exists with seed data available at one click.

---

## 4. Engineering learnings (worth teaching in the videos)

These are real gotchas we hit; several are strong tutorial beats because every viewer will hit them too.

1. **Major-version pinning bit us hard.** Adding (then removing) a module bumped the app's major version. Installed sites stay pinned to the old major version until `forge install --upgrade` — so subsequent deploys silently never reached the site, and we debugged a "broken UI" that was actually a stale install. Diagnosis path that worked: read the Forge invocation response in the browser's network tab; the context token's `appVersion` claim exposed the pinned version. **Teach this** — symptoms are invisible and the fix is one command.
2. **Webtriggers disqualify Runs on Atlassian.** The first demo-data seeder was a webtrigger; `forge eligibility` flagged it as an egress surface and RoA eligibility vanished. Redesigned as a resolver + UI button: same convenience, RoA restored. Lesson: module choice is a compliance decision, and `forge eligibility` tells you why.
3. **Don't filter spaces by `type=global`.** Modern Confluence classifies team spaces as `collaboration`/`knowledge_base`; the filter silently returned zero spaces.
4. **`@forge/kvs` exports `{ kvs }` (named), not default.**
5. **The template's `@forge/bridge` pre-release had broken peer deps;** pin to the stable release.
6. **Generated/tooling pages must be excluded from the knowledge graph** or they contaminate the metrics they report on (the health page un-orphans orphans by linking to them).
7. **"Empty space" is the wrong condition for onboarding UI** — Confluence auto-creates template pages; gate on "no OKF-typed pages" instead.
8. **Forge lint is genuinely good** — it caught missing v2 scopes and an over-long function key before deploy.

---

## 5. Positioning: what we learned (the most valuable part of this doc)

The positioning went through three drafts, each killed by a real objection. Recording all three because the failure modes matter as much as the final framing.

### Draft 1: "Porting an Obsidian trick to Confluence" — killed
Frames Confluence as lacking something and the pattern as a workaround. Rule adopted: **the word is *extend*, never *fix*.** Correct frame: Karpathy described a structure; Confluence already ships its primitives. Validation, not migration.

### Draft 2: "Give your org a memory any AI can use" — killed
Compelling, but it collides head-on with **Teamwork Graph's** actual marketing ("your org's entire context, available to AI"). An internal audience — and sharp YouTube commenters — would say "isn't this just Teamwork Graph?" We stress-tested exactly that question.

### The Teamwork Graph stress test (do not skip this section)

**Claims that do NOT survive internal scrutiny:**
- "Teamwork Graph relates artifacts but can't create idea-level nodes" — **false as an absolute.** Rovo does transformer-based entity linking and ships knowledge cards (auto-generated snapshots that improve as the graph grows). Any absolute "TWG can't/doesn't" claim will get corrected from the audience by the team that built it.

**Distinctions that DO survive:**
1. **The external-knowledge airlock.** TWG connectors ingest from tools the org uses. The research paper a teammate read, the conference talk, the industry analysis — that content never enters any connected tool, so no graph intelligence can reach it. This pattern converts *reading* into *artifacts*. (The demo deliberately ingests an external MIT study for this reason.)
2. **Durable, editable, owned artifacts vs. derived views.** Knowledge cards and entity links are computed and ephemeral. A concept page is a document: readable, correctable, versioned, permissioned — the team's *stated* position, including explicit synthesis when sources disagree. Editorial control is the feature. The platform infers what your org knows; this lets your org *decide* what it knows.
3. **Deterministic verification of AI-curated content.** No platform equivalent; aligns with how Atlassian talks about responsible AI.
4. **Symbiosis, not competition.** Every curated page becomes TWG substrate — entity linking and knowledge cards get better on it. TWG solves *distribution* of context; this pattern solves *creation* of context. Perfect distribution of an empty library is still an empty library.
5. **The Slack angle repeats the same distinction.** The Teamwork Graph Slack connector indexes the *conversation* so Rovo can find it. The Slack inbox feature captures the *external article behind the link* — content that lives outside every connected tool — and the emoji reaction is a human curation vote the automatic layer can't infer.

**Language rules adopted:** no absolutes about TWG ("out of the box, today", "at the content layer"); humble-architect posture internally ("here's my mental model — TWG folks, tell me where the boundary is wrong").

### What the "wow" actually is (demo psychology)

The three features are not the wow — devs have seen graphs, cron jobs, and chatbots. The wow is an inversion, staged as a bet:

- **The amnesia inversion.** Every AI chat is amnesia; the industry answer is bigger context windows. This pattern's answer: make the *knowledge* navigable and let any model walk in cold. Demo beat: "This agent has never seen this 216-page paper. No fine-tuning, no vector DB. Watch it answer a methodology question with a citation" — then reveal *why* it works.
- **Reading becomes writing.** Wikis died because maintenance was unpaid labor. With an agent distilling overnight, the org's brain grows while you sleep. Nobody's wiki has gotten smarter overnight before.
- **You already own the database.** Teams spend quarters building graph RAG (Neo4j + embeddings + sync). The "graph database" here is pages, labels, and links — with permissions and an audit trail included. Architecture insight, not product pitch.
- **The RAG rebuttal (top skeptical comment, answer it in-video):** RAG retrieves invisible chunks from an embedding index. This is *legible knowledge* — humans can read, audit, and edit every node; the index *is* the documentation; nothing is locked to a vector store; and the nightly sweep makes the curation *provable*.

---

## 6. Open questions for internal validation (the go/no-go list)

1. **Teamwork Graph roadmap:** is anything adjacent shipping — auto-generated topic/knowledge pages, curated-knowledge features? If yes, this series either co-markets with it or front-runs it; we must know which. *(Owner: ping TWG PM.)*
2. **Rovo roadmap:** any knowledge-curation features that make the ingest pattern first-party? Same co-market/front-run question. *(Owner: ping Rovo PM.)*
3. **Boundary review:** have the TWG team review Section 5's "distinctions that survive" list and correct it. Their edits *are* the final positioning.
4. **Naming:** does "Knowledge Graph for Confluence" create confusion with Teamwork Graph in market? Alternatives if needed: "OKF for Confluence," "Curated Knowledge Graph."
5. **Teamwork Graph API (EAP) sequel:** a follow-up video querying graph relationships via the new API (instead of parsing page links) would showcase a Team '26 headline feature — is the EAP team interested in a DevRel collaboration?
6. **Marketplace angle:** should the repo stay a tutorial asset, or is there appetite for a polished Marketplace listing?

**Pursue if:** PM teams confirm no collision (or want to co-market), and the boundary review holds.
**Kill or pivot if:** a first-party curated-knowledge feature is imminent — in which case the asset pivots to "how the pattern works under the hood" content supporting that launch, and the engineering-gotchas material (Section 4) survives as standalone Forge content regardless.

---

## 7. Draft video script (video 1 of the series)

**Working title:** *Build an AI-Native Knowledge Graph in Confluence with Forge*
**Arc:** bet → payoff → reveal. The amnesia test leads; the graph is the reveal, not the opener.

**Cold open (0:00–0:45)**
> "Your team already reads enough to be brilliant — it just forgets. Teamwork Graph made your org's context available to AI. But your org can only offer AI the context it actually *has* — and most of what your team learns never gets written down. Today we fix that with about three hundred lines of Forge code. And I'll prove it works with a bet: by the end of this video, an AI agent that has never seen a 216-page MIT research paper will answer a detailed question about its methodology — with a citation. No fine-tuning. No vector database. Just Confluence, used the way it was secretly built to be used."

**Act 1 — The pattern (0:45–3:30).** Karpathy's gist on screen (credibility: standing on shoulders of giants). OKF in one breath: concepts, entities, sources, cross-linked, typed metadata. Then the thesis slide — the Obsidian→Confluence table from Section 2: "Notice something? Confluence already ships every single primitive. Labels. Tracked links. Permissions. We're not porting anything. We're switching the wiki on."

**Act 2 — The build montage (3:30–8:00).** Forge app tour, honest and fast: manifest with three modules; the graph resolver ("edges are the links Confluence already tracks — we store nothing"); the scheduled trigger ("AI writes the wiki; deterministic code checks the wiki — never trust what you can't verify"); the Rovo agent prompt ("note the last line: *never invent entries*"). Callout beat: `forge eligibility` and why the seeder is a button, not a webtrigger — "no egress, Runs on Atlassian."

**Act 3 — The payoff (8:00–12:00).** Seed the demo space live; the graph blooms — purple concepts, green entities, yellow sources. "And see these two? Red rings. We'll come back to them." Then the bet: open Rovo Chat, ask the methodology question, get the answer with the page link. Reveal *why*: click through concept → source → entity, showing the agent's walkable path. Then the health check: run it live, it catches the orphan and the broken link we planted — "the AI curated it; the code proved it."

**Act 4 — Make it yours (12:00–13:30).** Clone, `forge deploy`, `forge install` (mention the major-version upgrade gotcha — 15 seconds that will save viewers hours). Point ingest at your own space with any MCP-connected assistant. Tease video 2 (ingest pipeline + wiki constitution deep-dive) and video 3 (Teamwork Graph API, EAP permitting).

**Series plan:** V1 the app + the bet (above). V2 the ingest agent: writing the wiki-constitution page, batch ingest via Remote MCP, "ingest everything while I sleep" — closing with the Slack capture demo via the official Rovo app for Slack (share a link, agent triggered by 📚, replies "Filed 📥" in-thread, blue node appears in the graph, ingest agent drains the inbox overnight). The same beat showcases that one Rovo agent both grows and answers from the graph. V3 the platform play: content properties for OKF metadata, Teamwork Graph API queries, co-marketing window with the EAP team if available.

---

## 8. Assets

- **Repo:** `confluenceOKF` — manifest, `src/` (resolvers, maintenance, rovo, seed, lib), `static/graph` (React + D3), `docs/why-this-matters.md` (the zero-context explainer companion to this brief)
- **App:** `knowledge-graph-for-confluence`, Forge app ID `ari:cloud:ecosystem::app/67521675-0b94-4dd6-93c6-09d05d27144c`, Developer Space "ForgeRovo"
- **Dev install:** dannythompson901.atlassian.net (development env); demo space key `KGD`; global page at Apps → Knowledge Graph
- **Demo data:** one click seeds ~14 pages distilled from two real sources (the MIT "cognitive debt" study and a frontier-model-adoption blog post), including one planted orphan and one planted broken link for the health-check beat

---

*Positioning claims about Teamwork Graph in this doc are the author's working model and have not yet been reviewed by the TWG/Rovo teams — Section 6, items 1–3 are the review request.*
