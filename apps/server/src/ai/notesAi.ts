import { Type } from '@google/genai';
import { getGenAIClient } from './client.js';

export interface ChatContextChunk {
  noteId: string;
  title: string;
  text: string;
}

export interface ChatResult {
  answer: string;
  citedNoteIds: string[];
}

export interface CommunityContext {
  label: string;
  summary: string;
  memberTitles: string[];
}

/**
 * Graph-aware Vault Chat (G4 / GraphRAG). `scope: 'local'` answers a specific question from the retrieved
 * note excerpts (which already include the seeds' 1-hop graph neighbourhood). `scope: 'global'` answers a
 * "what are the themes / what am I neglecting" question primarily from the community summaries. Both cite notes.
 */
export async function answerGraphChat(
  model: string,
  aboutMe: string,
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  scope: 'local' | 'global',
  context: ChatContextChunk[],
  communities: CommunityContext[] = [],
): Promise<ChatResult> {
  const client = getGenAIClient();
  const contextBlock = context.length
    ? context.map((c, i) => `[${i + 1}] Note: "${c.title}" (id: ${c.noteId})\n${c.text}`).join('\n\n')
    : '(no matching notes were found in the vault)';
  const communityBlock = communities.length
    ? communities
        .map((c, i) => `(${i + 1}) Cluster "${c.label}": ${c.summary || '(no summary yet)'}\n    Notes: ${c.memberTitles.slice(0, 12).join(', ')}`)
        .join('\n')
    : '';
  const historyBlock = history.length ? history.map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n') : '';

  const intro =
    scope === 'global'
      ? [
          `You are a helpful assistant giving the user a high-level view of their personal notes vault ("Second Brain"). About the user: ${aboutMe}`,
          "The vault has been clustered into thematic communities. Answer the user's big-picture question using the community summaries below as your primary source, grounding specifics in the note excerpts where given.",
          'Be concrete — name the actual clusters and notes, not generic filler. If the summaries do not cover something, say so.',
        ]
      : [
          `You are a helpful assistant answering questions from the user's personal notes vault ("Second Brain"). About the user: ${aboutMe}`,
          'Answer ONLY using the note excerpts below (they include notes directly related to the topic and their close neighbours). If they do not contain the answer, say so plainly instead of guessing.',
        ];

  const prompt = [
    ...intro,
    'List the ids of every note you actually drew on in citedNoteIds — omit notes you did not use, and never invent an id that is not shown below.',
    communityBlock ? `\nVault clusters:\n${communityBlock}` : '',
    '',
    'Note excerpts:',
    contextBlock,
    historyBlock ? `\nConversation so far:\n${historyBlock}` : '',
    `\nUser question: ${message}`,
  ].join('\n');

  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          answer: { type: Type.STRING },
          citedNoteIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['answer', 'citedNoteIds'],
      },
    },
  });
  const parsed = JSON.parse(response.text ?? '{}') as { answer?: string; citedNoteIds?: string[] };
  return { answer: parsed.answer ?? '', citedNoteIds: parsed.citedNoteIds ?? [] };
}

export interface GraphQueryFacets {
  tags: string[];
  folders: string[];
  communityLabels: string[];
  edgeTypes: string[];
}

export interface CompiledGraphQuery {
  tags: string[];
  folders: string[];
  communityLabels: string[];
  edgeTypes: string[];
  untouchedMinDays: number | null;
  minPagerank: number | null;
  minDegree: number | null;
  minBetweenness: number | null;
  hasOpenTasks: boolean;
  text: string | null;
  interpretation: string;
}

/**
 * G6 §5 — compiles a natural-language ask ("shaders I haven't touched in 3 months") into concrete graph
 * filters, choosing from the vault's real tags / folders / community labels. The caller clamps anything the
 * model invents back to those facets, so a hallucinated tag simply drops out.
 */
export async function compileGraphQuery(model: string, message: string, facets: GraphQueryFacets): Promise<CompiledGraphQuery> {
  const client = getGenAIClient();
  const prompt = [
    'Translate the user\'s request into graph filters for their notes graph. Use ONLY values from these lists (exact strings); leave a field empty if the request does not constrain it.',
    `Tags: ${facets.tags.join(', ') || '(none)'}`,
    `Folders: ${facets.folders.join(', ') || '(none)'}`,
    `Community labels: ${facets.communityLabels.join(', ') || '(none)'}`,
    `Edge types: ${facets.edgeTypes.join(', ')}`,
    'untouchedMinDays = keep only notes untouched for at least N days (e.g. "3 months" → 90). hasOpenTasks = the request is about unfinished/open tasks. text = a free-text keyword to match if no tag/folder fits. Also give a short "interpretation" echoing what you understood in plain words.',
    '',
    `Request: ${message}`,
  ].join('\n');
  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          tags: { type: Type.ARRAY, items: { type: Type.STRING } },
          folders: { type: Type.ARRAY, items: { type: Type.STRING } },
          communityLabels: { type: Type.ARRAY, items: { type: Type.STRING } },
          edgeTypes: { type: Type.ARRAY, items: { type: Type.STRING } },
          untouchedMinDays: { type: Type.NUMBER, nullable: true },
          minPagerank: { type: Type.NUMBER, nullable: true },
          minDegree: { type: Type.NUMBER, nullable: true },
          minBetweenness: { type: Type.NUMBER, nullable: true },
          hasOpenTasks: { type: Type.BOOLEAN },
          text: { type: Type.STRING, nullable: true },
          interpretation: { type: Type.STRING },
        },
        required: ['tags', 'folders', 'communityLabels', 'edgeTypes', 'hasOpenTasks', 'interpretation'],
      },
    },
  });
  const p = JSON.parse(response.text ?? '{}') as Partial<CompiledGraphQuery>;
  return {
    tags: p.tags ?? [],
    folders: p.folders ?? [],
    communityLabels: p.communityLabels ?? [],
    edgeTypes: p.edgeTypes ?? [],
    untouchedMinDays: p.untouchedMinDays ?? null,
    minPagerank: p.minPagerank ?? null,
    minDegree: p.minDegree ?? null,
    minBetweenness: p.minBetweenness ?? null,
    hasOpenTasks: p.hasOpenTasks ?? false,
    text: p.text ?? null,
    interpretation: p.interpretation ?? '',
  };
}

/** G6 §6 — one-line narration of a connection path ("A links to B, which shares the ECS concept with C"). */
export async function narratePath(model: string, steps: { title: string; kind: 'note' | 'concept'; viaType: string | null }[]): Promise<string> {
  const client = getGenAIClient();
  const chain = steps
    .map((s, i) => (i === 0 ? `"${s.title}"` : `—[${s.viaType}]→ ${s.kind === 'concept' ? `concept "${s.title}"` : `"${s.title}"`}`))
    .join(' ');
  const prompt = [
    'Narrate this path between two notes in one natural sentence, explaining how each step connects to the next (explicit = a wikilink, concept = a shared extracted concept, semantic = similar meaning, tag = shared tags).',
    chain,
  ].join('\n');
  const response = await client.models.generateContent({ model, contents: prompt });
  return (response.text ?? '').trim();
}

/** Names + summarises a detected community (G4) from its member note titles. Cached upstream by community id. */
export async function nameCommunity(model: string, memberTitles: string[]): Promise<{ label: string; summary: string }> {
  const client = getGenAIClient();
  const prompt = [
    'These note titles belong to one cluster in a personal knowledge vault (topics may be in Arabic or English):',
    memberTitles.map((t) => `- ${t}`).join('\n') || '(untitled notes)',
    '',
    'Give this cluster a short label (1–4 words naming the shared theme) and a one-sentence summary of what ties these notes together. Be specific to the actual titles, not generic.',
  ].join('\n');
  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          summary: { type: Type.STRING },
        },
        required: ['label', 'summary'],
      },
    },
  });
  const parsed = JSON.parse(response.text ?? '{}') as { label?: string; summary?: string };
  return { label: (parsed.label ?? '').trim(), summary: (parsed.summary ?? '').trim() };
}

/** Never auto-applied — the caller shows these as accept/reject chips. */
export async function suggestLinksAndTags(
  model: string,
  noteTitle: string,
  noteBody: string,
  existingTitles: string[],
): Promise<{ links: string[]; tags: string[] }> {
  const client = getGenAIClient();
  const prompt = [
    `You are helping organize a personal notes vault. The current note is titled "${noteTitle}":`,
    '---',
    noteBody.slice(0, 6000),
    '---',
    'Other note titles already in the vault (suggest links to these when genuinely relevant; you may also propose a new title worth linking to even if it does not exist yet):',
    existingTitles.filter((t) => t !== noteTitle).slice(0, 300).join(', ') || '(none yet)',
    '',
    'Suggest up to 6 [[wikilink]] targets and up to 6 #tags for this note. Only suggest links/tags that are genuinely relevant — quality over quantity.',
  ].join('\n');

  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          links: { type: Type.ARRAY, items: { type: Type.STRING } },
          tags: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['links', 'tags'],
      },
    },
  });
  const parsed = JSON.parse(response.text ?? '{}') as { links?: string[]; tags?: string[] };
  return { links: parsed.links ?? [], tags: parsed.tags ?? [] };
}

export interface DigestSourceNote {
  id: string;
  title: string;
  excerpt: string;
  openTasks: string[];
}

/** Markdown body (no frontmatter) for a weekly digest note — themes, open tasks, and a touched-notes list. */
export async function generateWeeklyDigest(model: string, aboutMe: string, weekLabel: string, sourceNotes: DigestSourceNote[]): Promise<string> {
  const client = getGenAIClient();
  const notesBlock = sourceNotes
    .map((n) => `### ${n.title} (id: ${n.id})\n${n.excerpt}${n.openTasks.length ? `\nOpen tasks: ${n.openTasks.join('; ')}` : ''}`)
    .join('\n\n');
  const prompt = [
    `You are writing a weekly digest note for ${weekLabel} from the user's personal notes vault. About the user: ${aboutMe}`,
    'Write a markdown note (use "## " headings) with three sections: "Themes" (what they were thinking about/working on this week), "Open tasks" (bulleted, pulled from below, each with a [[wikilink]] back to its source note), and "Notes touched this week" (a bulleted list of [[wikilinks]] to each note title below).',
    'Be concise and specific — reference actual content, not generic filler.',
    '',
    "This week's notes:",
    notesBlock || '(no notes were touched this week)',
  ].join('\n');
  const response = await client.models.generateContent({ model, contents: prompt });
  return (response.text ?? '').trim();
}
