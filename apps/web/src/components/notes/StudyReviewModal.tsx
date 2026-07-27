import { useEffect, useMemo, useState } from 'react';
import { actionToasts } from '../../lib/actionToast.js';
import { useReviewStudyCard, useScheduleStudyReviewBlock, useStudyQueue } from '../../hooks/notes.js';

export default function StudyReviewModal({
  onClose,
  onOpenNote,
}: {
  onClose: () => void;
  onOpenNote: (id: string) => void;
}) {
  const queue = useStudyQueue();
  const review = useReviewStudyCard();
  const scheduleBlock = useScheduleStudyReviewBlock();
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const cards = queue.data?.dueCards ?? [];
  const card = cards[index] ?? null;

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(0, cards.length - 1)));
  }, [cards.length]);

  useEffect(() => {
    setRevealed(false);
  }, [card?.id]);

  const progress = useMemo(() => (cards.length ? `${index + 1} / ${cards.length}` : '0 / 0'), [cards.length, index]);

  function grade(rating: 'again' | 'hard' | 'good' | 'easy') {
    if (!card) return;
    review.mutate(
      { cardId: card.id, rating },
      {
        onSuccess: () => {
          queue.refetch();
          setIndex(0);
        },
      },
    );
  }

  function createReviewBlock() {
    scheduleBlock.mutate(
      { noteId: card?.noteId },
      {
        onSuccess: (result) => actionToasts.show(`Created "${result.content}" in the time-blocking task list.`, () => {}, 'OK'),
        onError: () => actionToasts.show("Couldn't create the review block right now.", () => {}, 'OK'),
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-4 py-10" onClick={onClose}>
      <div className="flex h-[min(82vh,760px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900" onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-slate-200 px-5 py-4 dark:border-neutral-800">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Phase 7</p>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Daily Review Queue</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">Due today: {queue.data?.dueToday ?? 0} cards</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={createReviewBlock} className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-950">
                Schedule 15-min review
              </button>
              <button onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-950">
                Close
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {queue.isLoading && <p className="text-sm text-slate-400 dark:text-neutral-500">Loading flashcards…</p>}
          {!queue.isLoading && !card && <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400 dark:border-neutral-700 dark:text-neutral-500">No cards are due right now. Add `Q::` / `A::` pairs to your notes and they’ll appear here.</p>}
          {card && (
            <div className="mx-auto max-w-2xl">
              <div className="mb-4 flex items-center justify-between gap-3 text-sm text-slate-400 dark:text-neutral-500">
                <span>{progress}</span>
                <button onClick={() => onOpenNote(card.noteId)} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-950">
                  {card.noteTitle}
                </button>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 dark:border-neutral-800 dark:bg-neutral-950/60">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Prompt</p>
                <p dir="auto" className="mt-3 text-xl leading-relaxed text-slate-900 dark:text-neutral-100">{card.prompt}</p>
                <div className="mt-6 border-t border-slate-200 pt-5 dark:border-neutral-800">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Answer</p>
                    <button onClick={() => setRevealed((value) => !value)} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-white dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900">
                      {revealed ? 'Hide' : 'Reveal'}
                    </button>
                  </div>
                  <p dir="auto" className={`mt-3 text-base leading-relaxed transition ${revealed ? 'text-slate-700 dark:text-neutral-200' : 'select-none text-transparent [text-shadow:0_0_12px_rgba(100,116,139,0.55)] dark:[text-shadow:0_0_12px_rgba(148,163,184,0.45)]'}`}>
                    {card.answer}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-4">
                {([
                  ['again', 'Again'],
                  ['hard', 'Hard'],
                  ['good', 'Good'],
                  ['easy', 'Easy'],
                ] as const).map(([rating, label]) => (
                  <button
                    key={rating}
                    onClick={() => grade(rating)}
                    disabled={review.isPending}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200 dark:hover:bg-neutral-900"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
