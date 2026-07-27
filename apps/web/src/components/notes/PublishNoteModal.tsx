import { useState } from 'react';
import { useCreateNoteShare, useNoteShare, useRevokeNoteShare } from '../../hooks/notes.js';

export default function PublishNoteModal({
  noteId,
  onClose,
}: {
  noteId: string;
  onClose: () => void;
}) {
  const share = useNoteShare(noteId);
  const create = useCreateNoteShare();
  const revoke = useRevokeNoteShare();
  const [copied, setCopied] = useState(false);

  async function copyLink(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-4 py-16" onClick={onClose}>
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900" onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-slate-200 px-5 py-4 dark:border-neutral-800">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Phase 8</p>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Publish Read-Only Link</h3>
            </div>
            <button onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-950">
              Close
            </button>
          </div>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-sm text-slate-500 dark:text-neutral-400">This creates an unlisted public URL for the current note. The link is read-only and can be revoked at any time.</p>
          {share.error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-500/10 dark:text-rose-300">{share.error instanceof Error ? share.error.message : 'Could not load the share status.'}</p>}
          {share.data?.active && share.data.shareUrl ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-950/60">
              <p className="text-sm font-medium text-slate-900 dark:text-neutral-100">Active share link</p>
              <p className="mt-2 break-all rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">{share.data.shareUrl}</p>
              <p className="mt-2 text-xs text-slate-400 dark:text-neutral-500">Created {share.data.createdAt ? new Date(share.data.createdAt).toLocaleString() : 'just now'}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => void copyLink(share.data!.shareUrl!)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800">
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <button
                  onClick={() => revoke.mutate(noteId)}
                  disabled={revoke.isPending}
                  className="rounded-xl border border-rose-200 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/50 dark:text-rose-300 dark:hover:bg-rose-500/10"
                >
                  {revoke.isPending ? 'Revoking…' : 'Revoke link'}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400 dark:border-neutral-700 dark:text-neutral-500">
              No public share link exists for this note yet.
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-950">
              Done
            </button>
            <button
              onClick={() => create.mutate(noteId)}
              disabled={create.isPending}
              className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {create.isPending ? 'Generating…' : share.data?.active ? 'Regenerate link' : 'Generate link'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
