import { route } from '@forge/api';

export const OKF_LABEL_TYPES = {
  'okf-concept': 'concept',
  'okf-entity': 'entity',
  'okf-source': 'source',
  'okf-inbox': 'inbox',
};

const PAGE_FETCH_LIMIT = 100;
const MAX_PAGES = 500;

export async function getSpaces(client) {
  const res = await client.requestConfluence(
    route`/wiki/api/v2/spaces?status=current&sort=name&limit=250`,
    { headers: { Accept: 'application/json' } }
  );
  if (!res.ok) {
    throw new Error(`Failed to list spaces: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const spaces = (data.results || []).map((s) => ({
    id: s.id,
    key: s.key,
    name: s.name,
    type: s.type,
  }));
  console.log(`getSpaces: ${spaces.length} space(s):`, JSON.stringify(spaces.map((s) => `${s.key} (${s.type})`)));
  return spaces;
}

export async function getSpaceId(client, spaceKey) {
  const res = await client.requestConfluence(
    route`/wiki/api/v2/spaces?keys=${spaceKey}`,
    { headers: { Accept: 'application/json' } }
  );
  if (!res.ok) {
    throw new Error(`Failed to resolve space ${spaceKey}: ${res.status}`);
  }
  const data = await res.json();
  return data.results?.[0]?.id ?? null;
}

// One CQL search returns bodies and labels together, so building the graph
// costs O(pages/limit) requests rather than one request per page.
export async function getSpacePages(client, spaceKey) {
  const pages = [];
  let start = 0;
  while (pages.length < MAX_PAGES) {
    const cql = `space = "${spaceKey}" AND type = page ORDER BY created ASC`;
    const res = await client.requestConfluence(
      route`/wiki/rest/api/content/search?cql=${cql}&expand=metadata.labels,body.storage&limit=${PAGE_FETCH_LIMIT}&start=${start}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch pages for ${spaceKey}: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    const results = data.results || [];
    for (const page of results) {
      pages.push({
        id: page.id,
        title: page.title,
        type: classifyPage(page),
        labels: (page.metadata?.labels?.results || []).map((l) => l.name),
        body: page.body?.storage?.value || '',
        url: page._links?.webui ? `/wiki${page._links.webui}` : null,
      });
    }
    if (results.length < PAGE_FETCH_LIMIT) break;
    start += PAGE_FETCH_LIMIT;
  }
  return pages;
}

function classifyPage(page) {
  const labels = page.metadata?.labels?.results || [];
  for (const label of labels) {
    if (OKF_LABEL_TYPES[label.name]) return OKF_LABEL_TYPES[label.name];
  }
  return 'page';
}

// Storage-format bodies reference other pages as
// <ac:link><ri:page ri:content-title="Some Page"/></ac:link>
export function parseLinkedTitles(storageBody) {
  const titles = [];
  const pattern = /<ri:page\b[^>]*ri:content-title="([^"]*)"/g;
  let match;
  while ((match = pattern.exec(storageBody)) !== null) {
    titles.push(decodeEntities(match[1]));
  }
  return titles;
}

function decodeEntities(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function escapeXhtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function findPageByTitle(client, spaceKey, title) {
  const cql = `space = "${spaceKey}" AND type = page AND title = "${title.replace(/"/g, '\\"')}"`;
  const res = await client.requestConfluence(
    route`/wiki/rest/api/content/search?cql=${cql}&limit=1`,
    { headers: { Accept: 'application/json' } }
  );
  if (!res.ok) {
    throw new Error(`Failed title lookup in ${spaceKey}: ${res.status}`);
  }
  const data = await res.json();
  return data.results?.[0] ?? null;
}

export async function createPage(client, spaceId, title, storageBody) {
  const res = await client.requestConfluence(route`/wiki/api/v2/pages`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      spaceId,
      status: 'current',
      title,
      body: { representation: 'storage', value: storageBody },
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create page "${title}": ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function addLabel(client, pageId, label) {
  const res = await client.requestConfluence(route`/wiki/rest/api/content/${pageId}/label`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify([{ prefix: 'global', name: label }]),
  });
  if (!res.ok) {
    throw new Error(`Failed to label page ${pageId}: ${res.status} ${await res.text()}`);
  }
}

export async function updatePage(client, pageId, title, storageBody) {
  const current = await client.requestConfluence(
    route`/wiki/api/v2/pages/${pageId}`,
    { headers: { Accept: 'application/json' } }
  );
  if (!current.ok) {
    throw new Error(`Failed to read page ${pageId}: ${current.status}`);
  }
  const page = await current.json();
  const res = await client.requestConfluence(route`/wiki/api/v2/pages/${pageId}`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: pageId,
      status: 'current',
      title,
      body: { representation: 'storage', value: storageBody },
      version: { number: page.version.number + 1 },
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to update page ${pageId}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}
