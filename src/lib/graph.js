import { getSpacePages, parseLinkedTitles } from './confluence';

const HEALTH_PAGE_TITLE = 'Knowledge Graph Health';

export async function buildGraph(client, spaceKey) {
  const pages = (await getSpacePages(client, spaceKey)).filter(
    (p) => p.title !== HEALTH_PAGE_TITLE
  );

  const idByTitle = new Map();
  for (const page of pages) {
    idByTitle.set(page.title.toLowerCase(), page.id);
  }

  const links = [];
  const unresolved = [];
  const degree = new Map(pages.map((p) => [p.id, 0]));

  for (const page of pages) {
    const seen = new Set();
    for (const title of parseLinkedTitles(page.body)) {
      const targetId = idByTitle.get(title.toLowerCase());
      if (!targetId) {
        unresolved.push({ from: page.title, to: title });
        continue;
      }
      if (targetId === page.id || seen.has(targetId)) continue;
      seen.add(targetId);
      links.push({ source: page.id, target: targetId });
      degree.set(page.id, degree.get(page.id) + 1);
      degree.set(targetId, degree.get(targetId) + 1);
    }
  }

  const nodes = pages.map((page) => ({
    id: page.id,
    title: page.title,
    type: page.type,
    url: page.url,
    orphan: degree.get(page.id) === 0 && page.type !== 'inbox',
  }));

  const countByType = { concept: 0, entity: 0, source: 0, page: 0, inbox: 0 };
  for (const node of nodes) countByType[node.type] += 1;

  return {
    spaceKey,
    nodes,
    links,
    unresolved,
    stats: {
      pages: nodes.length,
      links: links.length,
      orphans: nodes.filter((n) => n.orphan).length,
      unresolvedLinks: unresolved.length,
      ...countByType,
    },
  };
}
