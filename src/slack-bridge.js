import crypto from 'node:crypto';
import { fetch } from '@forge/api';
import { fileToInbox } from './inbox';
import { ingestNewStub } from './ingest';

// Webtrigger: a direct Slack Events API bridge — no Rovo Slack app required.
// A custom Slack app posts channel messages here; any message containing a
// link is filed through the same fileToInbox path the Rovo action uses.
// Trade-off (deliberate): a webtrigger module ends Runs on Atlassian
// eligibility. Still zero egress — this endpoint only receives.
const SLACK_LINK = /<(https?:\/\/[^>|]+)(?:\|[^>]*)?>/g;
const MAX_SKEW_SECONDS = 60 * 5;

export async function slackEvents(request) {
  const body = request.body ?? '';
  const headers = normalizeHeaders(request.headers);

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return respond(400, { error: 'invalid JSON' });
  }

  // Slack sends url_verification when the Request URL is first configured.
  // Answered even before the signing secret is set, so the endpoint can be
  // verified during Slack app creation; real events always require the secret.
  if (payload.type === 'url_verification') {
    return respond(200, { challenge: payload.challenge });
  }

  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) {
    console.error('slackEvents: SLACK_SIGNING_SECRET is not set — run: forge variables set --encrypt SLACK_SIGNING_SECRET <value>');
    return respond(401, { error: 'signing secret not configured' });
  }
  if (!verifySignature(secret, headers, body)) {
    console.warn('slackEvents: rejected request with bad or stale signature');
    return respond(401, { error: 'bad signature' });
  }

  if (payload.type === 'event_callback') {
    // Errors are logged but still answered with 200: repeated non-2xx
    // responses make Slack disable the event subscription entirely, and
    // KVS dedup already makes retried deliveries idempotent.
    try {
      await handleEvent(payload.event);
    } catch (e) {
      console.error(`slackEvents: ${e.message}`);
    }
  }
  return respond(200, { ok: true });
}

async function handleEvent(event) {
  if (event?.type !== 'message' || event.subtype || event.bot_id || !event.user) {
    return; // edits, joins, bot echoes (incl. our own confirmations if ever added)
  }
  // Slack HTML-escapes message text (& becomes &amp;) — decode before URL
  // extraction or query strings arrive corrupted downstream.
  const text = decodeEntities(event.text ?? '');
  const urls = [...new Set([...text.matchAll(SLACK_LINK)].map((m) => m[1]))];
  if (urls.length === 0) {
    return; // only link-bearing messages become inbox stubs
  }
  const comment = text.replace(SLACK_LINK, '').replace(/\s+/g, ' ').trim();

  // Metadata enrichment only — sharer name, channel name, link title. Content
  // distillation still belongs to the ingest agent. Every lookup degrades
  // gracefully to the raw ID / domain if the call fails or the token is unset.
  const [sharedBy, channel] = await Promise.all([
    resolveUserName(event.user),
    resolveChannelName(event.channel),
  ]);

  for (const url of urls) {
    const meta = await fetchLinkMeta(url);
    const result = await fileToInbox({
      url,
      comment,
      title: meta.title,
      rawContent: meta.text,
      sharedBy: sharedBy ?? `Slack user ${event.user}`,
      channel: channel ?? event.channel,
    });
    console.log(`slackEvents: ${result.status} — ${url}${result.message ? ` (${result.message})` : ''}`);

    // Distill immediately — the fresh page isn't visible to CQL-based sweeps
    // for a few minutes (search index lag), but we already hold its id and
    // body. If this times out or fails, the stub keeps its okf-inbox label
    // and the hourly sweep retries it.
    if (result.status === 'filed') {
      try {
        const ingested = await ingestNewStub(result.spaceKey, {
          id: result.pageId,
          title: result.pageTitle,
          body: result.pageBody,
        });
        console.log(`slackEvents: auto-ingest ${ingested.status}${ingested.sourcePage ? ` → "${ingested.sourcePage}"` : ''}`);
      } catch (e) {
        console.warn(`slackEvents: auto-ingest failed (${e.message}) — hourly sweep will retry`);
      }
    }
  }
}

async function slackApi(method, params) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;
  try {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`https://slack.com/api/${method}?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn(`slackEvents: ${method} failed — ${data.error}`);
      return null;
    }
    return data;
  } catch (e) {
    console.warn(`slackEvents: ${method} failed — ${e.message}`);
    return null;
  }
}

async function resolveUserName(userId) {
  const data = await slackApi('users.info', { user: userId });
  return data?.user?.profile?.display_name || data?.user?.real_name || null;
}

async function resolveChannelName(channelId) {
  const data = await slackApi('conversations.info', { channel: channelId });
  return data?.channel?.name || null;
}

// Fetches title + readable text so downstream distillation (Confluence
// Automation + Rovo, or the MCP ingest agent) never needs external access.
// Deterministic extraction only — tag stripping, no AI. YouTube pages are
// script shells, so oEmbed supplies title/author and text stays empty.
const MAX_CAPTURED_CHARS = 20_000;

async function fetchLinkMeta(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^(www|m)\./, '');
    if (host === 'youtube.com' || host === 'youtu.be') {
      return fetchYouTubeMeta(url, parsed);
    }
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KnowledgeGraphBridge/1.0)' },
    });
    if (!res.ok) return { title: null, text: null };
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    return {
      title: titleMatch ? decodeEntities(titleMatch[1]) : null,
      text: extractReadableText(html),
    };
  } catch {
    return { title: null, text: null };
  }
}

// With a YOUTUBE_API_KEY (official Data API v3), videos capture channel,
// duration, and full description — enough for automated distillation to say
// what the resource is. Without it, falls back to oEmbed (title/author only).
// Transcripts are deliberately not fetched: the official API is owner-only,
// and scraping the watch page's internals is fragile and ToS-gray.
async function fetchYouTubeMeta(url, parsed) {
  const fallback = async () => {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (!res.ok) return { title: null, text: null };
    const data = await res.json();
    const title = data.title ?? null;
    return { title, text: data.author_name ? `Video by ${data.author_name}: ${title}` : null };
  };

  const apiKey = process.env.YOUTUBE_API_KEY;
  const videoId =
    parsed.hostname.replace(/^(www|m)\./, '') === 'youtu.be'
      ? parsed.pathname.slice(1).split('/')[0]
      : parsed.searchParams.get('v') || parsed.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/)?.[1];
  if (!apiKey || !videoId) return fallback();

  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${apiKey}`
  );
  if (!res.ok) {
    console.warn(`slackEvents: YouTube Data API failed (${res.status}) — falling back to oEmbed`);
    return fallback();
  }
  const item = (await res.json()).items?.[0];
  if (!item) return fallback();

  const { title, channelTitle, description, tags, publishedAt } = item.snippet ?? {};
  const text = [
    `Video by ${channelTitle}${publishedAt ? `, published ${publishedAt.slice(0, 10)}` : ''}`,
    item.contentDetails?.duration ? `Duration: ${item.contentDetails.duration}` : null,
    tags?.length ? `Tags: ${tags.slice(0, 15).join(', ')}` : null,
    description ? `Description:\n${description}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return { title: title ?? null, text: text.length > MAX_CAPTURED_CHARS ? `${text.slice(0, MAX_CAPTURED_CHARS)}…` : text };
}

function extractReadableText(html) {
  const text = decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|nav|header|footer)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(p|div|br|li|h[1-6]|tr|blockquote)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  if (text.length < 200) return null; // script-shell page; nothing useful captured
  return text.length > MAX_CAPTURED_CHARS ? `${text.slice(0, MAX_CAPTURED_CHARS)}…` : text;
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function verifySignature(secret, headers, body) {
  const signature = headers['x-slack-signature'];
  const timestamp = headers['x-slack-request-timestamp'];
  if (!signature || !timestamp) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return false;

  const expected = `v0=${crypto
    .createHmac('sha256', secret)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

function normalizeHeaders(raw = {}) {
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

function respond(statusCode, bodyObject) {
  return {
    statusCode,
    headers: { 'Content-Type': ['application/json'] },
    body: JSON.stringify(bodyObject),
  };
}
