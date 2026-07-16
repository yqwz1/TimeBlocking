import type { DesiredBlock } from './types.js';

export interface CurrentBlockLite {
  id: string;
  key: string; // same key scheme as DesiredBlock
  startUtc: string;
  endUtc: string;
}

export type BlockOp =
  | { type: 'create'; desired: DesiredBlock }
  | { type: 'move'; blockId: string; desired: DesiredBlock }
  | { type: 'delete'; blockId: string };

/**
 * Minimal set of calendar writes to get from `current` to `desired`.
 * A stable schedule produces zero ops — this is also the rate-limit guard.
 */
export function diffBlocks(current: CurrentBlockLite[], desired: DesiredBlock[]): BlockOp[] {
  const ops: BlockOp[] = [];
  const desiredByKey = new Map(desired.map((d) => [d.key, d]));
  const currentByKey = new Map<string, CurrentBlockLite>();

  for (const c of current) {
    if (currentByKey.has(c.key)) {
      ops.push({ type: 'delete', blockId: c.id }); // duplicate safety net
      continue;
    }
    currentByKey.set(c.key, c);
  }

  for (const [key, c] of currentByKey) {
    const d = desiredByKey.get(key);
    if (!d) ops.push({ type: 'delete', blockId: c.id });
    else if (d.startUtc !== c.startUtc || d.endUtc !== c.endUtc) ops.push({ type: 'move', blockId: c.id, desired: d });
  }

  for (const [key, d] of desiredByKey) {
    if (!currentByKey.has(key)) ops.push({ type: 'create', desired: d });
  }

  return ops;
}
