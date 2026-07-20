import { useEffect, useRef, useState } from 'react';
import { FileText, LayoutTemplate } from 'lucide-react';
import type { TemplateSummaryDTO } from '@timeblock/shared';

export default function TemplatePicker({
  templates,
  onCreate,
  onClose,
}: {
  templates: TemplateSummaryDTO[];
  onCreate: (title: string, templateId: string | null) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string | null>(null); // null = blank note
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function commit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    onCreate(trimmed, selected);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-200 px-4 py-3 dark:border-neutral-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">New note</h3>
        </div>
        <div className="max-h-64 overflow-auto py-1">
          <button
            onClick={() => setSelected(null)}
            className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${selected === null ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-700 dark:text-neutral-200'}`}
          >
            <FileText size={14} className="shrink-0 opacity-50" /> Blank note
          </button>
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelected(t.id)}
              className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${selected === t.id ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-700 dark:text-neutral-200'}`}
            >
              <LayoutTemplate size={14} className="shrink-0 opacity-50" /> {t.title}
            </button>
          ))}
          {templates.length === 0 && (
            <p className="px-4 py-3 text-xs text-slate-400 dark:text-neutral-500">No templates yet — add .md files to your Templates folder (see Settings).</p>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-slate-200 p-3 dark:border-neutral-800">
          <input
            ref={inputRef}
            value={title}
            dir="auto"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              else if (e.key === 'Escape') onClose();
            }}
            placeholder="Note title…"
            className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
          <button onClick={commit} disabled={!title.trim()} className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
