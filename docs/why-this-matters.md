# Why This Demo Matters

*A plain-English guide to the Knowledge Graph for Confluence app — no prior knowledge required.*

---

## The problem everyone has

You are drowning in information. Articles, research papers, meeting notes, requirements docs, Slack threads, YouTube videos someone swears you need to watch. It never stops, and your job quietly depends on remembering all of it.

The classic answer is "write it down in the wiki." And every team tries. But wikis maintained by humans share the same fate: humans are busy, so the wiki drifts. The notes from March never get connected to the decision in June. The research paper someone summarized links to nothing. Six months later, nobody can tell what's been captured and what's been lost.

Meanwhile, something changed: **the primary reader of your documentation is no longer just a human.** It's also an AI agent — the one answering your teammates' questions, the one writing your code, the one preparing your briefing. And agents don't read the way people do. They can't hold your entire wiki in their head at once. They need knowledge broken into small, well-labeled, *connected* pieces they can navigate step by step — read a summary, follow a link, follow another link — the way you'd browse Wikipedia.

So the real question is: **what does a wiki look like when it's built for both people and agents, and maintained by an agent so it never goes stale?**

## The idea (in three steps)

The pattern this demo implements has a short history:

1. **AI researcher Andrej Karpathy** published a technique for having an LLM maintain a personal wiki: don't file documents whole. Instead, when you ingest a source — a paper, an article, your meeting notes — have the AI break it down into three kinds of entries:
   - **Concepts** — the ideas it discusses ("cognitive debt," "graph RAG")
   - **Entities** — the people, places, and organizations involved ("MIT Media Lab")
   - **Sources** — a summary of the original document itself, linking back to the full thing

   Then cross-link everything. A source links to the concepts it introduces; concepts link to related concepts; entities link to the sources that mention them. Ingest ten articles and the entries start *sharing* concepts — the AI finds connections between things you read months apart. Your notes stop being a filing cabinet and become a web of knowledge an agent can walk.

2. **Google standardized it** as the **Open Knowledge Format (OKF)** — a deliberately lightweight spec that says: give each entry a title, a timestamp, a type (concept / entity / source), and tags. That's essentially it. The value isn't complexity; it's that everyone structuring knowledge the same way means every tool and agent can read it.

3. **This demo brings it to Confluence** — and here's the part worth appreciating: **Confluence already has every primitive this pattern needs.** Pages. Labels to mark type. Native links between pages, which Confluence tracks. Permissions, so "who can see this knowledge" is already solved. The pattern was invented for personal note-taking tools; Confluence is where it becomes something a whole team can use.

## What the app actually does

The Forge app adds three things on top of what Confluence ships with:

**1. It makes your knowledge visible.**
A force-directed graph view of any space: every page is a dot, every link between pages is a line. Concepts are purple, entities green, sources yellow. Click a node, open the page. The moment you see it, you understand your knowledge base in a way no page tree can show you — you can *see* the clusters of related ideas, and you can see the problems: dots floating alone, disconnected from everything.

**2. It keeps your knowledge honest.**
This is the quietly important one. When an AI does the ingesting, sometimes it forgets a step — it writes a page but doesn't link it, or links to a page it never created. Those aren't opinions; they're checkable facts. So the app runs a scheduled sweep of every watched space and writes a health report page: which pages are **orphaned** (nothing links to or from them) and which links are **unresolved** (pointing at pages that don't exist). It's a simple discipline with a big principle behind it: **non-deterministic work (AI writing) verified by deterministic checks (code).** You don't have to trust that the AI did it right — you can prove it, every night, automatically.

**3. It makes your knowledge conversational.**
A Rovo agent — "Knowledge Graph Agent" — that answers questions like *"what does the knowledge graph know about cognitive debt?"* right in chat. It searches the curated pages, summarizes what your team actually captured, and links to the source pages. Ask it about graph health and it reads the latest sweep results. Your team's curated knowledge becomes something you can *ask*, not just search.

## The workflow, end to end

Here's the loop in real life:

1. You read something worth keeping — or you don't read it, and that's fine too.
2. You hand it to an AI assistant (for example, Claude Code connected to Confluence through Atlassian's Remote MCP server) and say *"ingest this."* Overnight if you like, in batches.
3. The agent creates the concept, entity, and source pages in Confluence — properly labeled, properly cross-linked — because the space's instructions tell it exactly how.
4. The graph grows. Connections appear between this week's article and last quarter's research, found automatically.
5. The nightly health check confirms nothing was left dangling — and flags it on a report page if it was.
6. Anyone on the team asks Rovo about any of it, anytime, and gets an answer grounded in pages the team actually curated — with links, and with Confluence permissions fully respected.

The demo compresses that loop into minutes: one click seeds a space with a realistic mini knowledge base (a real MIT study on AI and cognition, broken into its concepts, people, and findings — including one deliberately orphaned page and one deliberately broken link, so you can watch the health check catch them).

## "Isn't this what Teamwork Graph does?"

Good question — they're complementary layers, and the difference is easy to hold onto:

- **Teamwork Graph** is Atlassian's platform intelligence layer. It *automatically* maps the relationships in your work — work items to documents, people to projects — across Atlassian and connected tools. It observes what your organization **does**, and it's what powers Rovo.
- **This pattern** is deliberate curation at the content layer. A human (or their agent) decides what knowledge is worth distilling and how it connects. It captures what your organization **knows**.

And they compound: because the curated graph is made of ordinary Confluence pages and links, everything you curate becomes part of what Teamwork Graph and Rovo can work with. Deliberate curation makes the automatic layer smarter.

## Why you should care

Strip away the acronyms and this demo makes one argument:

> **The knowledge your team consumes shouldn't evaporate.** AI made it cheap to distill and connect that knowledge; Confluence makes it durable, shared, permissioned, and visible; Forge makes the whole thing verifiable and interactive — with a graph you can see, checks you can trust, and an agent you can ask.

The entire app is a few hundred lines of code, runs entirely on Atlassian infrastructure with no data leaving the platform, and every piece of it — the visualizer, the scheduled checks, the Rovo agent — is a standard Forge module you could build yourself. That's the takeaway to walk away with: this isn't a product pitch, it's a *pattern* — and the platform your team already uses was built for it.
