# Lessons learned: building the Slack → Confluence knowledge pipeline

Context doc from the 2026-07-17 build session that took the app from v4.1.0 to v7.0.0 —
what was built, what broke, what we learned, and what's still open. Written for future
sessions and for scripting the tutorial videos.

## What was built (the pipeline as it stands)

**Post a link in a Slack channel → within ~60 seconds it's a distilled, cross-linked
knowledge-graph structure in Confluence.** Three stages:

1. **Capture** (`src/slack-bridge.js`, webtrigger `slack-events`) — a custom Slack app
   (Events API, `message.channels`) POSTs channel messages to a Forge webtrigger. Any
   message with a link becomes an `okf-inbox` stub page, enriched with the sharer's
   display name, channel name, the link's title, and the page's readable text (or
   YouTube metadata). HMAC signature verification, KVS dedup by URL hash.
2. **Distill** (`src/ingest.js`) — Gemini 2.5 Flash turns the stub into structured JSON
   (summary, key points, concepts, entities). YouTube links are passed as URLs and the
   model *watches the video*. Runs immediately at capture time; an hourly scheduled
   sweep retries failures; `ingest-now` webtrigger for demos (supports `?pageId=&spaceKey=`).
3. **Weave** (deterministic code, no AI) — creates the `okf-source` page, creates or
   *reuses* `okf-concept`/`okf-entity` pages by case-insensitive title match, cross-links
   everything, swaps the stub's label to `okf-ingested`.

Division of labor is the app's thesis: **non-deterministic work (distillation) executed
by AI; verification, page-writing, and linking done by deterministic code.**

## The Rovo dead ends (and why the architecture is what it is)

- **The official Rovo app for Slack failed to connect** on a *Premium* site, at the
  Add-site step: `Failed to validate system account: Failed to retrieve data from
  CONVO-AI API with reason: Bad Request`. Not documented anywhere public. Bot account
  was a real user, org admin, only account on the site.
- **Rovo actions in Confluence Automation are gated the same way**: both "Use agent" and
  "Use Rovo" show *"To use a Rovo agent, your org admin needs to activate AI"* — while
  the admin console (org `eventconvo`) has **no AI activation control anywhere** (Rovo
  access shows only an empty blocklist; beta features on; docs say Premium gets Rovo
  automatically). Conclusion: the site's Rovo entitlement is mis-provisioned. Both
  failures almost certainly share this root cause.
- Rovo Chat + Forge-defined agents worked the whole time (dev-mode path), which masked
  the provisioning problem.
- **Automation-triggered Rovo agents can't use their tools** anyway — they only return
  `{{agentResponse}}` text — and neither Rovo nor Automation can fetch external URLs.
  Even unblocked, the automation rule could only have done a one-page distill.
- **Open item:** escalate internally — site `dannythompson901.atlassian.net`, org
  `eventconvo`, both error strings above. One provisioning fix likely unblocks both the
  Slack Rovo app (README Option B) and the automation actions.
- Org structure gotcha: two orgs on this account — `dannysworkspace-32943016` (free
  Teams/Studio only) and `eventconvo` (owns dannythompson901 *and* dtthompson1, the
  latter on Teamwork Collection Premium with healthy Rovo).

## Slack integration lessons

- **Slack Workflow Builder has no native outgoing-webhook step** (the original v4 dead
  end). A custom Slack app with the Events API does this natively — that was the unlock.
- The Slack app manifest editor has JSON and YAML tabs; pasting YAML into JSON mode
  gives a cryptic parser error, not a "wrong format" hint.
- **Event subscriptions must be paired with matching OAuth scopes** (`message.channels`
  event ⇢ `channels:history` scope) or the manifest fails validation.
- **Slack HTML-escapes message text** (`&` → `&amp;`). Decode before extracting URLs, or
  query strings arrive corrupted. Our early stubs stored *double*-escaped URLs
  (`&amp;amp;`) because `escapeXhtml` re-escaped Slack's escaping — the ingest parser
  now decodes until stable.
- **Event payloads carry IDs, not names** (`U0BH…`, `C0BJ…`). Resolving display/channel
  names needs a bot token (`users.info`, `conversations.info` + `users:read`,
  `channels:read`). Scope changes require reinstalling the Slack app.
- `reaction_added` events don't include message text (the original emoji-trigger design
  would have required calling back into Slack). `message` and `app_mention` events carry
  the text — zero-callback capture.
- Slack retries deliveries that don't get a fast 200, and disables the subscription
  after repeated failures — so the handler answers 200 even on internal errors, and
  idempotency comes from KVS dedup.
- `url_verification` must work *before* the signing secret exists (chicken-and-egg at
  app-creation time) — the handler answers the challenge unauthenticated, everything
  else requires the signature.

## Forge platform lessons

- **Webtrigger modules and `external.fetch` egress each end Runs on Atlassian
  eligibility.** Dropped deliberately in this app (decision made 2026-07-17); the README
  documents how to restore RoA by deleting them.
- **Module/scope changes bump the major version and installs stay pinned** until
  `forge install --upgrade`. Symptom: deploys silently don't reach the site. (Bitten
  twice across sessions now — it's the #1 Forge gotcha.)
- **Environment variables need a redeploy** to reach the running functions
  (`forge variables set` alone does nothing live).
- **Function limit is 55 seconds** (observed directly in logs). Video distillation can
  consume most of it → one stub per invocation, attempts guard, hourly retry.
- **`GET /wiki/rest/api/content` (v1 listing) is REMOVED — returns 410 Gone** for app
  auth. It briefly *worked from a browser session*, which made it look viable. The
  supported index-free path is v2: `GET /wiki/api/v2/spaces/{id}/pages` (+ per-page
  label fetches, which need the `read:label:confluence` scope and batching).
- **CQL search (`/rest/api/content/search`) is index-backed and lags minutes behind
  page creation.** It silently hid just-created pages from the graph, the ingest sweep,
  and title dedup. Rule adopted: *CQL only where search semantics are wanted* (the Rovo
  agent's find action); everything else uses v2 listings.
- **Custom UI iframes size themselves to content, so `vh` units are circular** — a
  `100vh` layout changes nothing. Canvas height is derived from `window.screen.height`
  instead.
- Forge webtrigger URLs are per-installation and unguessable; get them with
  `forge webtrigger create -f <key> -s <site> -p Confluence -e development`.
- Webtrigger request headers are arrays; normalize before reading. Return
  `{ statusCode, headers, body }`.

## Gemini API lessons

- **Gemini is the only major model API that ingests a YouTube URL natively** (passed as
  `fileData.fileUri`; it processes audio + frames). Claude/OpenAI have no equivalent —
  every third-party "summarize YouTube" tool scrapes transcripts (fragile, ToS-gray,
  and the official captions API is owner-only). This single capability decided the
  provider. Free tier: 8 hours of YouTube/day, public videos only, feature in preview.
- **Tool use + structured output are mutually exclusive** — `url_context` with
  `responseMimeType: application/json` → 400. Fallback: prompt-enforced JSON.
- On the non-schema path the model may emit reasoning prose around the JSON — fixes:
  `thinkingConfig: { thinkingBudget: 0 }` plus parsing from first `{` to last `}`.
- **Livestream VODs and other non-standard YouTube URLs are rejected by the video path**
  as `Unsupported MIME type: text/html`. Auto-fallback to `url_context` handles them.
- `mediaResolution: MEDIA_RESOLUTION_LOW` makes video processing dramatically faster —
  necessary to fit Forge's 55s limit — and costs nothing for distillation quality
  (the audio track carries the content).
- Corrupted URLs (the `&amp;` bug) produced *misleading* Gemini errors (MIME type,
  "URL redirected" refusals) — when Gemini rejects a URL, check the URL bytes first.

## Design decisions and their rationale

- **RoA and zero-egress were traded away consciously** for a self-contained pipeline
  (Danny: "I don't care about the Runs on Atlassian item here"). The positioning
  constraint (route AI through Atlassian-branded capabilities) was bent for the ingest
  model — mitigated by framing it as pluggable BYO-model and keeping all page-writing
  deterministic. Check with PMs before featuring the Gemini branch in official video
  content.
- **Ingest fires at capture time** (the bridge holds the new page's id/body, so no
  index lag), with the hourly sweep as janitor: retries, plus stubs filed via Rovo Chat
  (that path deliberately doesn't block on distillation — a chat agent shouldn't hang
  30s before replying).
- **Enrichment always degrades gracefully**: no bot token → raw Slack IDs; no
  YouTube key → oEmbed title only; no Gemini key → stubs simply wait. Capture never
  depends on enrichment or distillation.
- Failed stubs get `okf-ingest-failed` after 3 attempts (KVS attempt counters) — visible
  state, no infinite retry loops. Re-run one with `ingest-now?pageId=…&spaceKey=…`.
- `okf-ingested` stubs are retained (linked from their source page as provenance) rather
  than deleted or archived.

## Credentials (all encrypted Forge env vars, development environment)

| Variable | Purpose | Status (2026-07-17) |
|---|---|---|
| `SLACK_SIGNING_SECRET` | verify Slack event signatures | set |
| `SLACK_BOT_TOKEN` | resolve user/channel names | set |
| `GEMINI_API_KEY` | distillation | set |
| `YOUTUBE_API_KEY` | richer video *metadata on stubs* (optional; Gemini watches videos regardless) | not set |

## Open items

- **Commit the work** — v4.1.0 → v7.0.0 happened entirely in the working tree.
- **Internal escalation** for the Rovo provisioning defect (unblocks Slack Rovo app +
  automation actions; also product feedback: internal API names leak into user-facing
  errors, and the "ask your admin to activate AI" message points at a control that
  doesn't exist).
- Optional: `YOUTUBE_API_KEY` for richer stub metadata; delete the obsolete unsaved
  "Untitled flow" automation rule in KGD if it got saved.
