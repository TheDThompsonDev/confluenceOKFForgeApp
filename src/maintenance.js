import api from '@forge/api';
import { kvs } from '@forge/kvs';
import { buildGraph } from './lib/graph';
import { getSpaceId, findPageByTitle, createPage, updatePage, escapeXhtml } from './lib/confluence';

export const HEALTH_PAGE_TITLE = 'Knowledge Graph Health';
export const WATCHED_SPACES_KEY = 'watchedSpaces';

const healthKey = (spaceKey) => `health:${spaceKey}`;

export async function getWatchedSpaces() {
  return (await kvs.get(WATCHED_SPACES_KEY)) || [];
}

export async function setWatchedSpaces(spaceKeys) {
  await kvs.set(WATCHED_SPACES_KEY, spaceKeys);
  return spaceKeys;
}

export async function getStoredHealth(spaceKey) {
  return kvs.get(healthKey(spaceKey));
}

export async function runScheduledMaintenance() {
  const spaceKeys = await getWatchedSpaces();
  const results = [];
  for (const spaceKey of spaceKeys) {
    try {
      results.push(await runHealthCheck(api.asApp(), spaceKey));
    } catch (error) {
      console.error(`Health check failed for space ${spaceKey}:`, error);
      results.push({ spaceKey, error: error.message });
    }
  }
  console.log('Scheduled maintenance complete:', JSON.stringify(results.map((r) => ({
    spaceKey: r.spaceKey,
    orphans: r.stats?.orphans,
    unresolvedLinks: r.stats?.unresolvedLinks,
    error: r.error,
  }))));
  return results;
}

export async function runHealthCheck(client, spaceKey) {
  const graph = await buildGraph(client, spaceKey);
  const checkedAt = new Date().toISOString();

  const summary = {
    spaceKey,
    checkedAt,
    stats: graph.stats,
    orphans: graph.nodes.filter((n) => n.orphan).map((n) => n.title),
    unresolved: graph.unresolved,
    inbox: graph.nodes.filter((n) => n.type === 'inbox').map((n) => n.title),
  };
  await kvs.set(healthKey(spaceKey), summary);

  const body = renderHealthReport(summary);
  const existing = await findPageByTitle(client, spaceKey, HEALTH_PAGE_TITLE);
  if (existing) {
    await updatePage(client, existing.id, HEALTH_PAGE_TITLE, body);
  } else {
    const spaceId = await getSpaceId(client, spaceKey);
    if (!spaceId) throw new Error(`Space ${spaceKey} not found`);
    await createPage(client, spaceId, HEALTH_PAGE_TITLE, body);
  }
  return summary;
}

function renderHealthReport({ spaceKey, checkedAt, stats, orphans, unresolved, inbox = [] }) {
  const pageLink = (title) =>
    `<ac:link><ri:page ri:content-title="${escapeXhtml(title)}" /></ac:link>`;

  const orphanSection = orphans.length
    ? `<ul>${orphans.map((t) => `<li>${pageLink(t)}</li>`).join('')}</ul>`
    : '<p>None — every page is connected. 🎉</p>';

  const inboxSection = inbox.length
    ? `<ul>${inbox.map((t) => `<li>${pageLink(t)}</li>`).join('')}</ul>`
    : '<p>None — the inbox is clear. 🎉</p>';

  const unresolvedSection = unresolved.length
    ? `<ul>${unresolved
        .map((u) => `<li>${pageLink(u.from)} links to missing page <strong>${escapeXhtml(u.to)}</strong></li>`)
        .join('')}</ul>`
    : '<p>None — every link resolves. 🎉</p>';

  return [
    `<p><em>Generated automatically by Knowledge Graph for Confluence on ${escapeXhtml(checkedAt)}.</em></p>`,
    '<h2>Overview</h2>',
    '<table><tbody>',
    `<tr><th>Pages</th><td>${stats.pages}</td></tr>`,
    `<tr><th>Links</th><td>${stats.links}</td></tr>`,
    `<tr><th>Concepts</th><td>${stats.concept}</td></tr>`,
    `<tr><th>Entities</th><td>${stats.entity}</td></tr>`,
    `<tr><th>Sources</th><td>${stats.source}</td></tr>`,
    '</tbody></table>',
    `<h2>Orphaned pages (${orphans.length})</h2>`,
    '<p>Pages with no links in or out. An ingest step may have been skipped.</p>',
    orphanSection,
    `<h2>Unresolved links (${unresolved.length})</h2>`,
    '<p>Links that point to pages that do not exist in this space yet.</p>',
    unresolvedSection,
    `<h2>Awaiting ingestion (${inbox.length})</h2>`,
    '<p>Raw sources captured from Slack that the ingest agent has not distilled yet.</p>',
    inboxSection,
    `<p><em>Space: ${escapeXhtml(spaceKey)}</em></p>`,
  ].join('');
}
