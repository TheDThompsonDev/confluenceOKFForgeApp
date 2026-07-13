import api, { route } from '@forge/api';
import { getWatchedSpaces, getStoredHealth } from './maintenance';

const OKF_LABEL_TYPES = {
  'okf-concept': 'concept',
  'okf-entity': 'entity',
  'okf-source': 'source',
};

// Rovo action: search the knowledge graph for pages matching a query.
export async function findKnowledgeEntries(payload) {
  const query = (payload?.query ?? payload?.inputs?.query ?? '').trim();
  if (!query) {
    return { error: 'No query provided.' };
  }

  const watched = await getWatchedSpaces();
  const safeQuery = query.replace(/["\\]/g, ' ');
  const spaceFilter = watched.length
    ? ` AND space IN (${watched.map((k) => `"${k}"`).join(', ')})`
    : '';
  const cql = `type = page AND (title ~ "${safeQuery}" OR text ~ "${safeQuery}")${spaceFilter} ORDER BY lastmodified DESC`;

  const res = await api.asUser().requestConfluence(
    route`/wiki/rest/api/content/search?cql=${cql}&expand=metadata.labels,space&limit=8`,
    { headers: { Accept: 'application/json' } }
  );
  if (!res.ok) {
    return { error: `Search failed with status ${res.status}.` };
  }
  const data = await res.json();
  const results = (data.results || []).map((page) => {
    const labels = (page.metadata?.labels?.results || []).map((l) => l.name);
    const okfType = labels.map((l) => OKF_LABEL_TYPES[l]).find(Boolean) || 'page';
    return {
      title: page.title,
      okfType,
      labels,
      spaceKey: page.space?.key,
      url: page._links?.webui ? `/wiki${page._links.webui}` : null,
    };
  });

  return {
    query,
    searchedSpaces: watched.length ? watched : 'all spaces',
    resultCount: results.length,
    results,
  };
}

// Rovo action: report the latest stored health check(s).
export async function getGraphHealth(payload) {
  const spaceKey = (payload?.spaceKey ?? payload?.inputs?.spaceKey ?? '').trim();

  if (spaceKey) {
    const health = await getStoredHealth(spaceKey);
    return health || {
      spaceKey,
      message: `No health report stored for space ${spaceKey}. It may not be watched yet, or the first scheduled check has not run.`,
    };
  }

  const watched = await getWatchedSpaces();
  if (!watched.length) {
    return { message: 'No spaces are being watched yet. Open the Knowledge Graph page in Confluence and watch a space to enable health checks.' };
  }
  const reports = [];
  for (const key of watched) {
    const health = await getStoredHealth(key);
    reports.push(health || { spaceKey: key, message: 'No report yet — first scheduled check has not run.' });
  }
  return { watchedSpaces: watched, reports };
}
