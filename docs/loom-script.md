# Loom script: The learning behind the work

**Audience:** Atlassian leadership · **Length:** ~3:45 · **Register:** business argument, not product demo. The prototype appears once, briefly, as evidence.

**Title:** We Connect the Work. This Keeps the Learning Behind It.
**Description:** A strategic case for a learning-capture layer alongside Teamwork Graph, with a working Forge prototype as proof of feasibility.

---

## 0:00–0:35 — The framing (face on camera; no product on screen)

> Teamwork Graph gives AI the context of how the organization works today. OKF captures the learning that decides what it builds tomorrow.
>
> Every software company is continuously teaching itself how to build better — and almost all of that learning evaporates in the scroll. There's an opportunity here for Teamwork Graph: not just connecting the work after it exists, but retaining the learning that shapes it before it happens.
>
> We connect the work. This keeps the learning behind it. Let me make the business case in three minutes.

---

## 0:35–1:20 — The business problem (still no product; a Slack reading channel on screen is enough)

> Here's the problem in economic terms.
>
> Every company pays its people to learn — hours a week of articles, talks, research, all of it salaried time. The learning that survives does so in two places: individual memory, and chat scroll-back. One walks out the door with every departure. The other is unsearchable within a week.
>
> So organizations are making learning investments with a near-total write-off rate — and every AI investment they make compounds the cost, because agents are only as good as the context the organization retained. Everyone is racing to give AI more context. Almost no one is capturing the highest-signal context there is: what their own people judged worth sharing, and why.
>
> That judgment — a person telling their team "this matters to us, here's why" — already happens every day, for free. It's just being thrown away.

---

## 1:20–2:00 — Proof it's buildable (the only product footage; ~35 seconds)

**On screen:** the 30-second cut — Slack share with a one-line comment → the Confluence knowledge graph growing → Rovo answering "What does our team know about ⟨topic⟩, and why did we think it mattered?", quoting the sharer by name.

> This isn't hypothetical — I built a working version on Forge, in our own Confluence, in days.
>
> Watch: a link shared in Slack with one sentence of why. Sixty seconds later it's structured organizational knowledge — summarized, connected to everything the team learned before, inside our existing permissions. And when anyone asks Rovo what we know about the topic, it answers with the evidence *and the human judgment* — who flagged it, and why it mattered to us.
>
> Nobody changed their behavior. Nobody maintained a wiki. That's the entire mechanism — and it's why this succeeds where knowledge management always fails: the capture gesture is one people already make.

---

## 2:00–2:50 — The business logic (back to face / simple flow diagram)

> Three properties make this a durable asset rather than another tool.
>
> **It compounds.** The tenth resource doesn't add a tenth document — it attaches to the concepts the first nine built. When two sources disagree, that's not noise; that's the team's open question, made visible. A new hire doesn't just inherit our documentation — they inherit the external sources the team rated as formative, with the reasoning. Two years of a team's learning, transferred in an afternoon.
>
> **It's governed.** The output is ordinary Confluence content — versioned, permissioned, editable, auditable. When the AI distills something wrong, the correction is an edit, and the edit is the record. Compare that to the actual current alternative: employees pasting company context into personal AI tools.
>
> **It feeds everything downstream.** Every page this creates is substrate for Teamwork Graph and Rovo. Better retained learning makes every agent, every search, every answer better. This isn't a product adjacent to the System of Work — it's an intake valve for it.

---

## 2:50–3:25 — The strategic opportunity

> Which brings me back to the framing.
>
> A system of record for work exists — we built it. A system of record for *learning* doesn't exist anywhere, at any company, at any vendor. It's whitespace. And the requirements to own it are exactly our assets: a trusted, permissioned system of record to hold it — Confluence. A graph to distribute it — Teamwork Graph. An interface to resurface it — Rovo. A platform to capture it from anywhere — Forge.
>
> For customers, it converts a pure cost — salaried learning time with zero retention — into a compounding asset, and it gives them one more reason the AI era consolidates on Atlassian rather than fragments away from it.
>
> This is my mental model of the boundary, and I'd genuinely like the Teamwork Graph team to pressure-test it.

---

## 3:25–3:45 — The ask

> What I'm asking for: **⟨one ask — a pilot on one real team's reading channel · a working session with the Teamwork Graph team · sponsorship to develop this into a platform story⟩**.
>
> Every day this doesn't exist, the scroll eats another day of learning we already paid for.
>
> We connect the work. It's time we kept the learning behind it.

*End there. The close is the opening line, converted from claim to conclusion.*

---

## Appendix — Prep notes for the 30-second proof segment

- Record the demo footage once, cleanly, in advance — this video argues the business; the footage is evidence, not a live performance. (Keep timestamps visible in the cut anyway; "sixty seconds later" should be checkable.)
- Use a **fresh URL** for the capture take — the dedup layer silently no-ops repeated URLs, so a rehearsal link will not re-ingest.
- Pre-verify the Rovo question against already-ingested content until the answer (with sharer attribution) is boringly reliable; script exactly that question.
- Clean state before filming: drain inbox stubs via the `ingest-now` webtrigger, no `okf-ingest-failed` labels visible, hit **Fit** on the graph before panning.
- Decide the single ask before recording. One ask. Three asks is zero asks.
