import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getNoteProperties, normalisePropertyKey } from '../../lib/noteProperties.js';

export default function NoteProperties({ content, onAdd, onUpdate, onRemove }: {
  content: string;
  onAdd: (key: string, value: string) => void;
  onUpdate: (key: string, value: string) => void;
  onRemove: (key: string) => void;
}) {
  const properties = useMemo(() => getNoteProperties(content), [content]);
  const [isOpen, setIsOpen] = useState(properties.length > 0);
  const [keyDraft, setKeyDraft] = useState('');
  const [valueDraft, setValueDraft] = useState('');
  const validKey = normalisePropertyKey(keyDraft);

  const addProperty = () => {
    if (!validKey) return;
    onAdd(validKey, valueDraft);
    setKeyDraft('');
    setValueDraft('');
    setIsOpen(true);
  };

  return (
    <section className="border-b border-slate-100 px-3 py-2 dark:border-neutral-800" aria-label="Note properties">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-left text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-100"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Properties {properties.length ? <span className="text-slate-400 dark:text-neutral-500">({properties.length})</span> : null}
      </button>

      {isOpen && (
        <div className="mt-2 space-y-1.5">
          {properties.map((property) => (
            <div key={property.key} className="flex min-w-0 items-center gap-2">
              <span className="w-28 shrink-0 truncate text-xs font-medium text-slate-500 dark:text-neutral-400" title={property.key}>{property.key}</span>
              <input
                key={`${property.key}:${property.value}`}
                defaultValue={property.value}
                onBlur={(event) => {
                  const next = event.currentTarget.value;
                  if (next !== property.value) onUpdate(property.key, next);
                }}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                aria-label={`${property.key} value`}
                className="min-w-0 flex-1 rounded border border-transparent bg-slate-50 px-2 py-1 text-xs text-slate-700 outline-none transition focus:border-teal-400 focus:bg-white dark:bg-neutral-800 dark:text-neutral-200 dark:focus:bg-neutral-900"
              />
              <button
                type="button"
                onClick={() => onRemove(property.key)}
                className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                title={`Remove ${property.key}`}
                aria-label={`Remove ${property.key}`}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <input
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') addProperty(); }}
              placeholder="Property name"
              aria-label="New property name"
              className="w-28 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-teal-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
            />
            <input
              value={valueDraft}
              onChange={(event) => setValueDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') addProperty(); }}
              placeholder="Value"
              aria-label="New property value"
              className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-teal-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
            />
            <button
              type="button"
              onClick={addProperty}
              disabled={!validKey}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-teal-300 dark:hover:bg-teal-500/10"
            >
              <Plus size={13} /> Add
            </button>
          </div>
          {!properties.length && <p className="text-[11px] text-slate-400 dark:text-neutral-500">Add fields like status, due-date, or owner. They are saved in this note's YAML frontmatter.</p>}
        </div>
      )}
    </section>
  );
}
