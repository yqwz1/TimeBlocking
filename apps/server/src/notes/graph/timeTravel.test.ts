import { describe, expect, it } from 'vitest';
import { buildEraGraphFromNotes, timeTravelInternals } from './timeTravel.js';

describe('graph time travel', () => {
  it('rebuilds era links, centrality, and community labels from historical note content', () => {
    const graph = buildEraGraphFromNotes(
      [
        { id: 'Game/Shaders.md', content: '# Shaders\n#gamedev\n[[URP]]', createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-02T00:00:00Z' },
        { id: 'Game/URP.md', content: '# URP\n#gamedev\n[[Shaders]]', createdAt: '2026-03-02T00:00:00Z', updatedAt: '2026-03-03T00:00:00Z' },
        { id: 'University/Math.md', content: '# Math\n#university', createdAt: '2026-03-04T00:00:00Z', updatedAt: '2026-03-04T00:00:00Z' },
      ],
      '2026-03-31T23:59:59Z',
    );
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toEqual([{ source: 'Game/Shaders.md', target: 'Game/URP.md', weight: 2, type: 'explicit' }]);
    expect(graph.nodes.find((node) => node.id === 'Game/Shaders.md')?.communityLabel).toBe('#gamedev');
    expect(graph.era?.communityLabels).toContain('#gamedev');
  });

  it('parses snapshot filenames and normalizes weeks to Monday UTC', () => {
    expect(timeTravelInternals.parseSnapshotTimestamp('2026-03-17T11-22-33-444Z.md')).toBe('2026-03-17T11:22:33.444Z');
    expect(timeTravelInternals.weekStartIso('2026-03-19T12:00:00Z')).toBe('2026-03-16T00:00:00.000Z');
  });
});
