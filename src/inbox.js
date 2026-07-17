import crypto from 'node:crypto';
import api from '@forge/api';
import { kvs } from '@forge/kvs';
import { getSpaceId, createPage, addLabel, escapeXhtml } from './lib/confluence';
import { getWatchedSpaces } from './maintenance';

// Rovo action: file a shared link as an okf-inbox stub page. Reached from
// Rovo Chat anywhere it runs — including the official Rovo app for Slack,
// where the agent can be channel-triggered by an emoji or @mention.
// Deliberately does NO AI work and NO external fetching: the ingest agent
// (via Remote MCP) distills the source later. Zero egress.
const URL_PATTERN = /https?:\/\/[^\s<>|"']+/;

export async function fileToInbox(payload) {
  const rawUrl = (payload?.url ?? payload?.inputs?.url ?? '').trim();
  const comment = (payload?.comment ?? payload?.inputs?.comment ?? '').trim();
  const sharedBy = (payload?.sharedBy ?? payload?.inputs?.sharedBy ?? '').trim() || 'unknown';
  const channel = (payload?.channel ?? payload?.inputs?.channel ?? '').trim() || null;

  const urlMatch = rawUrl.match(URL_PATTERN) || comment.match(URL_PATTERN);
  if (!urlMatch) {
    return { status: 'error', message: 'No URL found. Provide the link to file.' };
  }
  const url = urlMatch[0].replace(/[>.,)]+$/, '');

  const spaceKey =
    (payload?.spaceKey ?? payload?.inputs?.spaceKey ?? '').trim() ||
    (await getWatchedSpaces())[0];
  if (!spaceKey) {
    return {
      status: 'error',
      message: 'No target space configured. Watch a space in the Knowledge Graph app first, or specify a space key.',
    };
  }

  const urlHash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
  const dedupKey = `inbox:${spaceKey}:${urlHash}`;
  const existing = await kvs.get(dedupKey);
  if (existing) {
    return {
      status: 'duplicate',
      message: `Already in the knowledge graph inbox for ${spaceKey}.`,
      url,
    };
  }

  const client = api.asApp();
  const spaceId = await getSpaceId(client, spaceKey);
  if (!spaceId) {
    return { status: 'error', message: `Space ${spaceKey} not found.` };
  }

  const title = inboxTitle(url, comment, payload?.title);
  const body = inboxBody({ url, comment, sharedBy, channel, rawContent: payload?.rawContent });
  const page = await createPage(client, spaceId, title, body);
  await addLabel(client, page.id, 'okf-inbox');
  await kvs.set(dedupKey, { url, pageId: page.id, receivedAt: new Date().toISOString() });

  console.log(`fileToInbox: filed "${title}" in ${spaceKey} (shared by ${sharedBy})`);
  return {
    status: 'filed',
    message: `Filed to the knowledge graph inbox 📥 — it will be distilled on the next ingest run.`,
    pageTitle: title,
    pageId: page.id,
    pageBody: body,
    spaceKey,
  };
}

function inboxTitle(url, comment, fetchedTitle) {
  const cleanedTitle = (fetchedTitle ?? '').replace(/\s+/g, ' ').trim();
  if (cleanedTitle) {
    return `📥 ${cleanedTitle.slice(0, 120)}${cleanedTitle.length > 120 ? '…' : ''}`;
  }
  let domain;
  try {
    domain = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    domain = 'link';
  }
  const cleaned = comment.replace(URL_PATTERN, '').replace(/\s+/g, ' ').trim();
  const suffix = cleaned
    ? ` — ${cleaned.slice(0, 60)}${cleaned.length > 60 ? '…' : ''}`
    : ` — ${new Date().toISOString().slice(0, 10)}`;
  return `📥 ${domain}${suffix}`;
}

function inboxBody({ url, comment, sharedBy, channel, rawContent }) {
  const rows = [
    ['Source URL', `<a href="${escapeXhtml(url)}">${escapeXhtml(url)}</a>`],
    ['Shared by', escapeXhtml(sharedBy)],
    channel ? ['Channel', `#${escapeXhtml(channel)}`] : null,
    ['Status', 'Awaiting ingestion'],
  ].filter(Boolean);

  return [
    '<p><strong>Raw source captured via the Knowledge Graph Agent — not yet distilled.</strong></p>',
    '<table><tbody>',
    ...rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`),
    '</tbody></table>',
    comment ? '<h2>Why this matters to us</h2>' : '',
    comment ? `<blockquote><p>${escapeXhtml(comment)}</p></blockquote>` : '',
    rawContent ? '<h2>Captured content (raw)</h2>' : '',
    rawContent
      ? '<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">Deterministically extracted at capture time — no AI, may include page boilerplate</ac:parameter>' +
        `<ac:rich-text-body><p>${escapeXhtml(rawContent).replace(/\n/g, '</p><p>')}</p></ac:rich-text-body></ac:structured-macro>`
      : '',
    '<h2>For the ingest agent</h2>',
    '<p>Use the captured content above if present (otherwise read the source URL), then follow the wiki constitution: create or update okf-concept and okf-entity pages, write an okf-source summary page linking to them, preserve the sharer’s comment as “why this matters to us,” and replace this page’s label <code>okf-inbox</code> with <code>okf-source</code> — or link this stub from the new source page and archive it.</p>',
  ].filter(Boolean).join('');
}
