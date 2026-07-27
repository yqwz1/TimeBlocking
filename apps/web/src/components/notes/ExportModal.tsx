import { encodeNotePath } from '../../hooks/notes.js';

export default function ExportModal({
  noteId,
  onClose,
}: {
  noteId: string;
  onClose: () => void;
}) {
  const folder = noteId.includes('/') ? noteId.slice(0, noteId.lastIndexOf('/')) : '';
  const targets = [
    { label: 'Current note', kind: 'note' as const, target: noteId },
    { label: folder ? `Folder: ${folder}` : 'Vault root folder', kind: 'folder' as const, target: folder },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-4 py-16" onClick={onClose}>
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900" onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-slate-200 px-5 py-4 dark:border-neutral-800">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Phase 7</p>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Export</h3>
            </div>
            <button onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-950">
              Close
            </button>
          </div>
        </div>
        <div className="space-y-4 p-5">
          {targets.map((item) => (
            <section key={`${item.kind}:${item.target || '(root)'}`} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-950/60">
              <p className="text-sm font-semibold text-slate-900 dark:text-neutral-100">{item.label}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(['pdf', 'docx'] as const).map((format) => (
                  <a
                    key={format}
                    href={`/api/notes/export?kind=${item.kind}&target=${encodeURIComponent(item.target)}&format=${format}`}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    Download {format.toUpperCase()}
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
