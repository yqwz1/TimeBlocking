import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronsLeft, ChevronsRight, LayoutGrid, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useBoards, useCreateBoard, useDeleteBoard, useRenameBoard } from '../../hooks/whiteboard.js';
import { springs } from '../../lib/motion.js';

export default function BoardSidebar({ activeBoardId, onSelectBoard }: { activeBoardId: string | null; onSelectBoard: (id: string) => void }) {
  const [rawQuery, setRawQuery] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(rawQuery), 250);
    return () => clearTimeout(t);
  }, [rawQuery]);

  const { data: boards } = useBoards(query.trim() || undefined);
  const createBoard = useCreateBoard();
  const renameBoard = useRenameBoard();
  const deleteBoard = useDeleteBoard();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('tb.whiteboardSidebar.collapsed') === '1');

  const toggleCollapsed = () =>
    setCollapsed((v) => {
      localStorage.setItem('tb.whiteboardSidebar.collapsed', v ? '0' : '1');
      return !v;
    });

  const submitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    createBoard.mutate(name, {
      onSuccess: (board) => {
        onSelectBoard(board.id);
        setNewName('');
        setAdding(false);
      },
    });
  };

  const submitRename = (id: string) => {
    const name = editingName.trim();
    setEditingId(null);
    if (name) renameBoard.mutate({ id, name });
  };

  if (collapsed) {
    return (
      <div className="relative flex min-h-screen w-14 shrink-0 flex-col items-center gap-1.5 border-r border-slate-200 bg-white pt-2 dark:border-neutral-800 dark:bg-neutral-900">
        <button
          type="button"
          onClick={toggleCollapsed}
          title="Expand sidebar"
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-neutral-300"
        >
          <ChevronsRight size={16} />
        </button>
        {(boards ?? []).map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onSelectBoard(b.id)}
            title={b.name}
            className={`rounded-md p-1.5 ${activeBoardId === b.id ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'}`}
          >
            <LayoutGrid size={16} />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="relative flex w-60 shrink-0 flex-col gap-3 border-r border-slate-200 bg-white py-2 pl-3 pr-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Whiteboards</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            aria-label="New whiteboard"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-neutral-300"
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            title="Collapse sidebar"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-neutral-300"
          >
            <ChevronsLeft size={14} />
          </button>
        </div>
      </div>

      <div className="relative px-1">
        <Search size={13} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          placeholder="Search whiteboards…"
          className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-7 pr-7 text-xs text-slate-700 placeholder:text-slate-400 focus:border-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-teal-500/40 dark:focus:ring-teal-500/10"
        />
        {rawQuery && (
          <button
            type="button"
            onClick={() => setRawQuery('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-neutral-300"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {adding && (
          <motion.form
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.gentle}
            onSubmit={submitCreate}
            className="space-y-1.5 overflow-hidden"
          >
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Whiteboard name"
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
            <div className="flex gap-1.5">
              <button type="submit" className="flex-1 rounded-md bg-teal-600 px-2 py-1 text-xs font-medium text-white">
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setNewName('');
                }}
                className="rounded-md px-2 py-1 text-xs text-slate-500 dark:text-neutral-400"
              >
                Cancel
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      <ul className="space-y-0.5 overflow-y-auto">
        {(boards ?? []).map((b) => (
          <li key={b.id} className="group relative">
            {editingId === b.id ? (
              <input
                autoFocus
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={() => submitRename(b.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename(b.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="w-full rounded-md border border-teal-400 px-2 py-1.5 text-sm dark:bg-neutral-800 dark:text-neutral-100"
              />
            ) : (
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => onSelectBoard(b.id)}
                  onDoubleClick={() => {
                    setEditingId(b.id);
                    setEditingName(b.name);
                  }}
                  title="Click to open, double-click to rename"
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                    activeBoardId === b.id
                      ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
                  }`}
                >
                  <LayoutGrid size={14} className="shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{b.name}</span>
                    {b.matchSnippet && (
                      <span className="block truncate text-xs text-slate-400 dark:text-neutral-500">{b.matchSnippet}</span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(b.id);
                    setEditingName(b.name);
                  }}
                  aria-label={`Rename ${b.name}`}
                  className="hidden shrink-0 rounded p-1 text-slate-300 hover:text-teal-500 group-hover:block dark:text-neutral-600"
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => confirm(`Delete "${b.name}"? This can't be undone.`) && deleteBoard.mutate(b.id)}
                  aria-label={`Delete ${b.name}`}
                  className="hidden shrink-0 rounded p-1 text-slate-300 hover:text-red-500 group-hover:block dark:text-neutral-600"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </li>
        ))}
        {boards?.length === 0 && !adding && query.trim() && (
          <li className="px-2 py-1.5 text-xs text-slate-400 dark:text-neutral-500">No whiteboards match &ldquo;{query.trim()}&rdquo;.</li>
        )}
        {boards?.length === 0 && !adding && !query.trim() && (
          <li className="px-2 py-1.5 text-xs text-slate-400 dark:text-neutral-500">No whiteboards yet — click + to create one.</li>
        )}
      </ul>
    </div>
  );
}
