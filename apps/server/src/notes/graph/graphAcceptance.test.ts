import { describe, expect, it } from 'vitest';
import { buildEraGraphFromNotes, type HistoricalNoteInput } from './timeTravel.js';

function thousandNoteVault(): HistoricalNoteInput[] {
  const notes: HistoricalNoteInput[] = [];
  for (let cluster = 0; cluster < 20; cluster++) {
    for (let index = 0; index < 50; index++) {
      const title = `Topic ${cluster} Note ${index}`;
      const previous = index > 0 ? `\n[[Topic ${cluster} Note ${index - 1}]]` : '';
      notes.push({
        id: `Topic-${cluster}/${title}.md`,
        content: `# ${title}\n#topic-${cluster}${previous}\n\nA focused note in topic ${cluster}.`,
        createdAt: new Date(Date.UTC(2025, 0, 1 + Math.floor(notes.length / 4))).toISOString(),
        updatedAt: new Date(Date.UTC(2025, 0, 2 + Math.floor(notes.length / 4))).toISOString(),
      });
    }
  }
  return notes;
}

describe('1,000-note graph acceptance guard', () => {
  it('builds a sparse, correctly labelled era graph within the server-side budget', () => {
    const started = performance.now();
    const graph = buildEraGraphFromNotes(thousandNoteVault(), '2026-03-31T23:59:59Z');
    const elapsed = performance.now() - started;

    expect(graph.nodes).toHaveLength(1_000);
    expect(graph.edges).toHaveLength(980);
    expect(elapsed).toBeLessThan(8_000);

    const correctlyLabelled = graph.nodes.filter((node) => node.communityLabel === `#${node.tags[0]}`).length;
    expect(correctlyLabelled / graph.nodes.length).toBeGreaterThanOrEqual(0.8);
  }, 12_000);
});
