import { Type } from '@google/genai';
import type { ConceptType } from '@timeblock/shared';
import { getGenAIClient } from '../../ai/client.js';

export interface ExtractedConcept {
  name: string;
  type: ConceptType;
}

const VALID_TYPES: ConceptType[] = ['person', 'project', 'technology', 'idea'];

/**
 * Extracts the salient entities/concepts from one note via Gemini. `existingNames` are fed back so the
 * model reuses canonical names verbatim (the first line of dedup) rather than minting near-duplicates.
 * Throws on API/offline error — the caller decides whether to skip the note or retry later.
 */
export async function extractConcepts(model: string, noteTitle: string, noteBody: string, existingNames: string[]): Promise<ExtractedConcept[]> {
  const body = noteBody.trim();
  if (!body) return [];
  const client = getGenAIClient();
  const prompt = [
    `Extract the key entities and concepts from the note titled "${noteTitle}".`,
    'Categories: "person" (named people), "project" (named efforts/products), "technology" (tools, languages, frameworks, libraries), "idea" (recurring topics/themes/concepts).',
    'Only substantial, reusable concepts — skip generic filler words, dates, and one-off phrases. Prefer 3–12 concepts.',
    existingNames.length
      ? `Reuse these EXACT existing concept names when the same entity appears (do not invent near-duplicates): ${existingNames.slice(0, 250).join(', ')}`
      : '',
    '',
    'Note content:',
    body.slice(0, 6000),
  ].join('\n');

  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          concepts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                type: { type: Type.STRING, enum: VALID_TYPES },
              },
              required: ['name', 'type'],
            },
          },
        },
        required: ['concepts'],
      },
    },
  });

  let parsed: unknown;
  try {
    parsed = (JSON.parse(response.text ?? '{}') as { concepts?: unknown }).concepts;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: ExtractedConcept[] = [];
  for (const item of parsed) {
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    const type = item?.type as ConceptType;
    if (!name || name.length > 80 || !VALID_TYPES.includes(type)) continue;
    const key = `${type}|${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, type });
  }
  return out;
}
