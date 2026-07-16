export interface Chunk {
  index: number;
  durMin: number;
}

/**
 * Split a task's duration into sittings. Deterministic pure function of
 * (duration, settings). A task at or under maxChunkMin stays whole (exact
 * duration preserved, so unsplit tasks behave exactly as before). Longer tasks
 * are divided into k grid-aligned chunks, each within [minChunkMin, maxChunkMin]
 * up to granularity rounding, with the larger remainder chunks placed first.
 */
export function decompose(durationMin: number, granMin: number, maxChunkMin: number, minChunkMin: number, splitEnabled: boolean): Chunk[] {
  if (!splitEnabled || durationMin <= maxChunkMin) return [{ index: 0, durMin: durationMin }];

  const k = Math.max(1, Math.min(Math.ceil(durationMin / maxChunkMin), Math.floor(durationMin / minChunkMin)));
  if (k <= 1) return [{ index: 0, durMin: durationMin }];

  const units = Math.ceil(durationMin / granMin); // total granularity units (may round up < 1 unit)
  const base = Math.floor(units / k);
  const extra = units % k; // first `extra` chunks get one more unit
  const chunks: Chunk[] = [];
  for (let i = 0; i < k; i++) {
    const u = base + (i < extra ? 1 : 0);
    chunks.push({ index: i, durMin: u * granMin });
  }
  return chunks;
}
