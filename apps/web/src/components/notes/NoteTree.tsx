import { type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Bookmark, BriefcaseBusiness, ChevronDown, ChevronRight, Clock, ExternalLink, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, Link2, Plus, Star, Tag, Trash2, type LucideIcon } from 'lucide-react';
import type { NoteSummaryDTO } from '@timeblock/shared';
import { NOTE_COLORS, NoteIcon } from './noteAppearance.js';
import { tagPillStyle } from './tagAppearance.js';

interface TreeFolder { kind: 'folder'; name: string; path: string; children: TreeNode[]; }
interface TreeFile { kind: 'file'; name: string; note: NoteSummaryDTO; }
type TreeNode = TreeFolder | TreeFile;
type MenuTarget = { kind: 'root' } | { kind: 'folder'; folder: TreeFolder } | { kind: 'file'; file: TreeFile };
type NoteSortOrder = 'title' | 'updated' | 'created';

function noteTimestamp(note: NoteSummaryDTO, field: 'updatedAt' | 'createdAt'): number {
  const value = note[field];
  return value ? Date.parse(value) || 0 : 0;
}

function compareNotes(a: NoteSummaryDTO, b: NoteSummaryDTO, sortOrder: NoteSortOrder): number {
  if (sortOrder === 'updated') {
    const byUpdatedAt = noteTimestamp(b, 'updatedAt') - noteTimestamp(a, 'updatedAt');
    if (byUpdatedAt) return byUpdatedAt;
  }
  if (sortOrder === 'created') {
    const byCreatedAt = noteTimestamp(b, 'createdAt') - noteTimestamp(a, 'createdAt');
    if (byCreatedAt) return byCreatedAt;
  }
  return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

function buildTree(notesList: NoteSummaryDTO[], folders: string[], sortOrder: NoteSortOrder): TreeNode[] {
  const root: TreeFolder = { kind: 'folder', name: '', path: '', children: [] };
  const ensureFolder = (folderPath: string) => {
    let cursor = root;
    for (const [index, name] of folderPath.split('/').filter(Boolean).entries()) {
      const path = folderPath.split('/').filter(Boolean).slice(0, index + 1).join('/');
      let folder = cursor.children.find((child): child is TreeFolder => child.kind === 'folder' && child.name === name);
      if (!folder) {
        folder = { kind: 'folder', name, path, children: [] };
        cursor.children.push(folder);
      }
      cursor = folder;
    }
    return cursor;
  };
  for (const folder of folders) ensureFolder(folder);
  for (const note of notesList) {
    const parts = note.id.split('/');
    const parent = ensureFolder(parts.slice(0, -1).join('/'));
    parent.children.push({ kind: 'file', name: parts[parts.length - 1], note });
  }
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      if (a.kind === 'folder' && b.kind === 'folder') return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      return compareNotes((a as TreeFile).note, (b as TreeFile).note, sortOrder);
    });
    for (const node of nodes) if (node.kind === 'folder') sortRec(node.children);
  };
  sortRec(root.children);
  return root.children;
}

interface TreeActions {
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newFileName: string) => void;
  onMove: (fromId: string, folderPath: string) => void;
  onNewNote: (folderPath: string) => void;
  onNewFolder: (parentFolder: string) => void;
  onNewProject: (parentFolder: string) => void;
  onTogglePin: (id: string) => void;
}

function formatNoteDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function noteFolder(note: NoteSummaryDTO): string {
  const parts = note.id.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : 'Vault root';
}

function NoteInfoCard({ note }: { note: NoteSummaryDTO }) {
  const updatedAt = formatNoteDate(note.updatedAt);
  const createdAt = formatNoteDate(note.createdAt);
  let sourceHost: string | null = null;
  if (note.source) {
    try { sourceHost = new URL(note.source).hostname.replace(/^www\./, ''); } catch { sourceHost = note.source; }
  }
  return <div role="tooltip" className="pointer-events-none fixed z-[1200] w-64 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
    <p className="truncate text-sm font-semibold text-slate-800 dark:text-neutral-100">{note.title}</p>
    <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-slate-500 dark:text-neutral-400"><Folder size={12} className="shrink-0" />{noteFolder(note)}</p>
    {(updatedAt || createdAt) && <div className="mt-2 space-y-1 text-[11px] text-slate-500 dark:text-neutral-400">
      {updatedAt && <p className="flex items-center gap-1.5"><Clock size={12} className="shrink-0" />Updated {updatedAt}</p>}
      {createdAt && <p className="flex items-center gap-1.5"><Clock size={12} className="shrink-0" />Created {createdAt}</p>}
    </div>}
    {note.tags.length > 0 && <div className="mt-2 flex items-start gap-1.5"><Tag size={12} className="mt-0.5 shrink-0 text-slate-400 dark:text-neutral-500" /><div className="flex flex-wrap gap-1">{note.tags.slice(0, 4).map((tag) => <span key={tag} style={tagPillStyle(tag, note.tagColors)} className="rounded border border-transparent bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">#{tag}</span>)}{note.tags.length > 4 && <span className="px-0.5 py-0.5 text-[10px] text-slate-400">+{note.tags.length - 4}</span>}</div></div>}
    {sourceHost && <p className="mt-2 flex items-center gap-1.5 truncate text-[11px] text-teal-700 dark:text-teal-300"><Link2 size={12} className="shrink-0" />{sourceHost}</p>}
  </div>;
}

function useNoteInfoHover() {
  const rowRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const close = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setPosition(null);
  };
  const open = (delayed = true) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const show = () => {
      const rect = rowRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({ left: Math.min(rect.left + 8, window.innerWidth - 272), top: Math.min(rect.bottom + 8, window.innerHeight - 180) });
    };
    if (delayed) timerRef.current = setTimeout(show, 350); else show();
  };
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return {
    rowRef,
    onPointerEnter: () => open(),
    onPointerLeave: close,
    onFocusCapture: () => open(false),
    onBlurCapture: (event: ReactFocusEvent<HTMLDivElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); },
    infoCard: (note: NoteSummaryDTO) => position && createPortal(<div style={position}><NoteInfoCard note={note} /></div>, document.body),
  };
}

function FolderRow({ folder, depth, selectedId, actions, onOpenMenu }: { folder: TreeFolder; depth: number; selectedId: string | null; actions: TreeActions; onOpenMenu: (event: ReactMouseEvent, target: MenuTarget) => void }) {
  const [open, setOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  return <div>
    <div
      className={`sb-tree-row sb-folder-row group flex items-center gap-1 rounded-md px-1.5 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5 ${dragOver ? 'bg-teal-50 dark:bg-teal-500/10' : ''}`}
      style={{ paddingLeft: `${depth * 14 + 4}px` }}
      onContextMenu={(event) => onOpenMenu(event, { kind: 'folder', folder })}
      onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => { event.preventDefault(); setDragOver(false); const fromId = event.dataTransfer.getData('text/note-id'); if (fromId) actions.onMove(fromId, folder.path); }}
    >
      <button onClick={() => setOpen((value) => !value)} className="flex flex-1 items-center gap-1 text-left">
        {open ? <ChevronDown size={13} className="shrink-0 opacity-50" /> : <ChevronRight size={13} className="shrink-0 opacity-50" />}
        {open ? <FolderOpen size={14} className="shrink-0 text-teal-600 dark:text-teal-400" /> : <Folder size={14} className="shrink-0 text-teal-600 dark:text-teal-400" />}
        <span className="truncate">{folder.name}</span>
      </button>
      <button onClick={() => actions.onNewNote(folder.path)} title="New note in this folder" className="opacity-0 group-hover:opacity-100"><Plus size={13} /></button>
    </div>
    {open && folder.children.map((child) => child.kind === 'folder'
      ? <FolderRow key={child.path} folder={child} depth={depth + 1} selectedId={selectedId} actions={actions} onOpenMenu={onOpenMenu} />
      : <FileRow key={child.note.id} file={child} depth={depth + 1} selectedId={selectedId} actions={actions} onOpenMenu={onOpenMenu} />)}
  </div>;
}

function FileRow({ file, depth, selectedId, actions, onOpenMenu }: { file: TreeFile; depth: number; selectedId: string | null; actions: TreeActions; onOpenMenu: (event: ReactMouseEvent, target: MenuTarget) => void }) {
  const isSelected = selectedId === file.note.id;
  const [renaming, setRenaming] = useState(false);
  const noteInfo = useNoteInfoHover();
  const currentFileName = file.name.replace(/\.md$/i, '');
  const [draft, setDraft] = useState(currentFileName);
  const commitRename = () => { setRenaming(false); const trimmed = draft.trim(); if (trimmed && trimmed !== currentFileName) actions.onRename(file.note.id, trimmed); else setDraft(currentFileName); };
  return <div ref={noteInfo.rowRef} draggable={!renaming} onPointerEnter={noteInfo.onPointerEnter} onPointerLeave={noteInfo.onPointerLeave} onFocusCapture={noteInfo.onFocusCapture} onBlurCapture={noteInfo.onBlurCapture} onDragStart={(event) => event.dataTransfer.setData('text/note-id', file.note.id)} onContextMenu={(event) => onOpenMenu(event, { kind: 'file', file })} className={`sb-tree-row sb-file-row group flex items-center gap-1 rounded-md px-1.5 py-1 text-sm ${isSelected ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'}`} style={{ paddingLeft: `${depth * 14 + 4}px` }}>
    {renaming ? <input autoFocus value={draft} dir="auto" onChange={(event) => setDraft(event.target.value)} onBlur={commitRename} onKeyDown={(event) => { if (event.key === 'Enter') commitRename(); else if (event.key === 'Escape') { setDraft(currentFileName); setRenaming(false); } }} className="flex-1 rounded border border-teal-300 bg-white px-1 py-0.5 text-sm dark:bg-neutral-800 dark:text-neutral-100" /> : <button onClick={() => actions.onSelect(file.note.id)} onDoubleClick={() => setRenaming(true)} className="flex flex-1 items-center gap-1.5 overflow-hidden text-left"><NoteIcon icon={file.note.icon} color={file.note.color} fallback={FileText} size={13} /><span className="truncate">{file.note.title}</span></button>}
    {!renaming && <><button onClick={() => actions.onTogglePin(file.note.id)} title={file.note.pinned ? 'Unpin' : 'Pin'} className={file.note.pinned ? 'text-amber-500' : 'opacity-0 text-slate-400 hover:text-amber-500 group-hover:opacity-100'}><Star size={13} fill={file.note.pinned ? 'currentColor' : 'none'} /></button><button onClick={() => actions.onDelete(file.note.id)} title="Delete (moves to trash)" className="opacity-0 group-hover:opacity-100"><Trash2 size={13} className="text-slate-400 hover:text-rose-500" /></button></>}
  {noteInfo.infoCard(file.note)}</div>;
}

function FlatNoteRow({ note, selectedId, onSelect, icon: FallbackIcon }: { note: NoteSummaryDTO; selectedId: string | null; onSelect: (id: string) => void; icon: LucideIcon }) {
  const isSelected = selectedId === note.id;
  const noteInfo = useNoteInfoHover();
  const rowClass = `sb-tree-row sb-flat-row flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm ${isSelected ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'}`;
  return <div ref={noteInfo.rowRef} onPointerEnter={noteInfo.onPointerEnter} onPointerLeave={noteInfo.onPointerLeave} onFocusCapture={noteInfo.onFocusCapture} onBlurCapture={noteInfo.onBlurCapture} className="flex w-full items-center gap-0.5" style={{ paddingLeft: '4px' }}>
    <button onClick={() => onSelect(note.id)} className={`${rowClass} min-w-0 flex-1`}><NoteIcon icon={note.icon} color={note.color} fallback={FallbackIcon} size={12} /><span className="truncate">{note.title}</span></button>
    {note.source && <a href={note.source} target="_blank" rel="noreferrer" title="Open saved link" aria-label={`Open ${note.title} in a new tab`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-teal-600 dark:text-neutral-500 dark:hover:bg-white/5 dark:hover:text-teal-400"><ExternalLink size={12} /></a>}
  {noteInfo.infoCard(note)}</div>;
}

function LibraryContextMenu({ state, actions, onClose }: { state: { x: number; y: number; target: MenuTarget }; actions: TreeActions; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });
  useLayoutEffect(() => { const rect = ref.current?.getBoundingClientRect(); if (rect) setPos({ x: Math.min(state.x, window.innerWidth - rect.width - 8), y: Math.min(state.y, window.innerHeight - rect.height - 8) }); }, [state.x, state.y]);
  useEffect(() => { const dismiss = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); }; const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('pointerdown', dismiss, true); window.addEventListener('keydown', escape); window.addEventListener('wheel', onClose, { capture: true, passive: true }); return () => { window.removeEventListener('pointerdown', dismiss, true); window.removeEventListener('keydown', escape); window.removeEventListener('wheel', onClose, { capture: true } as EventListenerOptions); }; }, [onClose]);
  const folder = state.target.kind === 'folder' ? state.target.folder.path : state.target.kind === 'root' ? '' : null;
  const file = state.target.kind === 'file' ? state.target.file : null;
  const targetName = state.target.kind === 'file' ? state.target.file.note.title : folder ? folder.split('/').pop() : 'Vault';
  const action = (run: () => void) => { run(); onClose(); };
  return <motion.div ref={ref} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.12, ease: 'easeOut' }} style={{ left: pos.x, top: pos.y }} className="fixed z-[1100] w-56 origin-top-left overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 text-sm text-slate-700 shadow-xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200" role="menu" onContextMenu={(event) => event.preventDefault()}>
    <p className="truncate px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">{targetName}</p>
    {folder !== null && <><MenuItem icon={FilePlus2} label="New note" onClick={() => action(() => actions.onNewNote(folder))} /><MenuItem icon={FolderPlus} label="New folder" onClick={() => action(() => actions.onNewFolder(folder))} /><MenuItem icon={BriefcaseBusiness} label="New project" onClick={() => action(() => actions.onNewProject(folder))} /></>}
    {file && <><MenuItem icon={FileText} label="Open note" onClick={() => action(() => actions.onSelect(file.note.id))} /><MenuItem icon={Star} label={file.note.pinned ? 'Unpin note' : 'Pin note'} onClick={() => action(() => actions.onTogglePin(file.note.id))} /><div className="my-1 h-px bg-slate-100 dark:bg-neutral-800" /><MenuItem icon={Trash2} label="Delete note" danger onClick={() => action(() => actions.onDelete(file.note.id))} /></>}
  </motion.div>;
}

function MenuItem({ icon: Icon, label, onClick, danger = false }: { icon: typeof FileText; label: string; onClick: () => void; danger?: boolean }) {
  return <button type="button" role="menuitem" onClick={onClick} className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${danger ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10' : 'hover:bg-slate-100 dark:hover:bg-neutral-800'}`}><Icon size={15} className={danger ? '' : 'text-slate-400 dark:text-neutral-500'} /><span>{label}</span></button>;
}

export default function NoteTree({ notes, folders, selectedId, recentIds, onSelect, onDelete, onRename, onMove, onNewNote, onNewFolder, onNewProject, onTogglePin }: { notes: NoteSummaryDTO[]; folders: string[]; selectedId: string | null; recentIds: string[]; onSelect: (id: string) => void; onDelete: (id: string) => void; onRename: (id: string, newFileName: string) => void; onMove: (fromId: string, toFolder: string) => void; onNewNote: (folder: string) => void; onNewFolder: (parentFolder: string) => void; onNewProject: (parentFolder: string) => void; onTogglePin: (id: string) => void; }) {
  const [visibleColors, setVisibleColors] = useState<string[] | null>(null);
  const [recentOpen, setRecentOpen] = useState(true);
  const [vaultOpen, setVaultOpen] = useState(true);
  const [sortOrder, setSortOrder] = useState<NoteSortOrder>(() => {
    const saved = window.localStorage.getItem('second-brain.vault-sort-order');
    return saved === 'updated' || saved === 'created' ? saved : 'title';
  });
  const availableColors = useMemo(() => NOTE_COLORS.filter((color) => notes.some((note) => note.color === color)), [notes]);
  const selectedColors = visibleColors ?? availableColors;
  const visibleNotes = useMemo(() => notes.filter((note) => !note.color || selectedColors.includes(note.color)), [notes, selectedColors]);
  const tree = useMemo(() => buildTree(visibleNotes, folders, sortOrder), [visibleNotes, folders, sortOrder]);
  const [rootDragOver, setRootDragOver] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null);
  const actions: TreeActions = { onSelect, onDelete, onRename, onMove, onNewNote, onNewFolder, onNewProject, onTogglePin };
  const openMenu = (event: ReactMouseEvent, target: MenuTarget) => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY, target }); };
  const byId = useMemo(() => new Map(visibleNotes.map((note) => [note.id, note])), [visibleNotes]);
  const pinned = useMemo(() => visibleNotes.filter((note) => note.pinned).sort((a, b) => compareNotes(a, b, sortOrder)), [visibleNotes, sortOrder]);
  const bookmarks = useMemo(() => visibleNotes.filter((note) => note.bookmark).sort((a, b) => compareNotes(a, b, 'updated')), [visibleNotes]);
  const recent = useMemo(() => recentIds.map((id) => byId.get(id)).filter((note): note is NoteSummaryDTO => !!note && !note.pinned).slice(0, 8), [recentIds, byId]);
  const toggleColor = (color: string) => setVisibleColors((current) => {
    const next = new Set(current ?? availableColors);
    if (next.has(color)) next.delete(color); else next.add(color);
    return availableColors.filter((item) => next.has(item));
  });
  useEffect(() => {
    window.localStorage.setItem('second-brain.vault-sort-order', sortOrder);
  }, [sortOrder]);
  return <><div className={`sb-note-tree min-h-0 flex-1 overflow-auto rounded-lg py-1 ${rootDragOver ? 'bg-teal-50/50 dark:bg-teal-500/5' : ''}`} onContextMenu={(event) => openMenu(event, { kind: 'root' })} onDragOver={(event) => { event.preventDefault(); setRootDragOver(true); }} onDragLeave={() => setRootDragOver(false)} onDrop={(event) => { event.preventDefault(); setRootDragOver(false); const fromId = event.dataTransfer.getData('text/note-id'); if (fromId) onMove(fromId, ''); }}>
    {availableColors.length > 0 && <div className="mb-2 flex items-center gap-1 border-b border-slate-100 px-2 pb-2 dark:border-neutral-800" aria-label="Filter notes by color"><span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Show</span>{availableColors.map((color) => { const active = selectedColors.includes(color); return <button key={color} type="button" onClick={() => toggleColor(color)} aria-label={`${active ? 'Hide' : 'Show'} ${color} notes`} aria-pressed={active} className={`h-4 w-4 rounded-full border-2 transition-transform hover:scale-110 ${active ? 'border-white ring-1 ring-slate-300 dark:border-neutral-900 dark:ring-neutral-600' : 'border-transparent opacity-25'}`} style={{ backgroundColor: color }} />; })}</div>}
    {pinned.length > 0 && <div className="mb-2 border-b border-slate-100 px-1.5 pb-2 dark:border-neutral-800"><span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Pinned</span>{pinned.map((note) => <FlatNoteRow key={note.id} note={note} selectedId={selectedId} onSelect={onSelect} icon={Star} />)}</div>}
    {bookmarks.length > 0 && <div className="mb-2 border-b border-slate-100 px-1.5 pb-2 dark:border-neutral-800"><span className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500"><Bookmark size={12} /> Bookmarks <span className="text-[10px] font-medium normal-case tracking-normal">{bookmarks.length}</span></span>{bookmarks.map((note) => <FlatNoteRow key={note.id} note={note} selectedId={selectedId} onSelect={onSelect} icon={Bookmark} />)}</div>}
    {recent.length > 0 && <section className="mb-2 border-b border-slate-100 px-1.5 pb-2 dark:border-neutral-800" aria-labelledby="recent-notes-heading">
      <button
        type="button"
        id="recent-notes-heading"
        aria-expanded={recentOpen}
        aria-controls="recent-notes-list"
        onClick={() => setRecentOpen((open) => !open)}
        className="mb-1 flex w-full items-center justify-between rounded px-0.5 py-0.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:text-neutral-500 dark:hover:bg-white/5 dark:hover:text-neutral-300"
      >
        <span>Recent <span className="ml-1 text-[10px] font-medium normal-case tracking-normal opacity-70">{recent.length}</span></span>
        <ChevronDown size={14} className={`transition-transform duration-200 ${recentOpen ? '' : '-rotate-90'}`} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {recentOpen && <motion.div id="recent-notes-list" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16, ease: 'easeOut' }} className="overflow-hidden">
          {recent.map((note) => <FlatNoteRow key={note.id} note={note} selectedId={selectedId} onSelect={onSelect} icon={Clock} />)}
        </motion.div>}
      </AnimatePresence>
    </section>}
    <section aria-labelledby="vault-heading">
      <div className="sb-vault-head mb-1 flex items-center justify-between px-1.5">
        <button
          type="button"
          id="vault-heading"
          aria-expanded={vaultOpen}
          aria-controls="vault-contents"
          onClick={() => setVaultOpen((open) => !open)}
          className="flex min-w-0 flex-1 items-center justify-between rounded px-0.5 py-0.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:text-neutral-500 dark:hover:bg-white/5 dark:hover:text-neutral-300"
        >
          <span>Vault <span className="ml-1 text-[10px] font-medium normal-case tracking-normal opacity-70">{visibleNotes.length}</span></span>
          <ChevronDown size={14} className={`transition-transform duration-200 ${vaultOpen ? '' : '-rotate-90'}`} aria-hidden="true" />
        </button>
        <select
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value as NoteSortOrder)}
          aria-label="Sort vault notes"
          title="Sort vault notes"
          className="ml-1 max-w-24 rounded border border-transparent bg-transparent px-1 py-0.5 text-[10px] font-medium text-slate-400 outline-none hover:border-slate-200 hover:text-slate-600 focus:border-teal-500 focus:text-slate-600 dark:hover:border-neutral-700 dark:hover:text-neutral-300 dark:focus:text-neutral-300"
        >
          <option value="title">A–Z</option>
          <option value="updated">Updated</option>
          <option value="created">Created</option>
        </select>
        <button onClick={() => onNewNote('')} title="New note" aria-label="New note" className="ml-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-neutral-300"><Plus size={14} /></button>
      </div>
      <AnimatePresence initial={false}>
        {vaultOpen && <motion.div id="vault-contents" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16, ease: 'easeOut' }} className="overflow-hidden">
          {tree.length === 0 && <p className="px-2 py-4 text-sm text-slate-400 dark:text-neutral-500">No notes or folders yet — right-click to get started.</p>}
          {tree.map((node) => node.kind === 'folder' ? <FolderRow key={node.path} folder={node} depth={0} selectedId={selectedId} actions={actions} onOpenMenu={openMenu} /> : <FileRow key={node.note.id} file={node} depth={0} selectedId={selectedId} actions={actions} onOpenMenu={openMenu} />)}
        </motion.div>}
      </AnimatePresence>
    </section>
  </div>{createPortal(<AnimatePresence>{menu && <LibraryContextMenu key={`${menu.x}-${menu.y}`} state={menu} actions={actions} onClose={() => setMenu(null)} />}</AnimatePresence>, document.body)}</>;
}
