import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Inbox, Link2, LoaderCircle, Sparkles, X } from 'lucide-react';
import { useClipUrlToInbox, useQuickCaptureNote } from '../../hooks/notes.js';

function looksLikeBareUrl(value: string): boolean {
  const trimmed = value.trim();
  return /^https?:\/\/\S+$/i.test(trimmed);
}

export default function QuickCaptureModal({ onClose, onCreated }: { onClose: () => void; onCreated: (noteId: string) => void }) {
  const quickCapture = useQuickCaptureNote();
  const clipUrl = useClipUrlToInbox();
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [summarize, setSummarize] = useState(true);
  const isUrl = useMemo(() => looksLikeBareUrl(text), [text]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (isUrl) {
      const created = await clipUrl.mutateAsync({ url: trimmed, summarize });
      onCreated(created.id);
      onClose();
      return;
    }
    const created = await quickCapture.mutateAsync({ text: trimmed, title: title.trim() || undefined });
    onCreated(created.id);
    onClose();
  }

  const busy = quickCapture.isPending || clipUrl.isPending;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ duration: 0.18 }}
          className="w-full max-w-2xl overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-neutral-700 dark:bg-neutral-900"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="relative overflow-hidden border-b border-slate-200 px-5 py-4 dark:border-neutral-800">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[radial-gradient(circle_at_top_left,_rgba(20,184,166,0.18),_transparent_58%)]" />
            <div className="relative flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-white shadow-lg dark:bg-white dark:text-slate-950">
                  {isUrl ? <Link2 size={20} /> : <Inbox size={20} />}
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-neutral-500">Quick capture</p>
                  <h2 className="text-lg font-semibold text-slate-950 dark:text-white">{isUrl ? 'Clip this page into your inbox' : 'Catch the thought before it evaporates'}</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">{isUrl ? 'Paste a URL and the server will pull the readable article into Inbox/Web.' : 'Global capture for fleeting ideas, tasks, and scraps — lands as a standalone inbox note.'}</p>
                </div>
              </div>
              <button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200" aria-label="Close quick capture">
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="space-y-4 px-5 py-5">
            {!isUrl && (
              <label className="block text-sm text-slate-500 dark:text-neutral-400">
                Optional title
                <input
                  autoFocus
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Untitled until your text says otherwise"
                  className="mt-1.5 block w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none focus:border-teal-400 focus:bg-white dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                />
              </label>
            )}

            <label className="block text-sm text-slate-500 dark:text-neutral-400">
              {isUrl ? 'URL' : 'Capture'}
              <textarea
                autoFocus={isUrl}
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={isUrl ? 3 : 8}
                placeholder="Paste a thought, meeting note, quote, or a single URL…"
                className="mt-1.5 block w-full rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-800 outline-none focus:border-teal-400 focus:bg-white dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              />
            </label>

            {isUrl && (
              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300">
                <input type="checkbox" checked={summarize} onChange={(event) => setSummarize(event.target.checked)} className="mt-1 accent-teal-600" />
                <span>
                  <strong>Optional AI summary</strong>
                  <br />
                  Add a short practical summary at the top of the clipped note.
                </span>
              </label>
            )}

            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-xs text-slate-400 dark:text-neutral-500">
                <Sparkles size={14} />
                {isUrl ? 'Saved as an inbox web capture.' : 'Saved as a plain markdown file under your inbox.'}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800">Cancel</button>
                <button
                  onClick={() => void submit()}
                  disabled={busy || !text.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-teal-500/20 hover:bg-teal-500 disabled:opacity-50"
                >
                  {busy ? <LoaderCircle size={16} className="animate-spin" /> : isUrl ? <Link2 size={16} /> : <Inbox size={16} />}
                  {busy ? 'Saving…' : isUrl ? 'Clip to inbox' : 'Capture'}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
