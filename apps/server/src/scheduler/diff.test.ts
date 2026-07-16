import { describe, expect, it } from 'vitest';
import { diffBlocks, type CurrentBlockLite } from './diff.js';
import type { DesiredBlock } from './types.js';

const cur = (id: string, key: string, start: string, end: string): CurrentBlockLite => ({
  id,
  key,
  startUtc: start,
  endUtc: end,
});
const des = (key: string, start: string, end: string): DesiredBlock => ({
  key,
  startUtc: start,
  endUtc: end,
  reasons: [],
});

describe('diffBlocks', () => {
  it('is a no-op when nothing changed', () => {
    const c = [cur('b1', 'task:t1:0', '2026-07-06T13:00:00Z', '2026-07-06T13:30:00Z')];
    const d = [des('task:t1:0', '2026-07-06T13:00:00Z', '2026-07-06T13:30:00Z')];
    expect(diffBlocks(c, d)).toEqual([]);
  });

  it('creates, moves and deletes as needed', () => {
    const c = [
      cur('b1', 'task:keep:0', '2026-07-06T13:00:00Z', '2026-07-06T13:30:00Z'),
      cur('b2', 'task:moved:0', '2026-07-06T14:00:00Z', '2026-07-06T14:30:00Z'),
      cur('b3', 'task:gone:0', '2026-07-06T15:00:00Z', '2026-07-06T15:30:00Z'),
    ];
    const d = [
      des('task:keep:0', '2026-07-06T13:00:00Z', '2026-07-06T13:30:00Z'),
      des('task:moved:0', '2026-07-06T16:00:00Z', '2026-07-06T16:30:00Z'),
      des('task:new:0', '2026-07-06T17:00:00Z', '2026-07-06T17:30:00Z'),
    ];
    const ops = diffBlocks(c, d);
    expect(ops).toContainEqual({ type: 'move', blockId: 'b2', desired: d[1] });
    expect(ops).toContainEqual({ type: 'delete', blockId: 'b3' });
    expect(ops).toContainEqual({ type: 'create', desired: d[2] });
    expect(ops).toHaveLength(3);
  });

  it('deletes duplicate blocks sharing a key', () => {
    const c = [
      cur('b1', 'task:t1:0', '2026-07-06T13:00:00Z', '2026-07-06T13:30:00Z'),
      cur('b2', 'task:t1:0', '2026-07-06T14:00:00Z', '2026-07-06T14:30:00Z'),
    ];
    const d = [des('task:t1:0', '2026-07-06T13:00:00Z', '2026-07-06T13:30:00Z')];
    expect(diffBlocks(c, d)).toEqual([{ type: 'delete', blockId: 'b2' }]);
  });
});
