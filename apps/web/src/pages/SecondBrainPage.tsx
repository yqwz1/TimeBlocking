import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenText, Brain, BrainCircuit, CheckSquare2, Download, FileOutput, FilePlus2, Globe2, History, Inbox, LayoutTemplate, Link2, MessageCircle, PenSquare, RefreshCw, Search, Share2, Sun, Trash2 } from 'lucide-react';
import type { NoteSuggestionsDTO, NoteSummaryDTO } from '@timeblock/shared';
import { useLocation } from 'react-router-dom';
import { useSettings } from '../hooks.js';
import {
  encodeNotePath,
  NoteConflictError,
  useCreateNote,
  useCreateNoteFromTemplate,
  useDeleteNote,
  useDraftLinkedInPost,
  useGenerateDigest,
  useInboxNotes,
  useMoveNote,
  useNote,
  useOnThisDay,
  useNoteGraph,
  useNoteShare,
  useNoteTrash,
  useNoteTree,
  useOpenDailyNote,
  usePurgeTrashEntry,
  useReindexNotes,
  useRelatedNotes,
  useRestoreNote,
  useSaveNote,
  useStudyQueue,
  useSuggestLinksAndTags,
  useTemplates,
  useToggleNotePin,
} from '../hooks/notes.js';
import { actionToasts, showUndoToast } from '../lib/actionToast.js';
import { useCommandPaletteScope } from '../lib/commandPalette.js';
import { getRecentNoteIds, recordNoteOpened } from '../lib/recentNotes.js';
import NoteTree from '../components/notes/NoteTree.js';
import NoteEditor from '../components/notes/NoteEditor.js';
import BacklinksPanel from '../components/notes/BacklinksPanel.js';
import QuickSwitcher from '../components/notes/QuickSwitcher.js';
import NoteSearchModal from '../components/notes/NoteSearchModal.js';
import GraphView from '../components/notes/GraphView.js';
import TemplatePicker from '../components/notes/TemplatePicker.js';
import ChatPanel from '../components/notes/ChatPanel.js';
import DrivePicker from '../components/notes/DrivePicker.js';
import InboxTriageModal from '../components/notes/InboxTriageModal.js';
import TasksHubModal from '../components/notes/TasksHubModal.js';
import StudyReviewModal from '../components/notes/StudyReviewModal.js';
import OnThisDayCard from '../components/notes/OnThisDayCard.js';
import ExportModal from '../components/notes/ExportModal.js';
import DraftLinkedInModal from '../components/notes/DraftLinkedInModal.js';
import PublishNoteModal from '../components/notes/PublishNoteModal.js';
import VersionHistoryModal from '../components/notes/VersionHistoryModal.js';

function uniqueUntitledPath(existing: NoteSummaryDTO[], folder: string): string {
  const prefix = folder ? `${folder}/` : '';
  const taken = new Set(existing.map((n) => n.id.toLowerCase()));
  let name = 'Untitled';
  let i = 1;
  while (taken.has(`${prefix}${name}.md`.toLowerCase())) {
    i++;
    name = `Untitled ${i}`;
  }
  return `${prefix}${name}.md`;
}

function TrashPanel({ onClose }: { onClose: () => void }) {
  const { data: trash } = useNoteTrash();
  const restore = useRestoreNote();
  const purge = usePurgeTrashEntry();
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-20" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-200 px-4 py-3 dark:border-neutral-800">
          <h3 className="font-semibold text-slate-900 dark:text-neutral-100">Trash</h3>
          <p className="text-xs text-slate-400 dark:text-neutral-500">Deleted notes are kept here before being auto-purged. Purging is permanent.</p>
        </div>
        <div className="max-h-96 overflow-auto">
          {!trash?.length && <p className="px-4 py-6 text-center text-sm text-slate-400 dark:text-neutral-500">Trash is empty.</p>}
          {trash?.map((t) => (
            <div key={t.trashId} className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-sm last:border-0 dark:border-neutral-800">
              <span className="truncate text-slate-600 dark:text-neutral-300">{t.originalPath}</span>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => restore.mutate(t.trashId)} className="rounded border border-teal-200 px-2 py-0.5 text-xs text-teal-700 hover:bg-teal-50 dark:border-teal-800 dark:text-teal-300 dark:hover:bg-teal-500/10">
                  Restore
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`Permanently delete "${t.originalPath}"? This cannot be undone.`)) purge.mutate(t.trashId);
                  }}
                  className="rounded border border-rose-200 px-2 py-0.5 text-xs text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-500/10"
                >
                  Purge
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SecondBrainPage() {
  const location = useLocation();
  const { data: settings } = useSettings();
  const { data: notes } = useNoteTree();
  const [selectedId, setSelectedIdRaw] = useState<string | null>(() => new URLSearchParams(window.location.search).get('note'));
  const { data: note, isLoading } = useNote(selectedId);
  const createNote = useCreateNote();
  const createFromTemplate = useCreateNoteFromTemplate();
  const saveNote = useSaveNote();
  const deleteNote = useDeleteNote();
  const moveNote = useMoveNote();
  const reindex = useReindexNotes();
  const togglePin = useToggleNotePin();
  const openDaily = useOpenDailyNote();
  const { data: templates } = useTemplates();
  const { data: relatedNotes } = useRelatedNotes(selectedId);
  const { data: inboxNotes = [] } = useInboxNotes();
  const { data: onThisDay } = useOnThisDay();
  const { data: studyQueue } = useStudyQueue();
  const suggest = useSuggestLinksAndTags();
  const generateDigest = useGenerateDigest();

  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showGraph, setShowGraph] = useState(() => new URLSearchParams(window.location.search).get('graph') === '1');
  const [showInboxTriage, setShowInboxTriage] = useState(false);
  const [showTasksHub, setShowTasksHub] = useState(false);
  const [showStudyReview, setShowStudyReview] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showLinkedInDraft, setShowLinkedInDraft] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [graphFocusIds, setGraphFocusIds] = useState<string[] | undefined>(undefined);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [chatScope, setChatScope] = useState<{ ids: string[]; message: string } | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'library' | 'note' | 'insights'>('note');
  const [zenMode, setZenMode] = useState(false);
  const [vimMode, setVimMode] = useState(false);
  const [conflict, setConflict] = useState<{ mine: string; theirs: string } | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [recentIds, setRecentIds] = useState<string[]>(() => getRecentNoteIds());
  const [suggestions, setSuggestions] = useState<NoteSuggestionsDTO | null>(null);
  const [appendText, setAppendText] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContent = useRef<string | null>(null);
  const { data: graph } = useNoteGraph(showGraph);
  const pendingInboxNotes = inboxNotes.filter((item) => !item.processed);
  const pendingInboxCount = pendingInboxNotes.length;
  const dueCards = studyQueue?.dueToday ?? 0;

  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdRaw(id);
    setSuggestions(null);
    setMobilePanel('note');
    if (id) {
      recordNoteOpened(id);
      setRecentIds(getRecentNoteIds());
    }
  }, []);

  useEffect(() => {
    if (!settings) return;
    setZenMode(settings.notesZenModeDefault);
    setVimMode(settings.notesVimModeDefault);
  }, [settings]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextId = params.get('note');
    const nextGraph = params.get('graph') === '1';
    setSelectedIdRaw((current) => (current === nextId ? current : nextId));
    setShowGraph((current) => (current === nextGraph ? current : nextGraph));
  }, [location.search]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (selectedId) params.set('note', selectedId);
    else params.delete('note');
    if (showGraph) params.set('graph', '1');
    else params.delete('graph');
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
    if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(null, '', next);
  }, [selectedId, showGraph]);

  useEffect(() => {
    if (notes && notes.length > 0 && !selectedId) setSelectedId(notes[0].id);
  }, [notes, selectedId, setSelectedId]);

  const commandPaletteCommands = useMemo(
    () =>
      [
        { id: 'notes-new', title: 'New note', subtitle: 'Create an untitled note in the vault root', shortcut: 'N', keywords: ['create note'], run: () => handleNewNote('') },
        { id: 'notes-switcher', title: 'Find a note', subtitle: 'Open the quick switcher', shortcut: 'Ctrl/Cmd+P', keywords: ['open note switcher'], run: () => setShowSwitcher(true) },
        { id: 'notes-search', title: 'Search notes', subtitle: 'Search note titles and content', shortcut: 'Ctrl/Cmd+Shift+F', keywords: ['search vault'], run: () => setShowSearch(true) },
        { id: 'notes-daily', title: "Open today's daily note", subtitle: 'Create or open today’s daily note', shortcut: 'Ctrl/Cmd+D', keywords: ['daily'], run: () => openDaily.mutate(undefined, { onSuccess: (created) => setSelectedId(created.id) }) },
        { id: 'notes-graph', title: 'Open graph view', subtitle: 'Show the connected notes graph', shortcut: 'Ctrl/Cmd+G', keywords: ['graph map'], run: () => setShowGraph(true) },
        { id: 'notes-tasks', title: 'Open tasks hub', subtitle: 'Review markdown tasks across the vault', keywords: ['tasks checkboxes'], run: () => setShowTasksHub(true) },
        { id: 'notes-study', title: 'Open study review', subtitle: 'Review due flashcards', keywords: ['study flashcards'], run: () => setShowStudyReview(true) },
        { id: 'notes-chat', title: 'Open vault chat', subtitle: 'Ask questions against your notes', keywords: ['chat ai'], run: () => setShowChat(true) },
        { id: 'notes-inbox', title: 'Process inbox', subtitle: 'Review captured notes waiting for triage', keywords: ['inbox capture'], run: () => setShowInboxTriage(true) },
        ...(note
          ? [
              { id: 'note-export', title: 'Export note', subtitle: `Export ${note.title}`, keywords: ['export pdf docx'], run: () => setShowExport(true) },
              { id: 'note-linkedin-en', title: 'Draft LinkedIn post (English)', subtitle: `Repurpose ${note.title}`, keywords: ['linkedin repurpose english'], run: () => setShowLinkedInDraft(true) },
              { id: 'note-publish', title: 'Publish read-only link', subtitle: `Share ${note.title}`, keywords: ['share publish public'], run: () => setShowPublish(true) },
              { id: 'note-history', title: 'Open version history', subtitle: `Inspect snapshots for ${note.title}`, keywords: ['history snapshots diff restore'], run: () => setShowVersionHistory(true) },
              { id: 'note-zen', title: zenMode ? 'Exit zen mode' : 'Enter zen mode', subtitle: 'Focus on the editor only', keywords: ['zen focus writing'], run: () => setZenMode((value) => !value) },
              { id: 'note-vim', title: vimMode ? 'Disable Vim mode' : 'Enable Vim mode', subtitle: 'Toggle Vim-style editor keys', keywords: ['vim keyboard normal insert'], run: () => setVimMode((value) => !value) },
            ]
          : []),
      ],
    [note, openDaily, setSelectedId, vimMode, zenMode],
  );
  useCommandPaletteScope(commandPaletteCommands);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowSwitcher(true);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setShowSearch(true);
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        openDaily.mutate(undefined, { onSuccess: (created) => setSelectedId(created.id) });
      } else if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setShowGraph(true);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setShowDrivePicker(true);
      } else if (e.key === 'Escape' && showGraph) {
        setShowGraph(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGraph]);

  const doSave = useCallback(
    (id: string, content: string, expectedUpdatedAt: string | null) => {
      setSaveState('saving');
      saveNote.mutate(
        { id, content, expectedUpdatedAt },
        {
          onSuccess: () => setSaveState('saved'),
          onError: (err) => {
            setSaveState('idle');
            if (err instanceof NoteConflictError) setConflict({ mine: content, theirs: err.conflict.serverContent });
          },
        },
      );
    },
    [saveNote],
  );

  function handleContentChange(content: string) {
    if (!note) return;
    pendingContent.current = content;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (pendingContent.current !== null) doSave(note.id, pendingContent.current, note.updatedAt);
    }, 800);
  }

  function handleNewNote(folder: string) {
    const path = uniqueUntitledPath(notes ?? [], folder);
    createNote.mutate({ path }, { onSuccess: (created) => setSelectedId(created.id) });
  }

  function handleCreateAndOpen(title: string) {
    const path = `${title.replace(/[/\\]/g, '-')}.md`;
    createNote.mutate({ path }, { onSuccess: (created) => setSelectedId(created.id) });
  }

  function handleCreateFromTemplate(title: string, templateId: string | null) {
    const path = `${title.replace(/[/\\]/g, '-')}.md`;
    if (!templateId) {
      createNote.mutate({ path }, { onSuccess: (created) => setSelectedId(created.id) });
      return;
    }
    createFromTemplate.mutate({ path, templateId }, { onSuccess: (created) => setSelectedId(created.id) });
  }

  function handleTogglePin(id: string) {
    togglePin.mutate(id);
  }

  function handleGraphNavigate(id: string) {
    setSelectedId(id);
    setShowGraph(false);
    setGraphFocusIds(undefined);
  }

  function handleRequestSuggestions() {
    if (!note) return;
    suggest.mutate(note.id, {
      onSuccess: (res) => setSuggestions(res),
      onError: () => actionToasts.show("Couldn't get suggestions — AI may be rate-limited or offline.", handleRequestSuggestions, 'Retry'),
    });
  }

  function handleAcceptLink(title: string) {
    setAppendText(`[[${title}]]`);
    setSuggestions((prev) => (prev ? { ...prev, links: prev.links.filter((l) => l !== title) } : prev));
  }

  function handleAcceptTag(tag: string) {
    setAppendText(`#${tag}`);
    setSuggestions((prev) => (prev ? { ...prev, tags: prev.tags.filter((t) => t !== tag) } : prev));
  }

  function handleGenerateDigest() {
    generateDigest.mutate(undefined, {
      onSuccess: (created) => setSelectedId(created.id),
      onError: () => actionToasts.show("Couldn't generate the digest — AI may be rate-limited or offline.", handleGenerateDigest, 'Retry'),
    });
  }

  function handleDelete(id: string) {
    deleteNote.mutate(id, {
      onSuccess: (res) => {
        if (selectedId === id) setSelectedId(null);
        showUndoToast(`"${id.split('/').pop()}" moved to trash.`, () => {
          void fetch(`/api/notes/trash/${encodeURIComponent(res.trashId)}/restore`, { method: 'POST' }).then(() => {
            setSelectedId(id);
          });
        });
      },
    });
  }

  function handleMove(fromId: string, toFolder: string) {
    const fileName = fromId.split('/').pop()!;
    const toPath = toFolder ? `${toFolder}/${fileName}` : fileName;
    if (toPath === fromId) return;
    moveNote.mutate(
      { from: fromId, path: toPath },
      {
        onSuccess: (updated) => {
          if (selectedId === fromId) setSelectedId(updated.id);
        },
      },
    );
  }

  function handleRename(id: string, newFileName: string) {
    const folder = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';
    handleMove(id, folder ? `${folder}/${newFileName}` : newFileName);
  }

  function handleLinkUnlinked(mentioningNoteId: string) {
    if (!note) return;
    fetch(`/api/notes/file/${encodeNotePath(mentioningNoteId)}`)
      .then((r) => r.json())
      .then((mentioning: { content: string; updatedAt: string | null }) => {
        const idx = mentioning.content.toLowerCase().indexOf(note.title.toLowerCase());
        if (idx < 0) return;
        const next = `${mentioning.content.slice(0, idx)}[[${note.title}]]${mentioning.content.slice(idx + note.title.length)}`;
        doSave(mentioningNoteId, next, mentioning.updatedAt);
      });
  }

  return (
    <div className={`second-brain h-full min-h-0 overflow-hidden p-3 sm:p-4 ${zenMode ? 'sb-zen-mode' : ''}`}>
      <div className="sb-mobile-tabs" role="tablist" aria-label="Second Brain workspace panels">
        <button type="button" role="tab" aria-selected={mobilePanel === 'library'} onClick={() => setMobilePanel('library')} className={mobilePanel === 'library' ? 'is-active' : ''}>
          Library
        </button>
        <button type="button" role="tab" aria-selected={mobilePanel === 'note'} onClick={() => setMobilePanel('note')} className={mobilePanel === 'note' ? 'is-active' : ''}>
          Note
        </button>
        <button type="button" role="tab" aria-selected={mobilePanel === 'insights'} onClick={() => setMobilePanel('insights')} className={mobilePanel === 'insights' ? 'is-active' : ''}>
          Insights
        </button>
      </div>
      <div className="sb-workspace">
      <aside className={`sb-panel sb-library min-h-0 ${mobilePanel === 'library' ? 'sb-panel-active' : 'sb-panel-hidden'}`}>
        <div className="sb-library-head">
          <div>
            <p className="sb-eyebrow">Workspace</p>
            <h1>Second Brain</h1>
          </div>
          <span className="sb-note-count" title={`${notes?.length ?? 0} notes in your vault`}>{notes?.length ?? 0}</span>
        </div>
        <div className="sb-library-actions">
          <button onClick={() => handleNewNote('')} className="sb-primary-action">
            <FilePlus2 size={15} /> New note
          </button>
          <button onClick={() => setShowSwitcher(true)} title="Open quick switcher (Ctrl/Cmd+P)" className="sb-search-action">
            <Search size={15} /> <span>Find a note</span><kbd>⌘P</kbd>
          </button>
        </div>
        <div className="mb-3 rounded-2xl border border-slate-200 bg-white/80 p-3 dark:border-neutral-800 dark:bg-neutral-900/70">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">
                  <Inbox size={15} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Inbox</p>
                  <p className="text-xs text-slate-500 dark:text-neutral-400">
                    {pendingInboxCount > 0 ? `${pendingInboxCount} notes waiting to be processed` : 'No pending captures right now'}
                  </p>
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowInboxTriage(true)}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Process
            </button>
          </div>
          {inboxNotes.length > 0 && (
            <div className="mt-3 space-y-2">
              {inboxNotes.slice(0, 3).map((inboxNote) => (
                <button
                  key={inboxNote.id}
                  onClick={() => setSelectedId(inboxNote.id)}
                  className="flex w-full items-start justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-left transition hover:border-teal-200 hover:bg-white dark:border-neutral-800 dark:bg-neutral-950/70 dark:hover:border-teal-900 dark:hover:bg-neutral-950"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-neutral-100">{inboxNote.title}</p>
                    <p className="truncate text-xs text-slate-400 dark:text-neutral-500">{inboxNote.id}</p>
                  </div>
                  {!inboxNote.processed && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">New</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mb-3">
          <OnThisDayCard data={onThisDay} onOpenNote={setSelectedId} />
        </div>
        <div className="sb-utility-row" aria-label="Vault tools">
          <button
            onClick={() => openDaily.mutate(undefined, { onSuccess: (created) => setSelectedId(created.id) })}
            title="Today's daily note (Ctrl/Cmd+D)"
            className="sb-icon-action"
          >
            <Sun size={13} />
          </button>
          <button
            onClick={() => setShowTemplatePicker(true)}
            title="New note from template"
            className="sb-icon-action"
          >
            <LayoutTemplate size={13} />
          </button>
          <button
            onClick={() => setShowGraph(true)}
            title="Graph view (Ctrl/Cmd+G)"
            className="sb-icon-action"
          >
            <Share2 size={13} />
          </button>
          <button
            onClick={() => setShowTasksHub(true)}
            title="Vault tasks hub"
            className="sb-icon-action"
          >
            <CheckSquare2 size={13} />
          </button>
          <button
            onClick={() => setShowStudyReview(true)}
            title="Daily review queue"
            className="sb-icon-action relative"
          >
            <BrainCircuit size={13} />
            {dueCards > 0 && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-semibold text-white">{dueCards}</span>}
          </button>
          <button
            onClick={handleGenerateDigest}
            disabled={generateDigest.isPending}
            title="Generate this week's digest"
            className="sb-icon-action disabled:opacity-50"
          >
            <BookOpenText size={13} className={generateDigest.isPending ? 'animate-pulse' : ''} />
          </button>
          <button
            onClick={() => setShowChat(true)}
            title="Vault chat"
            className="sb-icon-action"
          >
            <MessageCircle size={13} />
          </button>
          <button onClick={() => setShowDrivePicker(true)} title="Insert or import a Google Drive file (Ctrl/Cmd+Shift+D)" className="sb-icon-action">
            <Link2 size={13} />
          </button>
        </div>
        <NoteTree
          notes={notes ?? []}
          selectedId={selectedId}
          recentIds={recentIds}
          onSelect={setSelectedId}
          onDelete={handleDelete}
          onRename={handleRename}
          onMove={handleMove}
          onNewNote={handleNewNote}
          onTogglePin={handleTogglePin}
        />
        <div className="sb-library-footer">
          <button onClick={() => setShowTrash(true)} title="Trash" className="sb-footer-action">
            <Trash2 size={12} /> Trash
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => reindex.mutate()} title="Reindex vault" className="sb-footer-icon">
              <RefreshCw size={12} className={reindex.isPending ? 'animate-spin' : ''} />
            </button>
            <a href="/api/notes/vault.zip" title="Download vault as .zip" className="sb-footer-icon">
              <Download size={12} />
            </a>
          </div>
        </div>
      </aside>

      <main className={`sb-panel sb-editor min-h-0 min-w-0 ${mobilePanel === 'note' ? 'sb-panel-active' : 'sb-panel-hidden'}`}>
        {isLoading && <div className="text-sm text-slate-400 dark:text-neutral-500">Loading…</div>}
        {!selectedId && !isLoading && (
          <div className="sb-empty-state">
            <span className="sb-empty-mark">✦</span>
            <p className="sb-eyebrow">A blank page is a beginning</p>
            <h2>No note open</h2>
            <p>Capture an idea, make a connection, or pick up where you left off.</p>
            <button onClick={() => handleNewNote('')} className="sb-primary-action">
              <FilePlus2 size={15} /> Create a note
            </button>
            <button onClick={() => setShowSwitcher(true)} className="sb-text-action">Browse your vault <kbd>⌘P</kbd></button>
          </div>
        )}
        {note && (
          <>
            <div className="sb-note-head">
              <div className="min-w-0">
                <p className="sb-eyebrow">{note.id.replace(/\.md$/i, '').split('/').join(' / ')}</p>
                <h2 className="truncate">{note.title}</h2>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setChatScope({ ids: [note.id], message: `Remember this note as important context for me: ${note.title}` });
                    setShowChat(true);
                  }}
                  className="rounded-full border border-amber-200 bg-amber-50/60 px-3 py-1 text-xs text-amber-800 hover:bg-amber-50 dark:border-amber-500/20 dark:bg-amber-950/10 dark:text-amber-300"
                  title="Store this as an approved memory with the note as evidence"
                >
                  <Brain size={12} className="mr-1 inline-block" /> Remember
                </button>
                <button onClick={() => setShowLinkedInDraft(true)} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-white dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-950">
                  <PenSquare size={12} className="mr-1 inline-block" /> Draft
                </button>
                <button onClick={() => setShowPublish(true)} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-white dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-950">
                  <Globe2 size={12} className="mr-1 inline-block" /> Publish
                </button>
                <button onClick={() => setShowVersionHistory(true)} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-white dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-950">
                  <History size={12} className="mr-1 inline-block" /> History
                </button>
                <button onClick={() => setZenMode((value) => !value)} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-white dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-950">
                  {zenMode ? 'Exit zen' : 'Zen'}
                </button>
                <button onClick={() => setVimMode((value) => !value)} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-white dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-950">
                  {vimMode ? 'Vim on' : 'Vim off'}
                </button>
                <button onClick={() => setShowExport(true)} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-white dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-950">
                  <FileOutput size={12} className="mr-1 inline-block" /> Export
                </button>
                <span className={`sb-save-state ${saveState}`}>
                  {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : ''}
                </span>
              </div>
            </div>
            <div className="h-[calc(100%-4.75rem)]">
              <NoteEditor
                note={note}
                allNotes={notes ?? []}
                onChange={handleContentChange}
                onNavigate={setSelectedId}
                onCreateAndOpen={handleCreateAndOpen}
                onOpenDrivePicker={() => setShowDrivePicker(true)}
                appendText={appendText}
                onAppended={() => setAppendText(null)}
                vimModeEnabled={vimMode}
              />
            </div>
          </>
        )}
      </main>

      <aside className={`sb-panel sb-insights min-h-0 overflow-auto ${mobilePanel === 'insights' ? 'sb-panel-active' : 'sb-panel-hidden'}`}>
        <div className="sb-insights-head">
          <p className="sb-eyebrow">Workspace</p>
          <h2>Note insights</h2>
        </div>
        {note ? (
          <BacklinksPanel
            note={note}
            onNavigate={setSelectedId}
            onLinkUnlinked={handleLinkUnlinked}
            relatedNotes={relatedNotes ?? []}
            suggestions={suggestions}
            suggestLoading={suggest.isPending}
            onRequestSuggestions={handleRequestSuggestions}
            onAcceptLink={handleAcceptLink}
            onAcceptTag={handleAcceptTag}
            onDismissSuggestions={() => setSuggestions(null)}
          />
        ) : (
          <p className="sb-empty-copy">Open a note to see its backlinks, tags, and related ideas.</p>
        )}
      </aside>

      </div>

      {showSwitcher && (
        <QuickSwitcher
          notes={notes ?? []}
          onSelect={(id) => setSelectedId(id)}
          onCreate={handleCreateAndOpen}
          onClose={() => setShowSwitcher(false)}
        />
      )}
      {showSearch && <NoteSearchModal onSelect={setSelectedId} onClose={() => setShowSearch(false)} />}
      {showTrash && <TrashPanel onClose={() => setShowTrash(false)} />}
      {showTemplatePicker && <TemplatePicker templates={templates ?? []} onCreate={handleCreateFromTemplate} onClose={() => setShowTemplatePicker(false)} />}
      {showGraph && graph && (
        <GraphView
          graph={graph}
          onNavigate={handleGraphNavigate}
          onClose={() => {
            setShowGraph(false);
            setGraphFocusIds(undefined);
          }}
          focusIds={graphFocusIds}
          onClearFocus={() => setGraphFocusIds(undefined)}
          currentNoteId={selectedId}
          onChatScope={(ids, message) => {
            setChatScope({ ids, message });
            setGraphFocusIds(ids);
            setShowChat(true);
          }}
        />
      )}
      {showChat && (
        <ChatPanel
          onNavigate={setSelectedId}
          onClose={() => {
            setShowChat(false);
            setChatScope(null);
          }}
          initialFocusNoteIds={chatScope?.ids}
          initialMessage={chatScope?.message}
          onShowOnGraph={(ids) => {
            setGraphFocusIds(ids);
            setShowGraph(true);
          }}
        />
      )}
      {showDrivePicker && (
        <DrivePicker
          onClose={() => setShowDrivePicker(false)}
          onInsert={(markdown) => setAppendText(markdown)}
          onImported={(id) => setSelectedId(id)}
        />
      )}
      {showInboxTriage && (
        <InboxTriageModal
          notes={inboxNotes}
          onClose={() => setShowInboxTriage(false)}
          onApplied={(noteId) => setSelectedId(noteId)}
        />
      )}
      {showTasksHub && <TasksHubModal onClose={() => setShowTasksHub(false)} onOpenNote={(id) => { setSelectedId(id); setShowTasksHub(false); }} />}
      {showStudyReview && <StudyReviewModal onClose={() => setShowStudyReview(false)} onOpenNote={(id) => { setSelectedId(id); setShowStudyReview(false); }} />}
      {showExport && note && <ExportModal noteId={note.id} onClose={() => setShowExport(false)} />}
      {showLinkedInDraft && note && <DraftLinkedInModal noteId={note.id} onClose={() => setShowLinkedInDraft(false)} onCreated={setSelectedId} />}
      {showPublish && note && <PublishNoteModal noteId={note.id} onClose={() => setShowPublish(false)} />}
      {showVersionHistory && note && <VersionHistoryModal noteId={note.id} currentContent={note.content} onClose={() => setShowVersionHistory(false)} />}

      {conflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
            <h3 className="mb-1 font-semibold text-slate-900 dark:text-neutral-100">This note changed elsewhere</h3>
            <p className="mb-3 text-sm text-slate-500 dark:text-neutral-400">Someone (or another tab) saved a newer version. Review both and pick one.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-slate-400">Your version</p>
                <textarea readOnly dir="auto" value={conflict.mine} className="h-64 w-full rounded-md border border-slate-200 p-2 font-mono text-xs dark:border-neutral-800 dark:bg-neutral-950" />
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-slate-400">Their version</p>
                <textarea readOnly dir="auto" value={conflict.theirs} className="h-64 w-full rounded-md border border-slate-200 p-2 font-mono text-xs dark:border-neutral-800 dark:bg-neutral-950" />
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => {
                  if (note) doSave(note.id, conflict.theirs, null);
                  setConflict(null);
                }}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm dark:border-neutral-700"
              >
                Discard mine, keep theirs
              </button>
              <button
                onClick={() => {
                  if (note) doSave(note.id, conflict.mine, null);
                  setConflict(null);
                }}
                className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white"
              >
                Keep mine (overwrite)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
