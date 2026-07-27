import { describe, expect, it } from 'vitest';
import { decodeIntegrationNoteId, encodeIntegrationNoteId, notePathFromDeepLink } from './ids.js';
import { completeMarkdownTask, extractMarkdownTasks } from './tasks.js';
import { appendDailyReflection, ensureTodaysBlocksSection, syncDailyBlocks } from './dailyNotes.js';

describe('Second Brain integration', () => {
  it('round-trips nested and Arabic note paths through URL-safe ids', () => {
    const notePath = 'Projects/مشروع التخرج.md';
    const id = encodeIntegrationNoteId(notePath);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeIntegrationNoteId(id)).toBe(notePath);
    expect(notePathFromDeepLink(`https://brain.example/note/${id}`)).toBe(notePath);
  });

  it('extracts task metadata and completes exactly the addressed checkbox', () => {
    const content = [
      '# Sprint',
      '- [ ] Ship API #work @due(2026-08-01) #time-estimate(1.5h)',
      '- [x] Existing task',
    ].join('\n');
    const tasks = extractMarkdownTasks('Sprint.md', 'Sprint', ['project'], content);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ completed: false, due: '2026-08-01', estimateMinutes: 90, tags: ['project', 'work'] });
    const completed = completeMarkdownTask(content, tasks[0].id, 'Sprint.md', 'Sprint', ['project']);
    expect(completed).toContain('- [x] Ship API');
    expect(completed).toContain('- [x] Existing task');
  });

  it('keeps daily managed sections idempotent', () => {
    const block = {
      id: 'block-1',
      title: 'Deep work',
      startUtc: '2026-07-23T06:00:00.000Z',
      endUtc: '2026-07-23T07:00:00.000Z',
      status: 'done',
      url: 'https://time.example/plan/block-1',
    };
    const base = ensureTodaysBlocksSection('# 2026-07-23\n');
    const synced = syncDailyBlocks(base, [block], 'UTC');
    expect(syncDailyBlocks(synced, [block], 'UTC')).toBe(synced);
    const reflected = appendDailyReflection(synced, 'Good focus.', [block], 'UTC');
    expect(appendDailyReflection(reflected, 'Good focus.', [block], 'UTC')).toBe(reflected);
    expect(reflected).toContain('### Completed blocks');
  });
});
