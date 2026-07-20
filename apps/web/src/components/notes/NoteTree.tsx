import { type ReactNode, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Clock, FileText, Folder, FolderOpen, Plus, Star, Trash2 } from 'lucide-react';
import type { NoteSummaryDTO } from '@timeblock/shared';

interface TreeFolder {
  kind: 'folder';
  name: string;
  path: string;
  children: TreeNode[];
}
interface TreeFile {
  kind: 'file';
  name: string;
  note: NoteSummaryDTO;
}
type TreeNode = TreeFolder | TreeFile;

function buildTree(notesList: NoteSummaryDTO[]): TreeNode[] {
  const root: TreeFolder = { kind: 'folder', name: '', path: '', children: [] };
  for (const note of notesList) {
    const parts = note.id.split('/');
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join('/');
      let folder = cursor.children.find((c): c is TreeFolder => c.kind === 'folder' && c.name === parts[i]);
      if (!folder) {
        folder = { kind: 'folder', name: parts[i], path, children: [] };
        cursor.children.push(folder);
      }
      cursor = folder;
    }
    cursor.children.push({ kind: 'file', name: parts[parts.length - 1], note });
  }
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name)));
    for (const n of nodes) if (n.kind === 'folder') sortRec(n.children);
  };
  sortRec(root.children);
  return root.children;
}

function FolderRow({
  folder,
  depth,
  selectedId,
  onSelect,
  onDelete,
  onRename,
  onMoveInto,
  onNewNoteIn,
  onTogglePin,
}: {
  folder: TreeFolder;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newFileName: string) => void;
  onMoveInto: (fromId: string, folderPath: string) => void;
  onNewNoteIn: (folderPath: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  return (
    <div>
      <div
        className={`sb-tree-row sb-folder-row group flex items-center gap-1 rounded-md px-1.5 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5 ${dragOver ? 'bg-teal-50 dark:bg-teal-500/10' : ''}`}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const fromId = e.dataTransfer.getData('text/note-id');
          if (fromId) onMoveInto(fromId, folder.path);
        }}
      >
        <button onClick={() => setOpen((v) => !v)} className="flex flex-1 items-center gap-1 text-left">
          {open ? <ChevronDown size={13} className="shrink-0 opacity-50" /> : <ChevronRight size={13} className="shrink-0 opacity-50" />}
          {open ? <FolderOpen size={14} className="shrink-0 text-teal-600 dark:text-teal-400" /> : <Folder size={14} className="shrink-0 text-teal-600 dark:text-teal-400" />}
          <span className="truncate">{folder.name}</span>
        </button>
        <button
          onClick={() => onNewNoteIn(folder.path)}
          title="New note in this folder"
          className="opacity-0 group-hover:opacity-100"
        >
          <Plus size={13} />
        </button>
      </div>
      {open && (
        <div>
          {folder.children.map((child) =>
            child.kind === 'folder' ? (
              <FolderRow key={child.path} folder={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} onDelete={onDelete} onRename={onRename} onMoveInto={onMoveInto} onNewNoteIn={onNewNoteIn} onTogglePin={onTogglePin} />
            ) : (
              <FileRow key={child.note.id} file={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} onDelete={onDelete} onRename={onRename} onTogglePin={onTogglePin} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function FileRow({
  file,
  depth,
  selectedId,
  onSelect,
  onDelete,
  onRename,
  onTogglePin,
}: {
  file: TreeFile;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newFileName: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const isSelected = selectedId === file.note.id;
  const [renaming, setRenaming] = useState(false);
  const currentFileName = file.name.replace(/\.md$/i, '');
  const [draft, setDraft] = useState(currentFileName);

  function commitRename() {
    setRenaming(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== currentFileName) onRename(file.note.id, trimmed);
    else setDraft(currentFileName);
  }

  return (
    <div
      draggable={!renaming}
      onDragStart={(e) => e.dataTransfer.setData('text/note-id', file.note.id)}
      className={`sb-tree-row sb-file-row group flex items-center gap-1 rounded-md px-1.5 py-1 text-sm ${
        isSelected ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
      }`}
      style={{ paddingLeft: `${depth * 14 + 4}px` }}
    >
      {renaming ? (
        <input
          autoFocus
          value={draft}
          dir="auto"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            else if (e.key === 'Escape') {
              setDraft(currentFileName);
              setRenaming(false);
            }
          }}
          className="flex-1 rounded border border-teal-300 bg-white px-1 py-0.5 text-sm dark:bg-neutral-800 dark:text-neutral-100"
        />
      ) : (
        <button onClick={() => onSelect(file.note.id)} onDoubleClick={() => setRenaming(true)} className="flex flex-1 items-center gap-1.5 overflow-hidden text-left">
          <FileText size={13} className="shrink-0 opacity-50" />
          <span className="truncate">{file.note.title}</span>
        </button>
      )}
      {!renaming && (
        <>
          <button
            onClick={() => onTogglePin(file.note.id)}
            title={file.note.pinned ? 'Unpin' : 'Pin'}
            className={file.note.pinned ? 'text-amber-500' : 'opacity-0 text-slate-400 hover:text-amber-500 group-hover:opacity-100'}
          >
            <Star size={13} fill={file.note.pinned ? 'currentColor' : 'none'} />
          </button>
          <button onClick={() => onDelete(file.note.id)} title="Delete (moves to trash)" className="opacity-0 group-hover:opacity-100">
            <Trash2 size={13} className="text-slate-400 hover:text-rose-500" />
          </button>
        </>
      )}
    </div>
  );
}

function FlatNoteRow({ note, selectedId, onSelect, icon }: { note: NoteSummaryDTO; selectedId: string | null; onSelect: (id: string) => void; icon: ReactNode }) {
  const isSelected = selectedId === note.id;
  return (
    <button
      onClick={() => onSelect(note.id)}
      className={`sb-tree-row sb-flat-row flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm ${
        isSelected ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
      }`}
      style={{ paddingLeft: '4px' }}
    >
      {icon}
      <span className="truncate">{note.title}</span>
    </button>
  );
}

export default function NoteTree({
  notes,
  selectedId,
  recentIds,
  onSelect,
  onDelete,
  onRename,
  onMove,
  onNewNote,
  onTogglePin,
}: {
  notes: NoteSummaryDTO[];
  selectedId: string | null;
  /** Most-recently-opened note ids, newest first (tracked client-side, not by edit time). */
  recentIds: string[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newFileName: string) => void;
  onMove: (fromId: string, toFolder: string) => void;
  onNewNote: (folder: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const tree = useMemo(() => buildTree(notes), [notes]);
  const [rootDragOver, setRootDragOver] = useState(false);

  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const pinned = useMemo(() => notes.filter((n) => n.pinned).sort((a, b) => a.title.localeCompare(b.title)), [notes]);
  const recent = useMemo(
    () =>
      recentIds
        .map((id) => byId.get(id))
        .filter((n): n is NoteSummaryDTO => !!n && !n.pinned)
        .slice(0, 8),
    [recentIds, byId],
  );

  return (
    <div
      className={`sb-note-tree min-h-0 flex-1 overflow-auto rounded-lg py-1 ${rootDragOver ? 'bg-teal-50/50 dark:bg-teal-500/5' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setRootDragOver(true);
      }}
      onDragLeave={() => setRootDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setRootDragOver(false);
        const fromId = e.dataTransfer.getData('text/note-id');
        if (fromId) onMove(fromId, '');
      }}
    >
      {pinned.length > 0 && (
        <div className="mb-2 border-b border-slate-100 px-1.5 pb-2 dark:border-neutral-800">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Pinned</span>
          {pinned.map((n) => (
            <FlatNoteRow key={n.id} note={n} selectedId={selectedId} onSelect={onSelect} icon={<Star size={12} className="shrink-0 text-amber-500" fill="currentColor" />} />
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <div className="mb-2 border-b border-slate-100 px-1.5 pb-2 dark:border-neutral-800">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Recent</span>
          {recent.map((n) => (
            <FlatNoteRow key={n.id} note={n} selectedId={selectedId} onSelect={onSelect} icon={<Clock size={12} className="shrink-0 opacity-40" />} />
          ))}
        </div>
      )}
      <div className="sb-vault-head mb-1 flex items-center justify-between px-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Vault</span>
        <button onClick={() => onNewNote('')} title="New note" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-neutral-300">
          <Plus size={14} />
        </button>
      </div>
      {tree.length === 0 && <p className="px-2 py-4 text-sm text-slate-400 dark:text-neutral-500">No notes yet — create one to get started.</p>}
      {tree.map((node) =>
        node.kind === 'folder' ? (
          <FolderRow key={node.path} folder={node} depth={0} selectedId={selectedId} onSelect={onSelect} onDelete={onDelete} onRename={onRename} onMoveInto={onMove} onNewNoteIn={onNewNote} onTogglePin={onTogglePin} />
        ) : (
          <FileRow key={node.note.id} file={node} depth={0} selectedId={selectedId} onSelect={onSelect} onDelete={onDelete} onRename={onRename} onTogglePin={onTogglePin} />
        ),
      )}
    </div>
  );
}
