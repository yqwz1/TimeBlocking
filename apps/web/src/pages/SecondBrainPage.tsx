import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  BookOpenText,
  Bookmark,
  Brain,
  BrainCircuit,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileOutput,
  FilePlus2,
  Focus,
  Globe2,
  History,
  Inbox,
  LayoutTemplate,
  Link2,
  MessageCircle,
  MoreHorizontal,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PenSquare,
  RefreshCw,
  Search,
  Share2,
  SlidersHorizontal,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import type { NoteSuggestionsDTO, NoteSummaryDTO } from '@timeblock/shared';
import { useLocation } from 'react-router-dom';
import { useSettings } from '../hooks.js';
import {
  encodeNotePath,
  NoteConflictError,
  useCreateNote,
  useCreateNoteFolder,
  useCreateNoteFromTemplate,
  useDeleteNote,
  useDraftLinkedInPost,
  useGenerateDigest,
  useInboxNotes,
  useMoveNote,
  useNote,
  useOnThisDay,
  useNoteGraph,
  useNoteFolders,
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
  useToggleNoteBookmark,
  useUpdateNoteAppearance,
} from '../hooks/notes.js';
import { actionToasts, showUndoToast } from '../lib/actionToast.js';
import { useCommandPaletteScope } from '../lib/commandPalette.js';
import { getRecentNoteIds, recordNoteOpened } from '../lib/recentNotes.js';
import NoteTree from '../components/notes/NoteTree.js';
import { NoteAppearancePicker } from '../components/notes/noteAppearance.js';
import NoteEditor, { type NoteEditorHandle } from '../components/notes/NoteEditor.js';
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

function readPanelWidth(key: string, fallback: number): number {
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) ? Math.min(420, Math.max(208, value)) : fallback;
}

function readPanelVisibility(key: string, fallback: boolean): boolean {
  const value = window.localStorage.getItem(key);
  return value === null ? fallback : value === 'true';
}

const NOTE_TABS_STORAGE_KEY = 'second-brain.note-tabs';
const MAX_NOTE_HISTORY = 50;

interface NoteTabsSnapshot {
  openIds: string[];
  activeId: string | null;
  history: string[];
  historyIndex: number;
}

function uniqueNoteIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function readNoteTabsSnapshot(): NoteTabsSnapshot {
  try {
    const value = JSON.parse(window.localStorage.getItem(NOTE_TABS_STORAGE_KEY) || '{}') as Partial<NoteTabsSnapshot>;
    const openIds = uniqueNoteIds(Array.isArray(value.openIds) ? value.openIds.filter((id): id is string => typeof id === 'string') : []);
    const history = Array.isArray(value.history) ? value.history.filter((id): id is string => typeof id === 'string') : [];
    const historyIndex = Number.isInteger(value.historyIndex) ? Math.min(Math.max(value.historyIndex as number, 0), Math.max(history.length - 1, 0)) : Math.max(history.length - 1, 0);
    return { openIds, activeId: typeof value.activeId === 'string' ? value.activeId : null, history, historyIndex };
  } catch {
    return { openIds: [], activeId: null, history: [], historyIndex: 0 };
  }
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
  const { data: folders = [] } = useNoteFolders();
  const initialTabs = useRef(readNoteTabsSnapshot());
  const initialUrlNoteId = new URLSearchParams(window.location.search).get('note');
  const initialSelectedId = initialUrlNoteId || initialTabs.current.activeId || initialTabs.current.openIds[0] || null;
  const [openTabIds, setOpenTabIds] = useState<string[]>(() => uniqueNoteIds([...initialTabs.current.openIds, ...(initialSelectedId ? [initialSelectedId] : [])]));
  const [selectedId, setSelectedIdRaw] = useState<string | null>(() => initialSelectedId);
  const [noteHistory, setNoteHistory] = useState(() => ({
    entries: initialTabs.current.history.length ? initialTabs.current.history : (initialSelectedId ? [initialSelectedId] : []),
    index: initialTabs.current.history.length ? initialTabs.current.historyIndex : 0,
  }));
  const shouldOpenInitialNote = useRef(!initialUrlNoteId && !initialTabs.current.activeId && initialTabs.current.openIds.length === 0);
  const { data: note, isLoading } = useNote(selectedId);
  const createNote = useCreateNote();
  const createFolder = useCreateNoteFolder();
  const createFromTemplate = useCreateNoteFromTemplate();
  const saveNote = useSaveNote();
  const deleteNote = useDeleteNote();
  const moveNote = useMoveNote();
  const reindex = useReindexNotes();
  const togglePin = useToggleNotePin();
  const toggleBookmark = useToggleNoteBookmark();
  const updateAppearance = useUpdateNoteAppearance();
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
  const [libraryOpen, setLibraryOpen] = useState(() => readPanelVisibility('second-brain.library-open', true));
  const [insightsOpen, setInsightsOpen] = useState(() => readPanelVisibility('second-brain.insights-open', false));
  const [libraryWidth, setLibraryWidth] = useState(() => readPanelWidth('second-brain.library-width', 260));
  const [insightsWidth, setInsightsWidth] = useState(() => readPanelWidth('second-brain.insights-width', 288));
  const [zenMode, setZenMode] = useState(false);
  const [workspaceFocus, setWorkspaceFocus] = useState(false);
  const [vimMode, setVimMode] = useState(false);
  const [editorMode, setEditorMode] = useState<'live' | 'source' | 'reading'>(() => new URLSearchParams(window.location.search).get('view') === 'reading' ? 'reading' : 'live');
  const [openNoteMenu, setOpenNoteMenu] = useState<'appearance' | 'more' | null>(null);
  const [pendingEditorAction, setPendingEditorAction] = useState<'find' | 'replace' | 'addProperty' | null>(null);
  const [conflict, setConflict] = useState<{ mine: string; theirs: string } | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [recentIds, setRecentIds] = useState<string[]>(() => getRecentNoteIds());
  const [suggestions, setSuggestions] = useState<NoteSuggestionsDTO | null>(null);
  const [appendText, setAppendText] = useState<string | null>(null);
  const editorRef = useRef<NoteEditorHandle | null>(null);
  const appearanceMenuRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const appearanceButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContent = useRef<string | null>(null);
  const resizeSession = useRef<{ side: 'library' | 'insights'; startX: number; startWidth: number } | null>(null);
  const { data: graph } = useNoteGraph(showGraph);
  const pendingInboxNotes = inboxNotes.filter((item) => !item.processed);
  const pendingInboxCount = pendingInboxNotes.length;
  const dueCards = studyQueue?.dueToday ?? 0;
  const openTabs = useMemo(() => {
    const notesById = new Map((notes ?? []).map((item) => [item.id, item]));
    return openTabIds.map((id) => ({
      id,
      title: notesById.get(id)?.title || id.split('/').pop()?.replace(/\.md$/i, '') || 'Untitled note',
    }));
  }, [notes, openTabIds]);

  const setSelectedId = useCallback((id: string | null, historyMode: 'push' | 'skip' = 'push') => {
    setSelectedIdRaw(id);
    setSuggestions(null);
    setMobilePanel('note');
    if (id) {
      setOpenTabIds((current) => (current.includes(id) ? current : [...current, id]));
      if (historyMode === 'push') {
        setNoteHistory((current) => {
          const entries = current.entries.slice(0, current.index + 1);
          if (entries[entries.length - 1] === id) return current;
          const nextEntries = [...entries, id].slice(-MAX_NOTE_HISTORY);
          return { entries: nextEntries, index: nextEntries.length - 1 };
        });
      }
      recordNoteOpened(id);
      setRecentIds(getRecentNoteIds());
    }
  }, []);

  const closeNoteTab = useCallback((id: string) => {
    const index = openTabIds.indexOf(id);
    if (index < 0) return;
    const nextTabs = openTabIds.filter((tabId) => tabId !== id);
    const nextSelectedId = selectedId === id ? (nextTabs[index] ?? nextTabs[index - 1] ?? null) : selectedId;
    setOpenTabIds(nextTabs);
    setNoteHistory((current) => {
      const entries = current.entries.filter((entry) => entry !== id);
      const nextIndex = nextSelectedId ? entries.lastIndexOf(nextSelectedId) : -1;
      return { entries, index: nextIndex >= 0 ? nextIndex : Math.max(0, entries.length - 1) };
    });
    if (selectedId === id) {
      setSelectedIdRaw(nextSelectedId);
      setSuggestions(null);
      if (nextSelectedId) {
        recordNoteOpened(nextSelectedId);
        setRecentIds(getRecentNoteIds());
      }
    }
  }, [openTabIds, selectedId]);

  const goNoteHistory = useCallback((direction: -1 | 1) => {
    const nextIndex = noteHistory.index + direction;
    const id = noteHistory.entries[nextIndex];
    if (!id) return;
    setNoteHistory((current) => ({ ...current, index: nextIndex }));
    setSelectedId(id, 'skip');
  }, [noteHistory, setSelectedId]);

  const replaceNoteId = useCallback((fromId: string, toId: string) => {
    setOpenTabIds((current) => uniqueNoteIds(current.map((id) => (id === fromId ? toId : id))));
    setNoteHistory((current) => ({ ...current, entries: current.entries.map((id) => (id === fromId ? toId : id)) }));
    if (selectedId === fromId) setSelectedId(toId, 'skip');
  }, [selectedId, setSelectedId]);

  useEffect(() => {
    if (!settings) return;
    setZenMode(settings.notesZenModeDefault);
    setVimMode(settings.notesVimModeDefault);
  }, [settings]);

  useEffect(() => {
    setOpenNoteMenu(null);
  }, [selectedId]);

  useEffect(() => {
    if (!openNoteMenu) return;
    const activeMenuRef = openNoteMenu === 'appearance' ? appearanceMenuRef : moreMenuRef;
    const activeButtonRef = openNoteMenu === 'appearance' ? appearanceButtonRef : moreButtonRef;
    const dismiss = (event: PointerEvent) => {
      if (!activeMenuRef.current?.contains(event.target as Node)) setOpenNoteMenu(null);
    };
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenNoteMenu(null);
      activeButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', dismissWithKeyboard);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', dismissWithKeyboard);
    };
  }, [openNoteMenu]);

  useEffect(() => {
    if (!pendingEditorAction || editorMode === 'reading') return;
    let frame = 0;
    let attempts = 0;
    const runWhenReady = () => {
      if (!editorRef.current?.isReady() && attempts < 12) {
        attempts += 1;
        frame = window.requestAnimationFrame(runWhenReady);
        return;
      }
      if (editorRef.current?.isReady()) editorRef.current[pendingEditorAction]();
      setPendingEditorAction(null);
    };
    frame = window.requestAnimationFrame(runWhenReady);
    return () => window.cancelAnimationFrame(frame);
  }, [editorMode, pendingEditorAction]);

  useEffect(() => {
    window.localStorage.setItem('second-brain.library-open', String(libraryOpen));
    window.localStorage.setItem('second-brain.insights-open', String(insightsOpen));
    window.localStorage.setItem('second-brain.library-width', String(libraryWidth));
    window.localStorage.setItem('second-brain.insights-width', String(insightsWidth));
  }, [insightsOpen, insightsWidth, libraryOpen, libraryWidth]);

  useEffect(() => {
    window.localStorage.setItem(NOTE_TABS_STORAGE_KEY, JSON.stringify({
      openIds: openTabIds,
      activeId: selectedId,
      history: noteHistory.entries,
      historyIndex: noteHistory.index,
    } satisfies NoteTabsSnapshot));
  }, [noteHistory, openTabIds, selectedId]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextId = params.get('note');
    const nextGraph = params.get('graph') === '1';
    const nextEditorMode = params.get('view') === 'reading' ? 'reading' : 'live';
    setSelectedIdRaw((current) => (current === nextId ? current : nextId));
    if (nextId) setOpenTabIds((current) => (current.includes(nextId) ? current : [...current, nextId]));
    setShowGraph((current) => (current === nextGraph ? current : nextGraph));
    setEditorMode((current) => (current === nextEditorMode ? current : nextEditorMode));
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
    if (!notes) return;
    const validIds = new Set(notes.map((item) => item.id));
    const validTabs = openTabIds.filter((id) => validIds.has(id));
    if (validTabs.length !== openTabIds.length) setOpenTabIds(validTabs);
    if (selectedId && !validIds.has(selectedId)) {
      const fallback = validTabs[0] ?? null;
      setSelectedIdRaw(fallback);
      setNoteHistory((current) => {
        const entries = current.entries.filter((id) => validIds.has(id));
        return { entries, index: fallback ? Math.max(0, entries.lastIndexOf(fallback)) : 0 };
      });
      return;
    }
    if (shouldOpenInitialNote.current && notes.length > 0 && !selectedId) {
      shouldOpenInitialNote.current = false;
      setSelectedId(notes[0].id);
    }
  }, [notes, openTabIds, selectedId, setSelectedId]);

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
              { id: 'note-fullscreen-focus', title: 'Fullscreen focus', subtitle: 'Enter a distraction-free fullscreen writing mode', shortcut: 'Ctrl+Shift+F11', keywords: ['fullscreen focus writing'], run: () => void toggleFullscreenFocus() },
              { id: 'note-workspace-focus', title: workspaceFocus ? 'Exit workspace focus' : 'Workspace focus', subtitle: 'Hide the left and right note panels', shortcut: 'Ctrl+F11', keywords: ['workspace fullscreen focus sidebars'], run: () => setWorkspaceFocus((value) => !value) },
              { id: 'note-vim', title: vimMode ? 'Disable Vim mode' : 'Enable Vim mode', subtitle: 'Toggle Vim-style editor keys', keywords: ['vim keyboard normal insert'], run: () => setVimMode((value) => !value) },
            ]
          : []),
      ],
    [note, openDaily, setSelectedId, vimMode, workspaceFocus, zenMode],
  );
  useCommandPaletteScope(commandPaletteCommands);

  async function toggleFullscreenFocus() {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    setZenMode(true);
    await document.documentElement.requestFullscreen().catch(() => undefined);
  }

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setZenMode(false);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

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
      } else if (mod && e.key === 'ArrowLeft') {
        e.preventDefault();
        goNoteHistory(-1);
      } else if (mod && e.key === 'ArrowRight') {
        e.preventDefault();
        goNoteHistory(1);
      } else if (mod && e.key.toLowerCase() === 'w' && selectedId) {
        e.preventDefault();
        closeNoteTab(selectedId);
      } else if (e.ctrlKey && e.shiftKey && e.key === 'F11') {
        e.preventDefault();
        void toggleFullscreenFocus();
      } else if (e.ctrlKey && e.key === 'F11') {
        e.preventDefault();
        setWorkspaceFocus((value) => !value);
      } else if (e.key === 'Escape' && showGraph) {
        setShowGraph(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeNoteTab, goNoteHistory, selectedId, showGraph]);

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

  function handleNewFolder(parentFolder: string) {
    const name = window.prompt('Folder name');
    if (!name?.trim()) return;
    const path = parentFolder ? `${parentFolder}/${name}` : name;
    createFolder.mutate({ path });
  }

  function handleNewProject(parentFolder: string) {
    const name = window.prompt('Project name');
    if (!name?.trim()) return;
    const safeName = name.trim().replace(/[\\/]/g, '-');
    const folder = parentFolder ? `${parentFolder}/${safeName}` : safeName;
    createFolder.mutate(
      { path: folder },
      {
        onSuccess: (createdFolder) => {
          const path = `${createdFolder.path}/Project Overview.md`;
          createNote.mutate(
            {
              path,
              content: `---\ntype: project\nstatus: active\n---\n\n# ${safeName}\n\n## Outcome\n\nDescribe the result this project should create.\n\n## Next actions\n\n- [ ] Define the next concrete step\n\n## Notes\n\n`,
            },
            { onSuccess: (project) => setSelectedId(project.id) },
          );
        },
      },
    );
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
        closeNoteTab(id);
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
          replaceNoteId(fromId, updated.id);
        },
      },
    );
  }

  function handleRename(id: string, newFileName: string) {
    const folder = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';
    handleMove(id, folder ? `${folder}/${newFileName}` : newFileName);
  }

  function handleRenameOpenNote() {
    if (!note) return;
    const currentName = note.id.split('/').pop()!.replace(/\.md$/i, '');
    const nextName = window.prompt('Rename note', currentName)?.trim();
    if (!nextName || nextName === currentName) return;
    handleRename(note.id, nextName.endsWith('.md') ? nextName : `${nextName}.md`);
  }

  function handleMoveOpenNote() {
    if (!note) return;
    const currentFolder = note.id.includes('/') ? note.id.slice(0, note.id.lastIndexOf('/')) : '';
    const nextFolder = window.prompt('Move note to folder (leave blank for vault root)', currentFolder);
    if (nextFolder === null) return;
    handleMove(note.id, nextFolder.trim().replace(/^[/\\]+|[/\\]+$/g, ''));
  }

  async function handleCopyNotePath() {
    if (!note) return;
    try {
      await navigator.clipboard.writeText(note.id);
    } catch {
      window.prompt('Copy this note path', note.id);
    }
  }

  function runEditorAction(action: 'find' | 'replace' | 'addProperty') {
    if (editorMode === 'reading') {
      setPendingEditorAction(action);
      setEditorMode('live');
      return;
    }
    editorRef.current?.[action]();
  }

  function runNoteMenuAction(action: () => void) {
    setOpenNoteMenu(null);
    action();
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

  function beginPanelResize(side: 'library' | 'insights', event: ReactPointerEvent<HTMLButtonElement>) {
    resizeSession.current = {
      side,
      startX: event.clientX,
      startWidth: side === 'library' ? libraryWidth : insightsWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add('sb-is-resizing');
  }

  function resizePanel(event: ReactPointerEvent<HTMLButtonElement>) {
    const session = resizeSession.current;
    if (!session) return;
    const delta = event.clientX - session.startX;
    const next = session.side === 'library' ? session.startWidth + delta : session.startWidth - delta;
    const width = Math.min(420, Math.max(208, Math.round(next)));
    if (session.side === 'library') setLibraryWidth(width);
    else setInsightsWidth(width);
  }

  function endPanelResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    resizeSession.current = null;
    document.body.classList.remove('sb-is-resizing');
  }

  const workspaceStyle = {
    '--sb-library-width': `${libraryWidth}px`,
    '--sb-insights-width': `${insightsWidth}px`,
  } as CSSProperties;

  return (
    <div className={`second-brain flex h-full min-h-0 flex-col overflow-hidden ${zenMode ? 'sb-zen-mode' : ''} ${workspaceFocus ? 'sb-workspace-focus' : ''}`}>
      <header className="sb-topbar">
        <div className="sb-topbar-group">
          <button
            type="button"
            onClick={() => setLibraryOpen((value) => !value)}
            className="sb-topbar-icon"
            aria-label={libraryOpen ? 'Hide note library' : 'Show note library'}
            aria-pressed={libraryOpen}
            title={libraryOpen ? 'Hide note library' : 'Show note library'}
          >
            {libraryOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <div className="sb-page-identity">
            <BrainCircuit size={15} aria-hidden="true" />
            <span>Second Brain</span>
            <span className="sb-note-count" title={`${notes?.length ?? 0} notes in your vault`}>{notes?.length ?? 0}</span>
          </div>
        </div>
        <div className="sb-topbar-group sb-topbar-actions">
          <button type="button" onClick={() => setShowSwitcher(true)} className="sb-topbar-action" title="Find a note (Ctrl/Cmd+P)">
            <Search size={14} /> <span>Find</span><kbd>⌘P</kbd>
          </button>
          <button type="button" onClick={() => setShowGraph(true)} className="sb-topbar-action" title="Open graph map (Ctrl/Cmd+G)">
            <Share2 size={14} /> <span>Map</span>
          </button>
          <button type="button" onClick={() => handleNewNote('')} className="sb-create-action">
            <FilePlus2 size={14} /> <span>New note</span>
          </button>
          <button
            type="button"
            onClick={() => setInsightsOpen((value) => !value)}
            className="sb-topbar-icon"
            aria-label={insightsOpen ? 'Hide note connections' : 'Show note connections'}
            aria-pressed={insightsOpen}
            title={insightsOpen ? 'Hide note connections' : 'Show note connections'}
          >
            {insightsOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </div>
      </header>

      <div className="sb-note-tabs-bar">
        <div className="sb-note-history" aria-label="Note navigation history">
          <button
            type="button"
            onClick={() => goNoteHistory(-1)}
            disabled={noteHistory.index <= 0}
            aria-label="Go back to the previous note"
            title="Back (Ctrl/Cmd+Left)"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            onClick={() => goNoteHistory(1)}
            disabled={noteHistory.index >= noteHistory.entries.length - 1}
            aria-label="Go forward to the next note"
            title="Forward (Ctrl/Cmd+Right)"
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="sb-note-tablist" role="tablist" aria-label="Open notes">
          {openTabs.map((tab) => (
            <div key={tab.id} className={`sb-note-tab${tab.id === selectedId ? ' is-active' : ''}`}>
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === selectedId}
                onClick={() => setSelectedId(tab.id)}
                title={tab.title}
                className="sb-note-tab-select"
              >
                <span>{tab.title}</span>
              </button>
              <button
                type="button"
                onClick={() => closeNoteTab(tab.id)}
                className="sb-note-tab-close"
                aria-label={`Close ${tab.title}`}
                title={`Close ${tab.title} (Ctrl/Cmd+W)`}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="sb-mobile-tabs" role="tablist" aria-label="Second Brain workspace panels">
        <button type="button" role="tab" aria-selected={mobilePanel === 'library'} onClick={() => setMobilePanel('library')} className={mobilePanel === 'library' ? 'is-active' : ''}>
          Notes
        </button>
        <button type="button" role="tab" aria-selected={mobilePanel === 'note'} onClick={() => setMobilePanel('note')} className={mobilePanel === 'note' ? 'is-active' : ''}>
          Editor
        </button>
        <button type="button" role="tab" aria-selected={mobilePanel === 'insights'} onClick={() => setMobilePanel('insights')} className={mobilePanel === 'insights' ? 'is-active' : ''}>
          Links
        </button>
      </div>
      <div
        className={`sb-workspace ${libraryOpen ? '' : 'sb-library-collapsed'} ${insightsOpen ? '' : 'sb-insights-collapsed'}`}
        style={workspaceStyle}
      >
      <aside
        className={`sb-panel sb-library min-h-0 ${mobilePanel === 'library' ? 'sb-panel-active' : 'sb-panel-hidden'}`}
        aria-label="Note library"
      >
        <div className="sb-library-head">
          <div>
            <p className="sb-eyebrow">Library</p>
            <h1>Your notes</h1>
          </div>
          <button
            type="button"
            onClick={() => setLibraryOpen(false)}
            className="sb-panel-close"
            aria-label="Hide note library"
            title="Hide note library"
          >
            <PanelLeftClose size={14} />
          </button>
        </div>
        <div className="sb-library-actions">
          <button onClick={() => setShowSwitcher(true)} title="Open quick switcher (Ctrl/Cmd+P)" className="sb-search-action">
            <Search size={14} /> <span>Find a note</span><kbd>⌘P</kbd>
          </button>
        </div>
        <div className="sb-library-disclosures">
          <details className="sb-disclosure">
            <summary>
              <span><Inbox size={13} /> Inbox</span>
              <span className={pendingInboxCount > 0 ? 'sb-status-count is-warm' : 'sb-status-count'}>{pendingInboxCount}</span>
            </summary>
            <div className="sb-disclosure-body">
              <div className="sb-disclosure-intro">
                <span>{pendingInboxCount > 0 ? 'Captured notes waiting for you.' : 'Your inbox is clear.'}</span>
                <button type="button" onClick={() => setShowInboxTriage(true)}>Process</button>
              </div>
              {inboxNotes.slice(0, 3).map((inboxNote) => (
                <button key={inboxNote.id} type="button" onClick={() => setSelectedId(inboxNote.id)} className="sb-inbox-row">
                  <span className="truncate">{inboxNote.title}</span>
                  {!inboxNote.processed && <span className="sb-row-dot" aria-label="Unprocessed" />}
                </button>
              ))}
            </div>
          </details>

          <details className="sb-disclosure">
            <summary>
              <span><History size={13} /> On this day</span>
              <span className="sb-disclosure-hint">Review</span>
            </summary>
            <div className="sb-disclosure-body">
              <OnThisDayCard data={onThisDay} onOpenNote={setSelectedId} embedded />
            </div>
          </details>

          <details className="sb-disclosure">
            <summary>
              <span><SlidersHorizontal size={13} /> Tools</span>
              <span className="sb-disclosure-hint">8</span>
            </summary>
            <div className="sb-tool-grid" aria-label="Vault tools">
              <button type="button" onClick={() => openDaily.mutate(undefined, { onSuccess: (created) => setSelectedId(created.id) })}>
                <Sun size={13} /><span>Today</span>
              </button>
              <button type="button" onClick={() => setShowTemplatePicker(true)}>
                <LayoutTemplate size={13} /><span>Template</span>
              </button>
              <button type="button" onClick={() => setShowTasksHub(true)}>
                <CheckSquare2 size={13} /><span>Tasks</span>
              </button>
              <button type="button" onClick={() => setShowStudyReview(true)} className="relative">
                <BrainCircuit size={13} /><span>Review</span>
                {dueCards > 0 && <span className="sb-tool-badge">{dueCards}</span>}
              </button>
              <button type="button" onClick={handleGenerateDigest} disabled={generateDigest.isPending}>
                <BookOpenText size={13} className={generateDigest.isPending ? 'animate-pulse' : ''} /><span>Digest</span>
              </button>
              <button type="button" onClick={() => setShowChat(true)}>
                <MessageCircle size={13} /><span>Ask</span>
              </button>
              <button type="button" onClick={() => setShowDrivePicker(true)}>
                <Link2 size={13} /><span>Drive</span>
              </button>
              <button type="button" onClick={() => setShowTrash(true)}>
                <Trash2 size={13} /><span>Trash</span>
              </button>
            </div>
          </details>
        </div>
        <NoteTree
          notes={notes ?? []}
          folders={folders}
          selectedId={selectedId}
          recentIds={recentIds}
          onSelect={setSelectedId}
          onDelete={handleDelete}
          onRename={handleRename}
          onMove={handleMove}
          onNewNote={handleNewNote}
          onNewFolder={handleNewFolder}
          onNewProject={handleNewProject}
          onTogglePin={handleTogglePin}
        />
        <div className="sb-library-footer">
          <span className="sb-footer-label">Local vault</span>
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

      <button
        type="button"
        className="sb-resizer sb-resizer-library"
        aria-label="Resize note library"
        title="Drag to resize the note library"
        tabIndex={libraryOpen ? 0 : -1}
        onPointerDown={(event) => beginPanelResize('library', event)}
        onPointerMove={resizePanel}
        onPointerUp={endPanelResize}
        onPointerCancel={endPanelResize}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') setLibraryWidth((width) => Math.max(208, width - 12));
          if (event.key === 'ArrowRight') setLibraryWidth((width) => Math.min(420, width + 12));
        }}
      />

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
              <div className="sb-note-actions">
                {saveState !== 'idle' && (
                  <span className={`sb-save-state ${saveState}`}>
                    {saveState === 'saving' ? 'Saving…' : 'Saved'}
                  </span>
                )}
                <div className="sb-note-view-switch" role="group" aria-label="Note view">
                  <button type="button" className={editorMode !== 'reading' ? 'is-active' : ''} aria-pressed={editorMode !== 'reading'} onClick={() => setEditorMode('live')} title="Edit note">
                    <PenSquare size={13} /><span>Edit</span>
                  </button>
                  <button type="button" className={editorMode === 'reading' ? 'is-active' : ''} aria-pressed={editorMode === 'reading'} onClick={() => setEditorMode('reading')} title="Read note">
                    <BookOpenText size={13} /><span>Read</span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOpenNoteMenu(null);
                    setChatScope({ ids: [note.id], message: '' });
                    setShowChat(true);
                  }}
                  className="sb-note-action"
                  title="Ask questions using this note as context"
                >
                  <MessageCircle size={13} /><span>Ask</span>
                </button>
                <button type="button" onClick={() => { setOpenNoteMenu(null); toggleBookmark.mutate(note.id); }} disabled={toggleBookmark.isPending} className={`sb-note-action ${note.bookmark ? 'is-active' : ''}`} title={note.bookmark ? 'Remove bookmark' : 'Bookmark this note'}>
                  <Bookmark size={13} fill={note.bookmark ? 'currentColor' : 'none'} /><span>{note.bookmark ? 'Bookmarked' : 'Bookmark'}</span>
                </button>
                <div ref={appearanceMenuRef} className="sb-note-actions-menu">
                  <button
                    ref={appearanceButtonRef}
                    type="button"
                    className="sb-note-action"
                    aria-label="Change note appearance"
                    aria-haspopup="dialog"
                    aria-expanded={openNoteMenu === 'appearance'}
                    title="Set note color and icon"
                    onClick={() => setOpenNoteMenu((current) => current === 'appearance' ? null : 'appearance')}
                  >
                    <Palette size={13} /><span>Appearance</span>
                  </button>
                  {openNoteMenu === 'appearance' && (
                    <div className="sb-note-menu sb-note-appearance-menu" role="dialog" aria-label="Note appearance">
                      <NoteAppearancePicker
                        color={note.color}
                        icon={note.icon}
                        disabled={updateAppearance.isPending}
                        onChange={(next) => updateAppearance.mutate({ id: note.id, ...next })}
                      />
                    </div>
                  )}
                </div>
                <div ref={moreMenuRef} className="sb-note-actions-menu">
                  <button
                    ref={moreButtonRef}
                    type="button"
                    className="sb-note-action"
                    aria-label="More note actions"
                    aria-haspopup="menu"
                    aria-expanded={openNoteMenu === 'more'}
                    onClick={() => setOpenNoteMenu((current) => current === 'more' ? null : 'more')}
                  >
                    <MoreHorizontal size={14} /><span>More</span>
                  </button>
                  {openNoteMenu === 'more' && (
                    <div className="sb-note-menu" role="menu">
                      <button type="button" onClick={() => runNoteMenuAction(() => { setInsightsOpen(true); setMobilePanel('insights'); })} role="menuitem">
                        <Link2 size={13} /> Backlinks &amp; related notes
                      </button>
                      <button type="button" onClick={() => runNoteMenuAction(() => setZenMode((value) => !value))} role="menuitem">
                        <Focus size={13} /> {zenMode ? 'Exit note focus' : 'Focus on note'}
                      </button>
                      <button type="button" onClick={() => runNoteMenuAction(() => setWorkspaceFocus((value) => !value))} role="menuitem">
                        <LayoutTemplate size={13} /> {workspaceFocus ? 'Show side panels' : 'Hide side panels'}
                      </button>
                      <button type="button" onClick={() => runNoteMenuAction(() => setEditorMode(editorMode === 'source' ? 'live' : 'source'))} role="menuitem">
                        <PenSquare size={13} /> {editorMode === 'source' ? 'Live editor' : 'Source mode'}
                      </button>
                      <div className="sb-note-menu-divider" role="separator" />
                      <button type="button" onClick={() => runNoteMenuAction(handleRenameOpenNote)} role="menuitem">
                        <PenSquare size={13} /> Rename
                      </button>
                      <button type="button" onClick={() => runNoteMenuAction(handleMoveOpenNote)} role="menuitem">
                        <Inbox size={13} /> Move to folder
                      </button>
                      <button type="button" onClick={() => runNoteMenuAction(() => togglePin.mutate(note.id))} role="menuitem">
                        <Bookmark size={13} /> {note.pinned ? 'Unpin note' : 'Pin note'}
                      </button>
                      <button type="button" onClick={() => runNoteMenuAction(() => runEditorAction('addProperty'))} role="menuitem">
                        <SlidersHorizontal size={13} /> Add file property
                      </button>
                      <div className="sb-note-menu-divider" role="separator" />
                      <button type="button" onClick={() => runNoteMenuAction(() => runEditorAction('find'))} role="menuitem">
                        <Search size={13} /> Find in note
                      </button>
                      <button type="button" onClick={() => runNoteMenuAction(() => runEditorAction('replace'))} role="menuitem">
                        <RefreshCw size={13} /> Find and replace
                      </button>
                      <button type="button" onClick={() => runNoteMenuAction(() => void handleCopyNotePath())} role="menuitem">
                        <Link2 size={13} /> Copy note path
                      </button>
                      <button type="button" onClick={() => runNoteMenuAction(() => { setGraphFocusIds([note.id]); setShowGraph(true); })} role="menuitem">
                        <Share2 size={13} /> Show in graph
                      </button>
                      <button type="button" onClick={() => runNoteMenuAction(() => { setLibraryOpen(true); setMobilePanel('library'); })} role="menuitem">
                        <PanelLeftOpen size={13} /> Reveal in navigation
                      </button>
                      <div className="sb-note-menu-divider" role="separator" />
                      <button
                        type="button"
                        onClick={() => runNoteMenuAction(() => {
                          setChatScope({ ids: [note.id], message: `Remember this note as important context for me: ${note.title}` });
                          setShowChat(true);
                        })}
                        role="menuitem"
                      >
                        <Brain size={13} /> Remember
                      </button>
                      <button type="button" onClick={() => runNoteMenuAction(() => setShowLinkedInDraft(true))} role="menuitem">
                        <PenSquare size={13} /> Draft post
                      </button>
                      <button type="button" onClick={() => runNoteMenuAction(() => setShowPublish(true))} role="menuitem">
                        <Globe2 size={13} /> Publish
                      </button>
                      <button type="button" onClick={() => runNoteMenuAction(() => setShowVersionHistory(true))} role="menuitem">
                        <History size={13} /> Version history
                      </button>
                      <button type="button" onClick={() => runNoteMenuAction(() => setVimMode((value) => !value))} role="menuitem">
                        <span className="sb-menu-key">V</span> {vimMode ? 'Disable Vim mode' : 'Enable Vim mode'}
                      </button>
                      <button type="button" onClick={() => runNoteMenuAction(() => setShowExport(true))} role="menuitem">
                        <FileOutput size={13} /> Export
                      </button>
                      <button
                        type="button"
                        onClick={() => runNoteMenuAction(() => { if (window.confirm(`Move “${note.title}” to trash?`)) handleDelete(note.id); })}
                        className="sb-note-menu-danger"
                        role="menuitem"
                      >
                        <Trash2 size={13} /> Delete note
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="sb-editor-body">
              <NoteEditor
                ref={editorRef}
                note={note}
                allNotes={notes ?? []}
                onChange={handleContentChange}
                onNavigate={setSelectedId}
                onCreateAndOpen={handleCreateAndOpen}
                onOpenDrivePicker={() => setShowDrivePicker(true)}
                appendText={appendText}
                onAppended={() => setAppendText(null)}
                vimModeEnabled={vimMode}
                mode={editorMode}
                toolbarStyle={settings?.notesToolbarStyle}
                toolbarPosition={settings?.notesToolbarPosition}
              />
            </div>
          </>
        )}
      </main>

      <button
        type="button"
        className="sb-resizer sb-resizer-insights"
        aria-label="Resize note connections"
        title="Drag to resize note connections"
        tabIndex={insightsOpen ? 0 : -1}
        onPointerDown={(event) => beginPanelResize('insights', event)}
        onPointerMove={resizePanel}
        onPointerUp={endPanelResize}
        onPointerCancel={endPanelResize}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') setInsightsWidth((width) => Math.min(420, width + 12));
          if (event.key === 'ArrowRight') setInsightsWidth((width) => Math.max(208, width - 12));
        }}
      />

      <aside
        className={`sb-panel sb-insights min-h-0 overflow-auto ${mobilePanel === 'insights' ? 'sb-panel-active' : 'sb-panel-hidden'}`}
        aria-label="Note connections"
      >
        <div className="sb-insights-head">
          <div>
            <p className="sb-eyebrow">Connections</p>
            <h2>Links &amp; context</h2>
          </div>
          <button
            type="button"
            onClick={() => setInsightsOpen(false)}
            className="sb-panel-close"
            aria-label="Hide note connections"
            title="Hide note connections"
          >
            <PanelRightClose size={14} />
          </button>
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
