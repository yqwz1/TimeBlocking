import { useEffect, useState } from 'react';
import { FileDown, Link2, Search, X } from 'lucide-react';
import type { DriveFileDTO } from '@timeblock/shared';
import { api } from '../../api.js';

export default function DrivePicker({ onClose, onInsert, onImported }: { onClose: () => void; onInsert: (markdown: string) => void; onImported: (noteId: string) => void }) {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<DriveFileDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) { setFiles([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        // api's tiny wrapper deliberately does not expose abort signals; a stale result is harmless here.
        const result = await api.get<DriveFileDTO[]>(`/drive/search?q=${encodeURIComponent(query.trim())}`);
        if (!controller.signal.aborted) setFiles(result);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not search Drive.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query]);

  async function importDoc(file: DriveFileDTO) {
    setImporting(file.id);
    try {
      const created = await api.post<{ id: string }>('/drive/import', { fileId: file.id });
      onImported(created.id);
      onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not import this Google Doc.'); }
    finally { setImporting(null); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Insert a Google Drive file">
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-neutral-800">
          <Search size={16} className="text-slate-400" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Google Drive" className="min-w-0 flex-1 bg-transparent text-sm outline-none dark:text-neutral-100" />
          <button onClick={onClose} aria-label="Close Drive picker" className="text-slate-400 hover:text-slate-700 dark:hover:text-neutral-200"><X size={17} /></button>
        </div>
        <p className="px-4 pt-3 text-xs text-slate-400 dark:text-neutral-500">Links stay portable as <code>[Title](gdrive://fileId)</code>. Import is available for Google Docs.</p>
        {error && <p className="mx-4 mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
        <div className="max-h-80 overflow-auto p-2">
          {loading && <p className="px-2 py-6 text-center text-sm text-slate-400">Searching…</p>}
          {!loading && query && !error && files.length === 0 && <p className="px-2 py-6 text-center text-sm text-slate-400">No Drive files found.</p>}
          {files.map((file) => {
            const isDoc = file.mimeType === 'application/vnd.google-apps.document';
            return <div key={file.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 dark:hover:bg-neutral-800">
              <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-700 dark:text-neutral-200">{file.name}</p><p className="truncate text-xs text-slate-400">{file.mimeType.replace('application/vnd.google-apps.', '')}</p></div>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => { onInsert(`[${file.name}](gdrive://${file.id})`); onClose(); }} className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-white dark:border-neutral-700 dark:text-neutral-300"><Link2 size={12} /> Link</button>
                {isDoc && <button onClick={() => void importDoc(file)} disabled={importing === file.id} className="flex items-center gap-1 rounded border border-teal-200 px-2 py-1 text-xs text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:border-teal-900 dark:text-teal-300"><FileDown size={12} /> {importing === file.id ? 'Importing…' : 'Import'}</button>}
              </div>
            </div>;
          })}
        </div>
      </div>
    </div>
  );
}
