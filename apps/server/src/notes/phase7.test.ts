import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { notes, studyCards } from '../db/schema.js';
import { parseNoteQuery } from './queryBlocks.js';
import { extractFlashcards, reviewStudyCard } from './study.js';

describe('Phase 7 notes utilities', () => {
  it('parses the compact query-block syntax', () => {
    const parsed = parseNoteQuery('tag:gamedev folder:University task:open text:"shader graph" created:2026-07-01..2026-07-24 sort:modified');
    expect(parsed).toMatchObject({
      tags: ['gamedev'],
      folders: ['University'],
      task: 'open',
      text: 'shader graph',
      createdFrom: '2026-07-01',
      createdTo: '2026-07-24',
      sort: 'modified',
    });
  });

  it('extracts Q:: / A:: flashcards as adjacent pairs only', () => {
    const cards = extractFlashcards(
      'Study/Graphics.md',
      ['# Graphics', 'Q:: What is a normal map?', 'A:: A texture encoding surface normals.', '', 'Q:: Missing answer'].join('\n'),
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      kind: 'qa',
      prompt: 'What is a normal map?',
      answer: 'A texture encoding surface normals.',
    });
  });

  it('applies SM-2 progression when reviewing a study card', () => {
    const db = createDb(':memory:');
    db.insert(notes)
      .values({
        id: 'Study/Math.md',
        title: 'Math',
        tags: '[]',
        frontmatter: '{}',
        contentHash: 'hash',
        createdAtUtc: '2026-07-20T00:00:00Z',
        updatedAtUtc: '2026-07-20T00:00:00Z',
      })
      .run();
    db.insert(studyCards)
      .values({
        id: 'card-1',
        noteId: 'Study/Math.md',
        kind: 'qa',
        prompt: 'Derivative of x^2?',
        answer: '2x',
        dueDate: DateTime.now().setZone('UTC').toISODate()!,
        easeFactor: 2.5,
        intervalDays: 0,
        repetitions: 0,
        createdAtUtc: '2026-07-20T00:00:00Z',
        updatedAtUtc: '2026-07-20T00:00:00Z',
      })
      .run();

    const result = reviewStudyCard(db, 'card-1', 'good', 'UTC');
    expect(result).not.toBeNull();
    expect(result?.card.repetitions).toBe(1);
    expect(result?.card.intervalDays).toBe(1);
    expect(result?.nextDueDate).toBe(DateTime.now().setZone('UTC').plus({ days: 1 }).toISODate());
  });
});
