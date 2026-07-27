import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import type { StudyCardDTO, StudyReviewResultDTO, StudyReviewInput } from '@timeblock/shared';
import { and, eq, lte } from 'drizzle-orm';
import { notes, studyCards } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { readNoteFile } from './vault.js';

type StudyRow = typeof studyCards.$inferSelect;

interface ExtractedCard {
  id: string;
  kind: 'qa';
  prompt: string;
  answer: string;
}

function cardId(noteId: string, prompt: string, answer: string): string {
  return createHash('sha256').update(`${noteId}\n${prompt}\n${answer}`).digest('base64url').slice(0, 32);
}

export function extractFlashcards(noteId: string, content: string): ExtractedCard[] {
  const out: ExtractedCard[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const q = /^\s*Q::\s*(.+?)\s*$/.exec(lines[index]);
    if (!q) continue;
    const a = /^\s*A::\s*(.+?)\s*$/.exec(lines[index + 1] ?? '');
    if (!a) continue;
    const prompt = q[1].trim();
    const answer = a[1].trim();
    if (!prompt || !answer) continue;
    out.push({ id: cardId(noteId, prompt, answer), kind: 'qa', prompt, answer });
    index += 1;
  }
  return out;
}

function toCardDTO(row: StudyRow, noteTitle: string): StudyCardDTO {
  return {
    id: row.id,
    noteId: row.noteId,
    noteTitle,
    kind: row.kind as 'qa',
    prompt: row.prompt,
    answer: row.answer,
    dueDate: row.dueDate,
    easeFactor: row.easeFactor,
    intervalDays: row.intervalDays,
    repetitions: row.repetitions,
    lastReviewedAt: row.lastReviewedAtUtc,
  };
}

export async function syncStudyCardsForNote(db: DB, root: string, noteId: string, timezone: string): Promise<void> {
  const row = db.select().from(notes).where(eq(notes.id, noteId)).get();
  if (!row) {
    db.delete(studyCards).where(eq(studyCards.noteId, noteId)).run();
    return;
  }
  const file = await readNoteFile(root, noteId);
  const cards = extractFlashcards(noteId, file?.content ?? '');
  const today = DateTime.now().setZone(timezone).toISODate()!;
  const existing = new Map(db.select().from(studyCards).where(eq(studyCards.noteId, noteId)).all().map((card) => [card.id, card]));
  const nextIds = new Set(cards.map((card) => card.id));
  const now = new Date().toISOString();

  db.transaction((tx) => {
    for (const card of cards) {
      const prev = existing.get(card.id);
      tx.insert(studyCards)
        .values({
          id: card.id,
          noteId,
          kind: card.kind,
          prompt: card.prompt,
          answer: card.answer,
          dueDate: prev?.dueDate ?? today,
          easeFactor: prev?.easeFactor ?? 2.5,
          intervalDays: prev?.intervalDays ?? 0,
          repetitions: prev?.repetitions ?? 0,
          lastReviewedAtUtc: prev?.lastReviewedAtUtc ?? null,
          createdAtUtc: prev?.createdAtUtc ?? now,
          updatedAtUtc: now,
        })
        .onConflictDoUpdate({
          target: studyCards.id,
          set: {
            prompt: card.prompt,
            answer: card.answer,
            updatedAtUtc: now,
          },
        })
        .run();
    }
    for (const stale of existing.values()) {
      if (!nextIds.has(stale.id)) tx.delete(studyCards).where(and(eq(studyCards.id, stale.id), eq(studyCards.noteId, noteId))).run();
    }
  });
}

export async function syncAllStudyCards(db: DB, root: string, timezone: string): Promise<void> {
  for (const row of db.select({ id: notes.id }).from(notes).all()) await syncStudyCardsForNote(db, root, row.id, timezone);
}

export async function dueStudyCards(db: DB, root: string, timezone: string): Promise<StudyCardDTO[]> {
  await syncAllStudyCards(db, root, timezone);
  const today = DateTime.now().setZone(timezone).toISODate()!;
  const titleById = new Map(db.select({ id: notes.id, title: notes.title }).from(notes).all().map((row) => [row.id, row.title]));
  return db
    .select()
    .from(studyCards)
    .where(lte(studyCards.dueDate, today))
    .all()
    .map((row) => toCardDTO(row, titleById.get(row.noteId) ?? row.noteId))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.noteTitle.localeCompare(b.noteTitle));
}

function reviewQuality(rating: StudyReviewInput['rating']): number {
  if (rating === 'again') return 0;
  if (rating === 'hard') return 3;
  if (rating === 'good') return 4;
  return 5;
}

export function reviewStudyCard(db: DB, cardIdValue: string, rating: StudyReviewInput['rating'], timezone: string): StudyReviewResultDTO | null {
  const row = db.select().from(studyCards).where(eq(studyCards.id, cardIdValue)).get();
  if (!row) return null;
  const q = reviewQuality(rating);
  let repetitions = row.repetitions;
  let intervalDays = row.intervalDays;
  let easeFactor = row.easeFactor;

  if (q < 3) {
    repetitions = 0;
    intervalDays = 0;
  } else {
    if (repetitions === 0) intervalDays = 1;
    else if (repetitions === 1) intervalDays = 6;
    else intervalDays = Math.max(1, Math.round(intervalDays * (rating === 'hard' ? 1.2 : rating === 'easy' ? easeFactor + 0.15 : easeFactor)));
    repetitions += 1;
    easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  }

  const zoneNow = DateTime.now().setZone(timezone);
  const dueDate = zoneNow.plus({ days: intervalDays }).toISODate()!;
  const reviewedAt = zoneNow.toUTC().toISO()!;
  db.update(studyCards)
    .set({ repetitions, intervalDays, easeFactor, dueDate, lastReviewedAtUtc: reviewedAt, updatedAtUtc: reviewedAt })
    .where(eq(studyCards.id, row.id))
    .run();

  const noteTitle = db.select({ title: notes.title }).from(notes).where(eq(notes.id, row.noteId)).get()?.title ?? row.noteId;
  return {
    card: toCardDTO(
      {
        ...row,
        repetitions,
        intervalDays,
        easeFactor,
        dueDate,
        lastReviewedAtUtc: reviewedAt,
        updatedAtUtc: reviewedAt,
      },
      noteTitle,
    ),
    nextDueDate: dueDate,
  };
}
