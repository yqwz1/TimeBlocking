import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CornerDownLeft, Inbox, Link2, LoaderCircle, Play, Sparkles, Video, X } from 'lucide-react';
import { getYouTubeThumbnailUrl, getYouTubeVideoId } from '@timeblock/shared';
import { useCaptureYouTubeNote, useClipUrlToInbox, useQuickCaptureNote } from '../../hooks/notes.js';

function looksLikeBareUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

export default function QuickCaptureModal({ onClose, onCreated }: { onClose: () => void; onCreated: (noteId: string, options?: { readingView?: boolean }) => void }) {
  const quickCapture = useQuickCaptureNote();
  const clipUrl = useClipUrlToInbox();
  const captureYouTube = useCaptureYouTubeNote();
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [summarize, setSummarize] = useState(true);
  const isUrl = useMemo(() => looksLikeBareUrl(text), [text]);
  const youtubeId = useMemo(() => getYouTubeVideoId(text), [text]);
  const isYouTube = youtubeId !== null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    if (youtubeId) {
      const created = await captureYouTube.mutateAsync({ url: trimmed, title: title.trim() || undefined });
      onCreated(created.id, { readingView: true });
      onClose();
      return;
    }
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

  const busy = quickCapture.isPending || clipUrl.isPending || captureYouTube.isPending;
  const icon = isYouTube ? <Video size={16} /> : isUrl ? <Link2 size={16} /> : <Inbox size={16} />;
  const destination = isYouTube ? 'Inbox / Videos' : isUrl ? 'Inbox / Web' : 'Inbox';

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.985 }}
          transition={{ duration: 0.16 }}
          className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-neutral-800 dark:bg-neutral-900"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-neutral-800">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">
                {icon}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Quick capture</h2>
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500 dark:bg-white/[0.06] dark:text-neutral-400">{destination}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-neutral-400">
                  {isYouTube ? 'A playable video note with room for your thoughts.' : isUrl ? 'Save a readable copy of this link.' : 'Get the thought out of your head.'}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[0.06] dark:hover:text-neutral-200" aria-label="Close quick capture">
              <X size={17} />
            </button>
          </header>

          <div className="space-y-4 p-5">
            {(!isUrl || isYouTube) && (
              <label className="block border-b border-slate-200 pb-2.5 dark:border-neutral-800">
                <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400 dark:text-neutral-500">Title <span className="normal-case tracking-normal">(optional)</span></span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={isYouTube ? 'Name this video note' : 'Give it a name, or leave it untitled'}
                  className="mt-1 block w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-neutral-100 dark:placeholder:text-neutral-600"
                />
              </label>
            )}

            {youtubeId && (
              <div className="group relative aspect-video overflow-hidden rounded-xl border border-slate-200 bg-slate-950 shadow-lg shadow-slate-950/10 dark:border-neutral-800">
                <img src={getYouTubeThumbnailUrl(youtubeId)} alt="" className="h-full w-full object-cover opacity-90 transition duration-300 group-hover:scale-[1.02] group-hover:opacity-100" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />
                <span className="absolute inset-0 grid place-items-center">
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-red-600 text-white shadow-2xl shadow-black/40">
                    <Play size={23} fill="currentColor" className="ml-0.5" />
                  </span>
                </span>
                <p className="absolute bottom-3 left-4 text-xs font-semibold uppercase tracking-[0.18em] text-white/90">Playable in Reading view</p>
              </div>
            )}

            <label className="block">
              <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400 dark:text-neutral-500">{isUrl ? isYouTube ? 'YouTube URL' : 'URL' : 'Your note'}</span>
              <textarea
                autoFocus
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void submit();
                  }
                }}
                rows={isUrl ? 3 : 8}
                placeholder="Paste a thought, meeting note, quote, or a YouTube URL..."
                className="block w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-500/10 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-teal-400 dark:focus:bg-black"
              />
            </label>

            {isUrl && !isYouTube && (
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300">
                <input type="checkbox" checked={summarize} onChange={(event) => setSummarize(event.target.checked)} className="mt-1 accent-teal-600" />
                <span><strong>Optional AI summary</strong><br />Add a short practical summary at the top of the clipped note.</span>
              </label>
            )}

            <footer className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-neutral-800">
              <p className="hidden items-center gap-1.5 text-xs text-slate-400 sm:flex dark:text-neutral-500"><Sparkles size={13} />Saved directly to {destination}.</p>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/[0.06]">Cancel</button>
                <button
                  onClick={() => void submit()}
                  disabled={busy || !text.trim()}
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm shadow-teal-500/20 transition-colors hover:bg-teal-500 disabled:opacity-50"
                >
                  {busy ? <LoaderCircle size={16} className="animate-spin" /> : icon}
                  {busy ? 'Saving...' : isYouTube ? 'Save video' : isUrl ? 'Clip to inbox' : 'Capture'}
                  {!busy && <CornerDownLeft size={14} className="ml-0.5 opacity-70" />}
                </button>
              </div>
            </footer>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
