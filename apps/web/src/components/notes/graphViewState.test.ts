import { describe, expect, it } from 'vitest';
import { decodeGraphView, encodeGraphView, type SerializableGraphView } from './graphViewState.js';

describe('shareable graph view state', () => {
  it('round-trips the full state, including Arabic tags and pinned positions', () => {
    const state: SerializableGraphView = {
      v: 1,
      folder: 'Projects/لعبة',
      tags: ['gamedev', 'عربي'],
      sizeBy: 'pagerank',
      colorBy: 'community',
      edges: { explicit: true, semantic: false, tag: true },
      concepts: true,
      camera: { x: 1, y: 2, ratio: 0.4, angle: 0 },
      eraAt: '2026-03-29T23:59:59.999Z',
      pinned: { 'Game/URP.md': { x: 4, y: 5 } },
    };
    expect(decodeGraphView(encodeGraphView(state))).toEqual(state);
  });

  it('fails closed for malformed URLs', () => {
    expect(decodeGraphView('not-json')).toBeNull();
  });
});
