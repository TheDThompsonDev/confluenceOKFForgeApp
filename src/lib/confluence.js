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

export async function getSpacePages(client, spaceKey) {
  const spaceId = await getSpaceId(client, spaceKey);
  if (!spaceId) throw new Error(`Space ${spaceKey} not found`);

  const pages = [];
  let cursor = null;
  while (pages.length < MAX_PAGES) {
    const res = await client.requestConfluence(
      cursor
        ? route`/wiki/api/v2/spaces/${spaceId}/pages?status=current&body-format=storage&limit=${PAGE_FETCH_LIMIT}&cursor=${cursor}`
        : route`/wiki/api/v2/spaces/${spaceId}/pages?status=current&body-format=storage&limit=${PAGE_FETCH_LIMIT}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch pages for ${spaceKey}: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    for (const page of data.results || []) {
      pages.push({
        id: String(page.id),
        title: page.title,
        body: page.body?.storage?.value || '',
        url: page._links?.webui ? `/wiki${page._links.webui}` : null,
      });
    }
    const next = data._links?.next;
    if (!next) break;
    cursor = new URL(`https://x${next}`).searchParams.get('cursor');
    if (!cursor) break;
  }

  const BATCH = 10;
  for (let i = 0; i < pages.length; i += BATCH) {
    await Promise.all(
      pages.slice(i, i + BATCH).map(async (page) => {
        page.labels = await getPageLabels(client, page.id);
        page.type = classifyLabels(page.labels);
      })
    );
  }
  return pages;
}

async function getPageLabels(client, pageId) {
  const res = await client.requestConfluence(
    route`/wiki/api/v2/pages/${pageId}/labels?limit=100`,
    { headers: { Accept: 'application/json' } }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch labels for page ${pageId}: ${res.status}`);
  }
  const data = await res.json();
  return (data.results || []).map((l) => l.name);
}

function classifyLabels(labels) {
  for (const label of labels) {
    if (OKF_LABEL_TYPES[label]) return OKF_LABEL_TYPES[label];
  }
  return 'page';
}

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
  const spaceId = await getSpaceId(client, spaceKey);
  if (!spaceId) return null;
  const res = await client.requestConfluence(
    route`/wiki/api/v2/pages?space-id=${spaceId}&title=${title}&status=current&limit=1`,
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

export async function removeLabel(client, pageId, label) {
  const res = await client.requestConfluence(
    route`/wiki/rest/api/content/${pageId}/label/${label}`,
    { method: 'DELETE' }
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to remove label ${label} from ${pageId}: ${res.status} ${await res.text()}`);
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
