import { getSpaceId, findPageByTitle, createPage, addLabel } from './lib/confluence';

const link = (title) => `<ac:link><ri:page ri:content-title="${title}" /></ac:link>`;

const SEED_PAGES = [
  {
    title: 'Knowledge Graph Index',
    label: null,
    body: `
      <p>Curated map of everything ingested into this knowledge graph.</p>
      <h2>Sources</h2>
      <ul>
        <li>${link('MIT Cognitive Debt Study')}</li>
        <li>${link('Forward Deployed Models Change Everything')}</li>
      </ul>
      <h2>Concepts</h2>
      <ul>
        <li>${link('Cognitive Debt')}</li>
        <li>${link('Cognitive Offloading')}</li>
        <li>${link('Neural Connectivity')}</li>
        <li>${link('Graph RAG')}</li>
        <li>${link('Frontier Model Adoption')}</li>
        <li>${link('Agent-Readable Knowledge')}</li>
      </ul>
      <h2>Entities</h2>
      <ul>
        <li>${link('MIT Media Lab')}</li>
        <li>${link('Nataliya Kosmyna')}</li>
        <li>${link('Andrej Karpathy')}</li>
        <li>${link('Open Knowledge Format')}</li>
      </ul>`,
  },
  {
    title: 'MIT Cognitive Debt Study',
    label: 'okf-source',
    body: `
      <p><strong>Type:</strong> research paper (pre-print, June 2025) · <strong>Institution:</strong> ${link('MIT Media Lab')} · <strong>Lead author:</strong> ${link('Nataliya Kosmyna')}</p>
      <p>Study of 54 participants split into three essay-writing groups: LLM-assisted (ChatGPT only), search-engine-only, and brain-only. Participants received EEG scans and cognitive assessments at the start and after four months.</p>
      <p>Headline finding: LLM-assisted writing produced the weakest brain connectivity of the three groups — roughly 50% lower ${link('Neural Connectivity')} than writing unaided. The authors coin the term ${link('Cognitive Debt')} for the accumulated cost, driven by ${link('Cognitive Offloading')}.</p>
      <p>Notably, outcomes split by usage style: participants who used the LLM as a sounding board fared far better than those who delegated the work outright.</p>`,
  },
  {
    title: 'Forward Deployed Models Change Everything',
    label: 'okf-source',
    body: `
      <p><strong>Type:</strong> blog post · <strong>Blog:</strong> Driven to Develop (Dave O'Hara)</p>
      <p>Argues that each new frontier model release visibly resets enterprise AI spending and adoption curves, with day-one usage spikes observable in a 2,000-person consultancy. See ${link('Frontier Model Adoption')}.</p>
      <p>Connects adoption waves to the need for ${link('Agent-Readable Knowledge')}: teams that structure their internal knowledge for agents capture the gains of each model generation faster.</p>`,
  },
  {
    title: 'Cognitive Debt',
    label: 'okf-concept',
    body: `
      <p>The accumulated cognitive cost of delegating thinking to an AI system: skills and neural pathways that atrophy when work is outsourced rather than exercised. Coined in the ${link('MIT Cognitive Debt Study')}.</p>
      <p>Closely related to ${link('Cognitive Offloading')}; measured in the study via ${link('Neural Connectivity')}.</p>`,
  },
  {
    title: 'Cognitive Offloading',
    label: 'okf-concept',
    body: `
      <p>Using external tools to reduce the mental effort of a task. Healthy in moderation (calculators, notebooks), but the ${link('MIT Cognitive Debt Study')} suggests full delegation of composition to an LLM leads to ${link('Cognitive Debt')}.</p>
      <p>Mitigation: use the model as a collaborator that generates options, not a replacement that produces final output. See also ${link('Prompt Engineering Discipline')} — deliberately not ingested yet, so the health check reports an unresolved link.</p>`,
  },
  {
    title: 'Neural Connectivity',
    label: 'okf-concept',
    body: `
      <p>EEG-measured coupling between brain regions during a task; the primary outcome measure in the ${link('MIT Cognitive Debt Study')}. LLM-assisted writers showed the weakest coupling of the three study groups.</p>`,
  },
  {
    title: 'Graph RAG',
    label: 'okf-concept',
    body: `
      <p>Retrieval architecture that organizes knowledge as a graph of concepts, entities, and sources rather than flat chunks. The wiki pattern popularized by ${link('Andrej Karpathy')} and standardized by the ${link('Open Knowledge Format')} is a lightweight, file-based Graph RAG.</p>
      <p>Enables ${link('Agent-Readable Knowledge')}: agents discover context progressively by walking links instead of loading everything at once.</p>`,
  },
  {
    title: 'Frontier Model Adoption',
    label: 'okf-concept',
    body: `
      <p>The observable jump in enterprise AI usage and spending each time a new frontier model ships. Documented in ${link('Forward Deployed Models Change Everything')}.</p>`,
  },
  {
    title: 'Agent-Readable Knowledge',
    label: 'okf-concept',
    body: `
      <p>Knowledge structured primarily for AI agents to consume: concise summaries, typed metadata, and dense cross-links for progressive discovery. The organizing goal of this knowledge graph — see ${link('Graph RAG')} and the ${link('Open Knowledge Format')}.</p>`,
  },
  {
    title: 'MIT Media Lab',
    label: 'okf-entity',
    body: `
      <p>Research laboratory at the Massachusetts Institute of Technology; home institution of the ${link('MIT Cognitive Debt Study')}, led by ${link('Nataliya Kosmyna')}.</p>`,
  },
  {
    title: 'Nataliya Kosmyna',
    label: 'okf-entity',
    body: `
      <p>Research scientist at the ${link('MIT Media Lab')}; lead author of the ${link('MIT Cognitive Debt Study')}.</p>`,
  },
  {
    title: 'Andrej Karpathy',
    label: 'okf-entity',
    body: `
      <p>AI researcher whose public gist describing an LLM-maintained personal wiki popularized the pattern this knowledge graph follows. The structure was later standardized as the ${link('Open Knowledge Format')}.</p>`,
  },
  {
    title: 'Open Knowledge Format',
    label: 'okf-entity',
    body: `
      <p>A lightweight open standard for LLM-maintained wikis: markdown-style entries with typed metadata (title, timestamp, entry type, tags). This space uses its taxonomy via the labels <code>okf-concept</code>, <code>okf-entity</code>, and <code>okf-source</code>. See ${link('Graph RAG')}.</p>`,
  },
  {
    title: 'Scratch Notes',
    label: null,
    body: `
      <p>Unfiled notes from the last ingest session. Nothing links here and this page links nowhere — the health check should flag it as an orphan.</p>`,
  },
];

export async function seedDemoSpace(client, spaceKey) {
  const spaceId = await getSpaceId(client, spaceKey);
  if (!spaceId) {
    throw new Error(`Space ${spaceKey} not found.`);
  }

  const created = [];
  const skipped = [];
  for (const page of SEED_PAGES) {
    const existing = await findPageByTitle(client, spaceKey, page.title);
    if (existing) {
      skipped.push(page.title);
      continue;
    }
    const result = await createPage(client, spaceId, page.title, page.body.trim());
    if (page.label) {
      await addLabel(client, result.id, page.label);
    }
    created.push(page.title);
  }

  return { spaceKey, created, skipped };
}
