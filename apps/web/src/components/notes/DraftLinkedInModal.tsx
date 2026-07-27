import { useState } from 'react';
import { useDraftLinkedInPost } from '../../hooks/notes.js';

export default function DraftLinkedInModal({
  noteId,
  onClose,
  onCreated,
}: {
  noteId: string;
  onClose: () => void;
  onCreated: (noteId: string) => void;
}) {
  const draft = useDraftLinkedInPost();
  const [language, setLanguage] = useState<'ar' | 'en'>('en');

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-4 py-16" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900" onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-slate-200 px-5 py-4 dark:border-neutral-800">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Phase 8</p>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Draft LinkedIn Post</h3>
            </div>
            <button onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-950">
              Close
            </button>
          </div>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-sm text-slate-500 dark:text-neutral-400">The draft will be saved as a new note under your content drafts folder. Nothing is posted automatically.</p>
          <div className="grid grid-cols-2 gap-3">
            {([
              ['en', 'English'],
              ['ar', 'Arabic'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setLanguage(value)}
                className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                  language === value
                    ? 'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-700 dark:bg-teal-500/10 dark:text-teal-300'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-950'
                }`}
              >
                <span className="block font-medium">{label}</span>
                <span className="mt-1 block text-xs opacity-75">Generate this run in {label.toLowerCase()}.</span>
              </button>
            ))}
          </div>
          {draft.error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-500/10 dark:text-rose-300">{draft.error instanceof Error ? draft.error.message : 'The draft could not be generated.'}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-950">
              Cancel
            </button>
            <button
              onClick={() =>
                draft.mutate(
                  { id: noteId, language },
                  {
                    onSuccess: (created) => {
                      onCreated(created.id);
                      onClose();
                    },
                  },
                )
              }
              disabled={draft.isPending}
              className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {draft.isPending ? 'Drafting…' : `Create ${language === 'ar' ? 'Arabic' : 'English'} draft`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
