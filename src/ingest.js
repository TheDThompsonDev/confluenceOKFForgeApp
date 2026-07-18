import api, { fetch, route } from '@forge/api';
import { kvs } from '@forge/kvs';
import {
  getSpaceId,
  getSpacePages,
  findPageByTitle,
  createPage,
  addLabel,
  removeLabel,
  escapeXhtml,
} from './lib/confluence';
import { getWatchedSpaces } from './maintenance';

const GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_PER_RUN = 1;
const MAX_ATTEMPTS = 3;

const attemptsKey = (pageId) => `ingest:attempts:${pageId}`;

export async function runScheduledIngest() {
  return ingestSweep();
}

export async function ingestNewStub(spaceKey, stub) {
  if (!process.env.GEMINI_API_KEY) {
    return { status: 'skipped', reason: 'GEMINI_API_KEY not set' };
  }
  const client = api.asApp();
  const pages = await getSpacePages(client, spaceKey);
  return ingestStub(client, spaceKey, pages, stub);
}

export async function ingestNow(request) {
  const pageId = request?.queryParameters?.pageId?.[0];
  const spaceKey = request?.queryParameters?.spaceKey?.[0];
  let summary;
  if (pageId && spaceKey) {
    const client = api.asApp();
    const res = await client.requestConfluence(
      route`/wiki/api/v2/pages/${pageId}?body-format=storage`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) {
      summary = { status: 'error', message: `page ${pageId} not readable: ${res.status}` };
    } else {
      const page = await res.json();
      try {
        summary = await ingestNewStub(spaceKey, {
          id: page.id,
          title: page.title,
          body: page.body?.storage?.value ?? '',
        });
      } catch (e) {
        summary = { status: 'error', stub: page.title, message: e.message };
      }
    }
  } else {
    summary = await ingestSweep();
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': ['application/json'] },
    body: JSON.stringify(summary),
  };
}

async function ingestSweep() {
  if (!process.env.GEMINI_API_KEY) {
    console.log('ingest: GEMINI_API_KEY not set — skipping sweep');
    return { status: 'skipped', reason: 'GEMINI_API_KEY not set' };
  }
  const client = api.asApp();
  const results = [];
  let budget = MAX_PER_RUN;

  for (const spaceKey of await getWatchedSpaces()) {
    if (budget <= 0) break;
    try {
      const pages = await getSpacePages(client, spaceKey);
      const stubs = pages.filter((p) => p.labels.includes('okf-inbox'));
      for (const stub of stubs) {
        if (budget <= 0) break;
        budget -= 1;
        try {
          results.push(await ingestStub(client, spaceKey, pages, stub));
        } catch (e) {
          console.error(`ingest: "${stub.title}" failed — ${e.message}`);
          results.push({ spaceKey, stub: stub.title, status: 'error', message: e.message });
        }
      }
    } catch (e) {
      console.error(`ingest: sweep failed for ${spaceKey} — ${e.message}`);
      results.push({ spaceKey, status: 'error', message: e.message });
    }
  }
  console.log('ingest: sweep complete:', JSON.stringify(results));
  return { status: 'complete', processed: results };
}

async function ingestStub(client, spaceKey, pages, stub) {
  const attempts = ((await kvs.get(attemptsKey(stub.id))) ?? 0) + 1;
  if (attempts > MAX_ATTEMPTS) {
    await removeLabel(client, stub.id, 'okf-inbox');
    await addLabel(client, stub.id, 'okf-ingest-failed');
    await kvs.delete(attemptsKey(stub.id));
    console.warn(`ingest: giving up on "${stub.title}" after ${MAX_ATTEMPTS} attempts`);
    return { spaceKey, stub: stub.title, status: 'failed', message: 'max attempts reached' };
  }
  await kvs.set(attemptsKey(stub.id), attempts);

  const source = parseStub(stub.body);
  if (!source.url) {
    throw new Error(`stub "${stub.title}" has no source URL`);
  }

  const existingConcepts = pages.filter((p) => p.labels.includes('okf-concept')).map((p) => p.title);
  const existingEntities = pages.filter((p) => p.labels.includes('okf-entity')).map((p) => p.title);
  const distilled = await distillWithGemini(source, existingConcepts, existingEntities);

  const spaceId = await getSpaceId(client, spaceKey);
  const knownTitles = new Map(pages.map((p) => [p.title.toLowerCase(), p.title]));
  const sourceTitle = await uniqueTitle(client, spaceKey, cleanTitle(distilled.title));

  const conceptTitles = await materialize(
    client, spaceId, knownTitles, distilled.concepts, 'okf-concept', 'definition', sourceTitle
  );
  const entityTitles = await materialize(
    client, spaceId, knownTitles, distilled.entities, 'okf-entity', 'description', sourceTitle
  );

  const sourcePage = await createPage(
    client, spaceId, sourceTitle,
    sourceBody({ distilled, source, conceptTitles, entityTitles, stubTitle: stub.title })
  );
  await addLabel(client, sourcePage.id, 'okf-source');

  await removeLabel(client, stub.id, 'okf-inbox');
  await addLabel(client, stub.id, 'okf-ingested');
  await kvs.delete(attemptsKey(stub.id));

  console.log(`ingest: distilled "${stub.title}" → "${sourceTitle}" (+${conceptTitles.created} concepts, +${entityTitles.created} entities)`);
  return { spaceKey, stub: stub.title, status: 'ingested', sourcePage: sourceTitle };
}

async function materialize(client, spaceId, knownTitles, items, label, descField, sourceTitle) {
  const titles = [];
  let created = 0;
  for (const item of (items ?? []).slice(0, 4)) {
    const name = cleanTitle(item?.name ?? '');
    if (!name) continue;
    const existing = knownTitles.get(name.toLowerCase());
    if (existing) {
      titles.push(existing);
      continue;
    }
    const body = [
      `<p>${escapeXhtml(item[descField] ?? '')}</p>`,
      `<p><em>Introduced by </em>${pageLink(sourceTitle)}</p>`,
    ].join('');
    const page = await createPage(client, spaceId, name, body);
    await addLabel(client, page.id, label);
    knownTitles.set(name.toLowerCase(), name);
    titles.push(name);
    created += 1;
  }
  titles.created = created;
  return titles;
}

async function distillWithGemini(source, existingConcepts, existingEntities) {
  const isYouTube = /(^|\.)(youtube\.com|youtu\.be)$/.test(safeHost(source.url));
  const instructions = [
    'You are the ingest agent for a team knowledge graph (Open Knowledge Format).',
    'Distill the source below into JSON matching the response schema.',
    '- title: a short natural page title for the source summary (no emoji, no quotes)',
    '- summary: 2-4 short paragraphs of plain prose, separated by blank lines',
    '- keyPoints: 3-6 specific claims or takeaways from the source',
    '- concepts: 0-4 durable ideas, methods, or patterns the source teaches. definition: 1-2 standalone sentences.',
    '- entities: 0-4 specific people, organizations, products, or papers central to the source. description: 1-2 standalone sentences.',
    'Reuse EXACT names from the existing lists when an idea or entity matches; only introduce new names for genuinely new ones.',
    'Never invent facts that are not in the source.',
    `EXISTING CONCEPTS: ${JSON.stringify(existingConcepts)}`,
    `EXISTING ENTITIES: ${JSON.stringify(existingEntities)}`,
    source.comment ? `SHARER'S COMMENT (context for why this matters): ${source.comment}` : '',
    `SOURCE URL: ${source.url}`,
  ];

  const baseGenerationConfig = () => ({
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA,
  });

  const videoRequest = () => ({
    contents: [{
      parts: [
        { fileData: { fileUri: source.url } },
        { text: instructions.filter(Boolean).join('\n') },
      ],
    }],
    generationConfig: { ...baseGenerationConfig(), mediaResolution: 'MEDIA_RESOLUTION_LOW' },
  });

  const textRequest = () => ({
    contents: [{
      parts: [{
        text: instructions
          .filter(Boolean)
          .concat(`CAPTURED SOURCE TEXT:\n${source.captured}`)
          .join('\n'),
      }],
    }],
    generationConfig: baseGenerationConfig(),
  });

  const urlContextRequest = () => ({
    contents: [{
      parts: [{
        text: instructions
          .filter(Boolean)
          .concat([
            'Read the SOURCE URL with the url context tool and distill its content.',
            'Respond with ONLY a raw JSON object (no markdown fences, no commentary) with exactly these fields: ' +
              '{"title": string, "summary": string, "keyPoints": string[], ' +
              '"concepts": [{"name": string, "definition": string}], "entities": [{"name": string, "description": string}]}',
          ])
          .join('\n'),
      }],
    }],
    tools: [{ url_context: {} }],
    generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
  });

  const callGemini = async (request) => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify(request),
      }
    );
    if (!res.ok) {
      throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return res.json();
  };

  let data;
  if (isYouTube) {
    try {
      data = await callGemini(videoRequest());
    } catch (e) {
      if (!e.message.includes('Unsupported MIME type')) throw e;
      console.warn(`ingest: video path rejected ${source.url} — retrying via url_context`);
      data = await callGemini(urlContextRequest());
    }
  } else if (source.captured) {
    data = await callGemini(textRequest());
  } else {
    data = await callGemini(urlContextRequest());
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  let parsed;
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object');
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error(`Gemini returned non-JSON output: ${text.slice(0, 200)}`);
  }
  if (!parsed.title || !parsed.summary) {
    throw new Error('Gemini output missing required fields');
  }
  return parsed;
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    summary: { type: 'STRING' },
    keyPoints: { type: 'ARRAY', items: { type: 'STRING' } },
    concepts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, definition: { type: 'STRING' } },
        required: ['name', 'definition'],
      },
    },
    entities: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, description: { type: 'STRING' } },
        required: ['name', 'description'],
      },
    },
  },
  required: ['title', 'summary', 'keyPoints', 'concepts', 'entities'],
};

function sourceBody({ distilled, source, conceptTitles, entityTitles, stubTitle }) {
  const paragraphs = String(distilled.summary)
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeXhtml(p.trim())}</p>`)
    .join('');
  const points = (distilled.keyPoints ?? [])
    .map((k) => `<li>${escapeXhtml(k)}</li>`)
    .join('');
  const linkList = (titles) => `<ul>${titles.map((t) => `<li>${pageLink(t)}</li>`).join('')}</ul>`;

  return [
    `<p><em>Distilled from <a href="${escapeXhtml(source.url)}">${escapeXhtml(safeHost(source.url) || source.url)}</a>` +
      `${source.sharedBy ? `, shared by ${escapeXhtml(source.sharedBy)}` : ''} — auto-ingested.</em></p>`,
    '<h2>Summary</h2>',
    paragraphs,
    points ? '<h2>Key points</h2>' : '',
    points ? `<ul>${points}</ul>` : '',
    source.comment ? '<h2>Why this matters to us</h2>' : '',
    source.comment ? `<blockquote><p>${escapeXhtml(source.comment)}</p></blockquote>` : '',
    conceptTitles.length ? '<h2>Concepts</h2>' : '',
    conceptTitles.length ? linkList(conceptTitles) : '',
    entityTitles.length ? '<h2>Entities</h2>' : '',
    entityTitles.length ? linkList(entityTitles) : '',
    `<p><em>Raw capture: </em>${pageLink(stubTitle)}</p>`,
  ].filter(Boolean).join('');
}

function parseStub(body) {
  let url = body.match(/<a href="([^"]+)"/)?.[1] ?? null;
  while (url && url.includes('&amp;')) url = url.replace(/&amp;/g, '&');
  const sharedBy = stripTags(body.match(/<th>Shared by<\/th><td>([\s\S]*?)<\/td>/)?.[1] ?? '');
  const comment = stripTags(body.match(/<blockquote><p>([\s\S]*?)<\/p><\/blockquote>/)?.[1] ?? '');
  const capturedRaw = body.match(/<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/)?.[1] ?? '';
  const captured = stripTags(capturedRaw.replace(/<\/p><p>/g, '\n')).trim();
  return { url, sharedBy, comment, captured: captured || null };
}

function stripTags(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function pageLink(title) {
  return `<ac:link><ri:page ri:content-title="${escapeXhtml(title)}" /></ac:link>`;
}

function cleanTitle(t) {
  return String(t).replace(/\s+/g, ' ').trim().slice(0, 200);
}

async function uniqueTitle(client, spaceKey, title) {
  if (!(await findPageByTitle(client, spaceKey, title))) return title;
  const dated = `${title} (${new Date().toISOString().slice(0, 10)})`;
  if (!(await findPageByTitle(client, spaceKey, dated))) return dated;
  return `${title} (${Date.now()})`;
}

function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/^(www|m)\./, '');
  } catch {
    return '';
  }
}
