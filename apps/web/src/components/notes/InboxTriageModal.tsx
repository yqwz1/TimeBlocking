import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, CheckCheck, LoaderCircle, Sparkles, Wand2, X } from 'lucide-react';
import type { InboxNoteDTO } from '@timeblock/shared';
import { useApplyInboxTriage, useInboxTriageSuggestion, useNote } from '../../hooks/notes.js';

function splitComma(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

export default function InboxTriageModal({
  notes,
  onClose,
  onApplied,
}: {
  notes: InboxNoteDTO[];
  onClose: () => void;
  onApplied: (noteId: string) => void;
}) {
  const pending = useMemo(() => notes.filter((note) => !note.processed), [notes]);
  const [index, setIndex] = useState(0);
  const current = pending[index] ?? null;
  const note = useNote(current?.id ?? null);
  const suggest = useInboxTriageSuggestion();
  const apply = useApplyInboxTriage();
  const [title, setTitle] = useState('');
  const [destinationFolder, setDestinationFolder] = useState('');
  const [tags, setTags] = useState('');
  const [links, setLinks] = useState('');
  const [summary, setSummary] = useState('');

  useEffect(() => {
    if (!current) return;
    setTitle(current.title);
    setDestinationFolder('Projects');
    setTags(current.tags.join(', '));
    setLinks('');
    setSummary('');
  }, [current?.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function askAi() {
    if (!current) return;
    const next = await suggest.mutateAsync(current.id);
    setTitle(next.suggestedTitle);
    setDestinationFolder(next.destinationFolder);
    setTags(next.tags.join(', '));
    setLinks(next.links.join(', '));
    setSummary(next.summary);
  }

  async function applyCurrent() {
    if (!current) return;
    const saved = await apply.mutateAsync({
      id: current.id,
      title: title.trim() || current.title,
      destinationFolder: destinationFolder.trim() || 'Inbox',
      tags: splitComma(tags),
      links: splitComma(links),
    });
    onApplied(saved.id);
    if (index >= pending.length - 1) onClose();
    else setIndex((value) => Math.min(value + 1, pending.length - 1));
  }

  if (!current) {
    return (
      <AnimatePresence>
        <div className="fixed inset-0 z-[86] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg rounded-[1.4rem] border border-slate-200 bg-white p-6 text-center shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
            <CheckCheck className="mx-auto mb-3 text-emerald-500" size={28} />
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Inbox is clear</h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">Nothing is waiting to be processed right now.</p>
            <button onClick={onClose} className="mt-5 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">Done</button>
          </motion.div>
        </div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[86] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          className="w-full max-w-4xl overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-neutral-700 dark:bg-neutral-900"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="border-b border-slate-200 px-5 py-4 dark:border-neutral-800">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-neutral-500">Inbox triage</p>
                <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Process captures one by one</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
                  {index + 1} of {pending.length} unprocessed inbox notes
                </p>
              </div>
              <button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200">
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="grid gap-0 md:grid-cols-[1.1fr_0.9fr]">
            <div className="border-b border-slate-200 p-5 md:border-b-0 md:border-r dark:border-neutral-800">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-neutral-100">{current.title}</p>
                  <p className="text-xs text-slate-400 dark:text-neutral-500">{current.id}</p>
                </div>
                <button
                  onClick={() => void askAi()}
                  disabled={suggest.isPending}
                  className="inline-flex items-center gap-2 rounded-xl border border-teal-200 px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:border-teal-900 dark:text-teal-300 dark:hover:bg-teal-500/10"
                >
                  {suggest.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Wand2 size={15} />}
                  Suggest
                </button>
              </div>
              {summary && (
                <div className="mb-3 rounded-2xl border border-teal-100 bg-teal-50/70 px-4 py-3 text-sm text-teal-900 dark:border-teal-900/50 dark:bg-teal-500/10 dark:text-teal-100">
                  <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">
                    <Sparkles size={13} /> AI read
                  </div>
                  {summary}
                </div>
              )}
              <div className="max-h-[55vh] overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300">
                <pre className="whitespace-pre-wrap font-sans">{note.data?.content ?? 'Loading…'}</pre>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <label className="block text-sm text-slate-500 dark:text-neutral-400">
                Better title
                <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1.5 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none focus:border-teal-400 focus:bg-white dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
              </label>
              <label className="block text-sm text-slate-500 dark:text-neutral-400">
                Destination folder
                <input value={destinationFolder} onChange={(event) => setDestinationFolder(event.target.value)} className="mt-1.5 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none focus:border-teal-400 focus:bg-white dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
              </label>
              <label className="block text-sm text-slate-500 dark:text-neutral-400">
                Tags
                <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="gamedev, idea, reading" className="mt-1.5 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none focus:border-teal-400 focus:bg-white dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
              </label>
              <label className="block text-sm text-slate-500 dark:text-neutral-400">
                Related links
                <input value={links} onChange={(event) => setLinks(event.target.value)} placeholder="Existing Note, Another Note" className="mt-1.5 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none focus:border-teal-400 focus:bg-white dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
              </label>
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => setIndex((value) => Math.min(value + 1, pending.length - 1))}
                  disabled={index >= pending.length - 1}
                  className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  Skip for now
                </button>
                <button
                  onClick={() => void applyCurrent()}
                  disabled={apply.isPending}
                  className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-teal-500/20 hover:bg-teal-500 disabled:opacity-50"
                >
                  {apply.isPending ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                  Apply & next
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
