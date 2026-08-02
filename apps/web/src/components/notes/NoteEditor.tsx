import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { closeBrackets, closeBracketsKeymap, autocompletion, type CompletionSource } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { openSearchPanel, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronDown, Code2, Heading2, Highlighter, IndentDecrease, IndentIncrease, Italic, Link2, List, ListOrdered, ListTodo, Minus, Palette, Plus, Quote, Redo2, Table2, Tags, Undo2 } from 'lucide-react';
import type { NoteAssetUploadDTO, NoteDetailDTO, NoteSummaryDTO } from '@timeblock/shared';
import { renderMarkdown, stripFrontmatter } from '../../lib/markdown.js';
import { isImageAutoUploadEnabled, isSupportedPastedImage, pastedImageFileName } from '../../lib/noteImageUpload.js';
import { withNoteProperty } from '../../lib/noteProperties.js';
import { livePreviewExtension } from './livePreview.js';
import { encodeNotePath } from '../../hooks/notes.js';
import NoteProperties from './NoteProperties.js';
import { tagColorFor, tagPillStyle, type TagColors } from './tagAppearance.js';

const highlightStyle = HighlightStyle.define([
  { tag: [tags.heading1, tags.heading2, tags.heading3], fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.monospace, fontFamily: 'ui-monospace, monospace' },
  { tag: tags.link, color: '#0d9488', textDecoration: 'underline' },
  { tag: tags.list, color: 'inherit' },
]);

function normaliseTag(value: string): string | null {
  const tag = value.trim().replace(/^#+/, '').replace(/\s+/g, '-').toLocaleLowerCase();
  return /^[\p{L}\p{N}_/-]+$/u.test(tag) ? tag : null;
}

/** Stores tag names and their optional colors in portable YAML frontmatter. */
function withFrontmatterTags(content: string, tags: string[], tagColors: TagColors): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const tagLine = `tags: ${JSON.stringify(tags)}`;
  const colors = Object.fromEntries(Object.entries(tagColors).filter(([tag, color]) => tags.some((item) => item.toLocaleLowerCase() === tag) && /^#[0-9a-f]{6}$/i.test(color)));
  const colorLine = Object.keys(colors).length ? `tagColors: ${JSON.stringify(colors)}` : null;
  const match = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(content);
  if (!match) return `---${newline}${tagLine}${colorLine ? `${newline}${colorLine}` : ''}${newline}---${newline}${content}`;

  const lines = match[2].split(/\r?\n/);
  const setFrontmatterLine = (key: string, value: string | null) => {
    const index = lines.findIndex((line) => new RegExp(`^${key}\\s*:`, 'i').test(line));
    if (index === -1) {
      if (value) lines.push(value);
      return;
    }
    let end = index + 1;
    while (end < lines.length && /^\s+/.test(lines[end])) end++;
    if (value) lines.splice(index, end - index, value);
    else lines.splice(index, end - index);
  };
  setFrontmatterLine('tags', tagLine);
  setFrontmatterLine('tagColors', colorLine);
  return `${match[1]}${lines.join(newline)}${match[3]}${content.slice(match[0].length)}`;
}

function wikilinkCompletionSource(getTitles: () => { title: string }[]): CompletionSource {
  return (context) => {
    const before = context.matchBefore(/\[\[[^\]]*/);
    if (!before) return null;
    const query = before.text.slice(2).toLowerCase();
    const options = getTitles()
      .filter((n) => n.title.toLowerCase().includes(query))
      .slice(0, 20)
      .map((n) => ({ label: n.title, apply: `${n.title}]]`, type: 'text' }));
    if (options.length === 0) return null;
    return { from: before.from + 2, options, validFor: /^[^\]]*$/ };
  };
}

/** `/drive` is deliberately an editor command rather than a hard-coded toolbar-only workflow. */
function driveCompletionSource(openPicker: () => void): CompletionSource {
  return (context) => {
    const before = context.matchBefore(/\/drive[\w-]*$/);
    if (!before) return null;
    return {
      from: before.from,
      options: [{
        label: 'Insert or import Google Drive file', type: 'keyword',
        apply: (view, _completion, from, to) => { view.dispatch({ changes: { from, to, insert: '' } }); openPicker(); },
      }],
      validFor: /^\/drive[\w-]*$/,
    };
  };
}

function setCursor(view: EditorView, position: number) {
  const anchor = Math.max(0, Math.min(position, view.state.doc.length));
  view.dispatch({ selection: { anchor }, scrollIntoView: true });
}

function moveCursorVertical(view: EditorView, delta: -1 | 1) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const column = view.state.selection.main.head - line.from;
  const targetLineNumber = Math.max(1, Math.min(view.state.doc.lines, line.number + delta));
  const targetLine = view.state.doc.line(targetLineNumber);
  setCursor(view, Math.min(targetLine.from + column, targetLine.to));
}

type InsertBlock = {
  label: string;
  title: string;
  icon: typeof ListTodo;
  create: (selectedText: string) => { text: string; selectionStart: number; selectionEnd: number };
};

const INSERT_BLOCKS: InsertBlock[] = [
  {
    label: 'Task', title: 'Add a task', icon: ListTodo,
    create: (selectedText) => {
      const value = selectedText || 'Task name';
      return { text: `- [ ] ${value}`, selectionStart: 6, selectionEnd: 6 + value.length };
    },
  },
  {
    label: 'Bullet', title: 'Add a bullet list item', icon: List,
    create: (selectedText) => {
      const value = selectedText || 'List item';
      return { text: `- ${value}`, selectionStart: 2, selectionEnd: 2 + value.length };
    },
  },
  {
    label: 'Numbered', title: 'Add a numbered list item', icon: ListOrdered,
    create: (selectedText) => {
      const value = selectedText || 'List item';
      return { text: `1. ${value}`, selectionStart: 3, selectionEnd: 3 + value.length };
    },
  },
  {
    label: 'Table', title: 'Insert a two-column table', icon: Table2,
    create: () => ({
      text: '| Column 1 | Column 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |',
      selectionStart: 2,
      selectionEnd: 10,
    }),
  },
  {
    label: 'Heading', title: 'Add a heading', icon: Heading2,
    create: (selectedText) => {
      const value = selectedText || 'Heading';
      return { text: `## ${value}`, selectionStart: 3, selectionEnd: 3 + value.length };
    },
  },
  {
    label: 'Quote', title: 'Add a quote', icon: Quote,
    create: (selectedText) => {
      const value = selectedText || 'Quote';
      return { text: `> ${value}`, selectionStart: 2, selectionEnd: 2 + value.length };
    },
  },
  {
    label: 'Code', title: 'Add a code block', icon: Code2,
    create: (selectedText) => {
      const value = selectedText || 'Write code here';
      return { text: `\`\`\`\n${value}\n\`\`\``, selectionStart: 4, selectionEnd: 4 + value.length };
    },
  },
  {
    label: 'Divider', title: 'Add a divider', icon: Minus,
    create: () => ({ text: '---', selectionStart: 3, selectionEnd: 3 }),
  },
];

export type NoteEditorHandle = {
  isReady: () => boolean;
  focus: () => void;
  find: () => void;
  replace: () => void;
  addProperty: () => void;
};

type NoteEditorProps = {
  note: NoteDetailDTO;
  allNotes: NoteSummaryDTO[];
  onChange: (content: string) => void;
  onNavigate: (id: string) => void;
  onCreateAndOpen: (title: string) => void;
  onOpenDrivePicker: () => void;
  /** Set to append text to the live doc (e.g. accepting a suggested [[link]]/#tag) without discarding unsaved edits. */
  appendText?: string | null;
  onAppended?: () => void;
  vimModeEnabled?: boolean;
  mode?: 'live' | 'source' | 'reading';
  toolbarStyle?: 'standard' | 'tiny';
  toolbarPosition?: 'top' | 'following';
};

const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor({
  note,
  allNotes,
  onChange,
  onNavigate,
  onCreateAndOpen,
  onOpenDrivePicker,
  appendText,
  onAppended,
  vimModeEnabled = false,
  mode = 'live',
  toolbarStyle = 'standard',
  toolbarPosition = 'top',
}, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastEmittedRef = useRef<string>(note.content);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const allNotesRef = useRef(allNotes);
  allNotesRef.current = allNotes;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onCreateAndOpenRef = useRef(onCreateAndOpen);
  onCreateAndOpenRef.current = onCreateAndOpen;
  const onOpenDrivePickerRef = useRef(onOpenDrivePicker);
  onOpenDrivePickerRef.current = onOpenDrivePicker;
  const vimEnabledRef = useRef(vimModeEnabled);
  vimEnabledRef.current = vimModeEnabled;
  const vimStateRef = useRef<'insert' | 'normal'>('insert');
  const [content, setContent] = useState(note.content);
  const [vimState, setVimState] = useState<'insert' | 'normal'>('insert');
  const [tagDraft, setTagDraft] = useState('');
  const [displayedTags, setDisplayedTags] = useState(note.tags);
  const [tagColors, setTagColors] = useState<TagColors>(note.tagColors ?? {});
  const [toolbarCoords, setToolbarCoords] = useState<{ left: number; top: number } | null>(null);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const formatMenuRef = useRef<HTMLDivElement | null>(null);
  const formatMenuButtonRef = useRef<HTMLButtonElement | null>(null);

  useImperativeHandle(ref, () => ({
    isReady: () => !!viewRef.current,
    focus: () => viewRef.current?.focus(),
    find: () => { if (viewRef.current) openSearchPanel(viewRef.current); },
    replace: () => {
      const view = viewRef.current;
      if (!view) return;
      const selected = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
      const find = window.prompt('Find in this note', selected);
      if (!find) return;
      const replaceWith = window.prompt(`Replace all “${find}” with`, '');
      if (replaceWith === null) return;
      const current = view.state.doc.toString();
      const matches = current.split(find).length - 1;
      if (matches === 0 || !window.confirm(`Replace ${matches} occurrence${matches === 1 ? '' : 's'}?`)) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: current.split(find).join(replaceWith) } });
    },
    addProperty: () => {
      const key = window.prompt('Property name');
      if (!key) return;
      const value = window.prompt(`Value for ${key}`, '');
      if (value === null || !viewRef.current) return;
      const current = viewRef.current.state.doc.toString();
      const next = withNoteProperty(current, key, value);
      if (next !== current) viewRef.current.dispatch({ changes: { from: 0, to: viewRef.current.state.doc.length, insert: next } });
    },
  }), []);

  useEffect(() => {
    if (!vimModeEnabled) {
      vimStateRef.current = 'insert';
      setVimState('insert');
    }
  }, [vimModeEnabled]);

  useEffect(() => {
    setDisplayedTags(note.tags);
    setTagColors(note.tagColors ?? {});
    setTagDraft('');
    setFormatMenuOpen(false);
  }, [note.id, note.tags, note.tagColors]);

  useEffect(() => {
    if (!formatMenuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!formatMenuRef.current?.contains(event.target as Node)) setFormatMenuOpen(false);
    };
    const dismissWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setFormatMenuOpen(false);
      formatMenuButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', dismissWithKeyboard);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', dismissWithKeyboard);
    };
  }, [formatMenuOpen]);

  useEffect(() => {
    if (mode === 'reading') setFormatMenuOpen(false);
  }, [mode]);

  async function uploadPastedImage(file: File): Promise<NoteAssetUploadDTO> {
    const form = new FormData();
    form.append('file', file, pastedImageFileName(file));
    const res = await fetch(`/api/notes/file-asset/${encodeNotePath(note.id)}?kind=image&ocr=1`, { method: 'POST', body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      throw new Error(body.error || 'Could not save the pasted image.');
    }
    return res.json() as Promise<NoteAssetUploadDTO>;
  }

  const updateFollowingToolbar = (view: EditorView) => {
    if (toolbarPosition !== 'following' || mode === 'reading' || !view.hasFocus) return;
    const coords = view.coordsAtPos(view.state.selection.main.head);
    if (!coords) return;
    const toolbarWidth = Math.min(544, window.innerWidth - 16);
    setToolbarCoords({
      left: Math.max(8, Math.min(coords.left, window.innerWidth - toolbarWidth - 8)),
      top: Math.max(8, Math.min(coords.bottom + 8, window.innerHeight - 52)),
    });
  };

  const replaceSelection = (text: string, selectionStart = text.length, selectionEnd = selectionStart) => {
    const view = viewRef.current;
    if (!view) return;
    const selection = view.state.selection.main;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor: selection.from + selectionStart, head: selection.from + selectionEnd },
      scrollIntoView: true,
    });
    view.focus();
  };

  const changeHeading = (level: number) => {
    const view = viewRef.current;
    if (!view) return;
    const selection = view.state.selection.main;
    const first = view.state.doc.lineAt(selection.from);
    const last = view.state.doc.lineAt(selection.to);
    const changes = [] as { from: number; to: number; insert: string }[];
    for (let lineNo = first.number; lineNo <= last.number; lineNo++) {
      const line = view.state.doc.line(lineNo);
      const text = line.text.replace(/^#{1,6}\s+/, '');
      changes.push({ from: line.from, to: line.to, insert: `${'#'.repeat(level)} ${text}` });
    }
    view.dispatch({ changes, selection, scrollIntoView: true });
    view.focus();
  };

  const changeIndent = (direction: 'in' | 'out') => {
    const view = viewRef.current;
    if (!view) return;
    const selection = view.state.selection.main;
    const first = view.state.doc.lineAt(selection.from);
    const last = view.state.doc.lineAt(selection.to);
    const changes = [] as { from: number; to: number; insert: string }[];
    for (let lineNo = first.number; lineNo <= last.number; lineNo++) {
      const line = view.state.doc.line(lineNo);
      if (direction === 'in') changes.push({ from: line.from, to: line.from, insert: '  ' });
      else {
        const indent = /^(?: {1,2}|\t)/.exec(line.text)?.[0];
        if (indent) changes.push({ from: line.from, to: line.from + indent.length, insert: '' });
      }
    }
    if (changes.length) view.dispatch({ changes, selection, scrollIntoView: true });
    view.focus();
  };

  const wrapSelection = (open: string, close: string, placeholderText: string) => {
    const view = viewRef.current;
    if (!view) return;
    const selection = view.state.selection.main;
    const selected = view.state.sliceDoc(selection.from, selection.to) || placeholderText;
    replaceSelection(`${open}${selected}${close}`, open.length, open.length + selected.length);
  };

  const applyColor = (property: 'color' | 'background-color', color: string) => {
    if (!CSS.supports('color', color)) return;
    wrapSelection(`<span style="${property}: ${color}">`, '</span>', 'Text');
    setFormatMenuOpen(false);
  };

  const alignSelection = (align: 'justify' | 'left' | 'right' | 'center') => {
    const open = align === 'center' ? '<center>' : `<p align="${align}">`;
    const close = align === 'center' ? '</center>' : '</p>';
    wrapSelection(open, close, 'Text');
  };

  /** Keep the command palette ephemeral: an applied command should return the writer to the note. */
  const runFormatCommand = (command: () => void) => {
    command();
    setFormatMenuOpen(false);
  };

  // (Re)create the editor when switching notes so the doc/history reset cleanly.
  useEffect(() => {
    if (!hostRef.current || mode === 'reading') return;
    const state = EditorState.create({
      doc: note.content,
      extensions: [
        history(),
        closeBrackets(),
        autocompletion({ override: [wikilinkCompletionSource(() => allNotesRef.current), driveCompletionSource(() => onOpenDrivePickerRef.current())] }),
        markdown(),
        syntaxHighlighting(highlightStyle),
        ...(mode === 'live' ? [livePreviewExtension({
          onOpenWikilink: (target) => {
            const normalized = target.trim().toLowerCase();
            const match = allNotesRef.current.find((candidate) => {
              const stem = candidate.id.split('/').pop()!.replace(/\.md$/i, '').toLowerCase();
              return stem === normalized || candidate.title.toLowerCase() === normalized;
            });
            if (match) onNavigateRef.current(match.id);
            else onCreateAndOpenRef.current(target.trim());
          },
          onOpenQueryNote: (id) => onNavigateRef.current(id),
        })] : []),
        keymap.of([
          { key: 'Mod-1', run: () => { changeHeading(1); return true; } },
          { key: 'Mod-2', run: () => { changeHeading(2); return true; } },
          { key: 'Mod-3', run: () => { changeHeading(3); return true; } },
          { key: 'Mod-4', run: () => { changeHeading(4); return true; } },
          { key: 'Mod-5', run: () => { changeHeading(5); return true; } },
          { key: 'Mod-6', run: () => { changeHeading(6); return true; } },
          ...closeBracketsKeymap, ...markdownKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap,
        ]),
        placeholder('Start writing...'),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ dir: 'auto' }),
        EditorView.domEventHandlers({
          keydown: (event, view) => {
            if (!vimEnabledRef.current) return false;
            const keyboard = event as KeyboardEvent;
            if (keyboard.metaKey || keyboard.ctrlKey || keyboard.altKey) return false;
            if (vimStateRef.current === 'insert') {
              if (keyboard.key === 'Escape') {
                keyboard.preventDefault();
                vimStateRef.current = 'normal';
                setVimState('normal');
                return true;
              }
              return false;
            }

            const line = view.state.doc.lineAt(view.state.selection.main.head);
            switch (keyboard.key) {
              case 'i':
                keyboard.preventDefault();
                vimStateRef.current = 'insert';
                setVimState('insert');
                return true;
              case 'a':
                keyboard.preventDefault();
                setCursor(view, view.state.selection.main.head + 1);
                vimStateRef.current = 'insert';
                setVimState('insert');
                return true;
              case 'o':
                keyboard.preventDefault();
                view.dispatch({
                  changes: { from: line.to, to: line.to, insert: '\n' },
                  selection: { anchor: line.to + 1 },
                  scrollIntoView: true,
                });
                vimStateRef.current = 'insert';
                setVimState('insert');
                return true;
              case 'h':
                keyboard.preventDefault();
                setCursor(view, view.state.selection.main.head - 1);
                return true;
              case 'l':
                keyboard.preventDefault();
                setCursor(view, view.state.selection.main.head + 1);
                return true;
              case 'j':
                keyboard.preventDefault();
                moveCursorVertical(view, 1);
                return true;
              case 'k':
                keyboard.preventDefault();
                moveCursorVertical(view, -1);
                return true;
              case '0':
                keyboard.preventDefault();
                setCursor(view, line.from);
                return true;
              case '$':
                keyboard.preventDefault();
                setCursor(view, line.to);
                return true;
              case 'x': {
                keyboard.preventDefault();
                const head = view.state.selection.main.head;
                if (head < view.state.doc.length) {
                  view.dispatch({ changes: { from: head, to: head + 1 } });
                }
                return true;
              }
              case 'Escape':
                keyboard.preventDefault();
                return true;
              default:
                if (keyboard.key.length === 1) {
                  keyboard.preventDefault();
                  return true;
                }
                return false;
            }
          },
          paste: (_event, view) => {
            const event = _event as ClipboardEvent;
            const image = Array.from(event.clipboardData?.items ?? [])
              .map((item) => item.getAsFile())
              .find((file): file is File => !!file && isSupportedPastedImage(file));
            if (!image || !isImageAutoUploadEnabled(view.state.doc.toString())) return false;
            event.preventDefault();
            void uploadPastedImage(image)
              .then((uploaded) => {
                const selection = view.state.selection.main;
                view.dispatch({
                  changes: { from: selection.from, to: selection.to, insert: uploaded.markdown },
                  selection: { anchor: selection.from + uploaded.markdown.length },
                  scrollIntoView: true,
                });
              })
              .catch((error) => {
                console.error(error);
              });
            return true;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const value = update.state.doc.toString();
            lastEmittedRef.current = value;
            setContent(value);
            onChangeRef.current(value);
          }
          if (update.selectionSet || update.viewportChanged || update.focusChanged) updateFollowingToolbar(update.view);
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '16px' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-content': { padding: '12px 0' },
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    updateFollowingToolbar(view);
    lastEmittedRef.current = note.content;
    setContent(note.content);
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, mode, toolbarPosition]);

  // Inserts via a live CM transaction (not a note.content overwrite) so it can't clobber unsaved edits,
  // and flows through the same updateListener -> onChange -> autosave path as normal typing.
  useEffect(() => {
    if (!appendText || !viewRef.current) return;
    const view = viewRef.current;
    const end = view.state.doc.length;
    const insert = `${end > 0 ? '\n\n' : ''}${appendText}`;
    view.dispatch({ changes: { from: end, to: end, insert } });
    onAppended?.();
  }, [appendText, onAppended]);

  const { body } = useMemo(() => stripFrontmatter(content), [content]);
  const wordCount = useMemo(() => body.trim().split(/\s+/).filter(Boolean).length, [body]);
  const characterCount = body.length;

  const insertBlock = (block: InsertBlock) => {
    const view = viewRef.current;
    if (!view) return;
    const selection = view.state.selection.main;
    const selectedText = view.state.sliceDoc(selection.from, selection.to);
    const { text, selectionStart, selectionEnd } = block.create(selectedText);
    const before = view.state.sliceDoc(0, selection.from);
    const after = view.state.sliceDoc(selection.to);
    const needsLeadingBreak = selection.empty && before.length > 0 && !before.endsWith('\n');
    const needsTrailingBreak = selection.empty && after.length > 0 && !after.startsWith('\n');
    const prefix = needsLeadingBreak ? '\n\n' : '';
    const suffix = needsTrailingBreak ? '\n\n' : '';
    const from = selection.from;
    const start = from + prefix.length + selectionStart;
    view.dispatch({
      changes: { from, to: selection.to, insert: `${prefix}${text}${suffix}` },
      selection: { anchor: start, head: from + prefix.length + selectionEnd },
      scrollIntoView: true,
    });
    view.focus();
  };

  const addTag = () => {
    const tag = normaliseTag(tagDraft);
    if (!tag || !viewRef.current) return;
    const nextTags = displayedTags.some((existing) => existing.toLocaleLowerCase() === tag)
      ? displayedTags
      : [...displayedTags, tag];
    const nextContent = withFrontmatterTags(viewRef.current.state.doc.toString(), nextTags, tagColors);
    if (nextContent !== viewRef.current.state.doc.toString()) {
      viewRef.current.dispatch({ changes: { from: 0, to: viewRef.current.state.doc.length, insert: nextContent } });
    }
    setDisplayedTags(nextTags);
    setTagDraft('');
  };

  const setTagColor = (tag: string, color: string) => {
    if (!viewRef.current || !/^#[0-9a-f]{6}$/i.test(color)) return;
    const nextColors = { ...tagColors, [tag.toLocaleLowerCase()]: color };
    const nextContent = withFrontmatterTags(viewRef.current.state.doc.toString(), displayedTags, nextColors);
    if (nextContent !== viewRef.current.state.doc.toString()) {
      viewRef.current.dispatch({ changes: { from: 0, to: viewRef.current.state.doc.length, insert: nextContent } });
    }
    setTagColors(nextColors);
  };

  const clearTagColor = (tag: string) => {
    if (!viewRef.current) return;
    const nextColors = { ...tagColors };
    delete nextColors[tag.toLocaleLowerCase()];
    const nextContent = withFrontmatterTags(viewRef.current.state.doc.toString(), displayedTags, nextColors);
    if (nextContent !== viewRef.current.state.doc.toString()) {
      viewRef.current.dispatch({ changes: { from: 0, to: viewRef.current.state.doc.length, insert: nextContent } });
    }
    setTagColors(nextColors);
  };

  const updateProperty = (key: string, value: string | null) => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    const next = withNoteProperty(current, key, value);
    if (next !== current) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
  };

  const readingHtml = useMemo(() => renderMarkdown(body, {
    resolveWikilink: (target) => {
      const normalized = target.trim().toLowerCase();
      const match = allNotes.find((candidate) => {
        const stem = candidate.id.split('/').pop()!.replace(/\.md$/i, '').toLowerCase();
        return stem === normalized || candidate.title.toLowerCase() === normalized;
      });
      return { id: match?.id ?? null };
    },
    tagColor: (tag) => tagColorFor(tag, tagColors),
  }), [allNotes, body, tagColors]);

  const openReadingLink = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-wikilink-target]') : null;
    if (!target?.dataset.wikilinkTarget) return;
    event.preventDefault();
    const linkedNote = allNotes.find((candidate) => candidate.id === target.dataset.wikilinkId);
    if (linkedNote) onNavigate(linkedNote.id);
    else onCreateAndOpen(target.dataset.wikilinkTarget);
  };

  const editorStatus = mode === 'reading'
    ? 'Reading view'
    : mode === 'source'
      ? 'Source mode'
      : vimModeEnabled
        ? `Vim · ${vimState === 'normal' ? 'Normal' : 'Insert'}`
        : 'Live editor';

  const documentStats = (
    <div className="sb-document-stats" aria-label={`${wordCount} words, ${characterCount} characters`}>
      <span><strong>{wordCount.toLocaleString()}</strong> {wordCount === 1 ? 'word' : 'words'}</span>
      <span className="sb-document-stats-divider" aria-hidden="true" />
      <span><strong>{characterCount.toLocaleString()}</strong> {characterCount === 1 ? 'character' : 'characters'}</span>
    </div>
  );

  const toolbar = (
    <div
      className={`sb-editor-toolbar sb-editor-toolbar-${toolbarStyle} ${mode === 'reading' ? 'sb-editor-toolbar-reading' : ''} ${toolbarPosition === 'following' ? 'sb-editor-toolbar-following' : ''} ${toolbarPosition === 'following' && toolbarCoords && toolbarCoords.top < window.innerHeight / 2 ? 'sb-editor-toolbar-following-below' : ''}`}
      style={toolbarPosition === 'following' && toolbarCoords ? { left: toolbarCoords.left, top: toolbarCoords.top } : undefined}
      aria-label="Note formatting toolbar"
    >
      {toolbarPosition === 'top' && documentStats}
      {mode !== 'reading' && (
        <div className="sb-toolbar-actions" aria-label="Formatting and insertion tools">
          <div className="sb-toolbar-action-rail">
            <div className="sb-toolbar-group" role="group" aria-label="Inline formatting">
              <button type="button" title="Bold" aria-label="Bold" onMouseDown={(event) => event.preventDefault()} onClick={() => wrapSelection('**', '**', 'Bold text')} className="sb-toolbar-button sb-toolbar-icon-button"><Bold size={14} /><span className="sb-toolbar-label">Bold</span></button>
              <button type="button" title="Italic" aria-label="Italic" onMouseDown={(event) => event.preventDefault()} onClick={() => wrapSelection('*', '*', 'Italic text')} className="sb-toolbar-button sb-toolbar-icon-button"><Italic size={14} /><span className="sb-toolbar-label">Italic</span></button>
              <button type="button" title="Link" aria-label="Insert link" onMouseDown={(event) => event.preventDefault()} onClick={() => wrapSelection('[', '](https://)', 'Link text')} className="sb-toolbar-button sb-toolbar-icon-button"><Link2 size={14} /><span className="sb-toolbar-label">Link</span></button>
            </div>
            <span className="sb-toolbar-divider" aria-hidden="true" />
            <div className="sb-toolbar-group" role="group" aria-label="Insert blocks">
              {[INSERT_BLOCKS[0], INSERT_BLOCKS[4], INSERT_BLOCKS[1], INSERT_BLOCKS[2], INSERT_BLOCKS[5], INSERT_BLOCKS[6], INSERT_BLOCKS[3]].map((block) => {
                const Icon = block.icon;
                return (
                  <button key={block.label} type="button" title={block.title} aria-label={block.title} onMouseDown={(event) => event.preventDefault()} onClick={() => insertBlock(block)} className="sb-toolbar-button">
                    <Icon size={14} strokeWidth={2} aria-hidden="true" /><span className="sb-toolbar-label">{block.label}</span>
                  </button>
                );
              })}
            </div>
            <span className="sb-toolbar-divider" aria-hidden="true" />
            <div className="sb-toolbar-group" role="group" aria-label="Editing history">
              <button type="button" title="Undo" aria-label="Undo" onMouseDown={(event) => event.preventDefault()} onClick={() => { if (viewRef.current) undo(viewRef.current); }} className="sb-toolbar-button sb-toolbar-icon-button"><Undo2 size={14} /><span className="sb-toolbar-label">Undo</span></button>
              <button type="button" title="Redo" aria-label="Redo" onMouseDown={(event) => event.preventDefault()} onClick={() => { if (viewRef.current) redo(viewRef.current); }} className="sb-toolbar-button sb-toolbar-icon-button"><Redo2 size={14} /><span className="sb-toolbar-label">Redo</span></button>
            </div>
          </div>
          <div ref={formatMenuRef} className="sb-toolbar-more">
            <button
              ref={formatMenuButtonRef}
              type="button"
              className="sb-toolbar-button sb-toolbar-more-trigger"
              title="More formatting commands"
              aria-label="More formatting commands"
              aria-haspopup="menu"
              aria-expanded={formatMenuOpen}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setFormatMenuOpen((open) => !open)}
            >
              <span className="sb-toolbar-label">More</span><ChevronDown size={13} aria-hidden="true" />
            </button>
            {formatMenuOpen && (
              <div className="sb-toolbar-menu" role="menu">
                <div className="sb-toolbar-menu-group" aria-label="Heading level">
                  <span className="sb-toolbar-menu-title">Heading level</span>
                  <div className="sb-toolbar-heading-grid">
                    {[1, 2, 3, 4, 5, 6].map((level) => <button key={level} type="button" onClick={() => runFormatCommand(() => changeHeading(level))} role="menuitem">H{level}<kbd>Ctrl+{level}</kbd></button>)}
                  </div>
                </div>
                <div className="sb-toolbar-menu-group">
                  <span className="sb-toolbar-menu-title">Color and structure</span>
                  <div className="sb-toolbar-command-grid">
                    <label className="sb-toolbar-color-command" role="menuitem"><Palette size={13} /> Text color<input type="color" defaultValue="#0f766e" onChange={(event) => applyColor('color', event.target.value)} aria-label="Choose text color" /></label>
                    <label className="sb-toolbar-color-command" role="menuitem"><Highlighter size={13} /> Highlight<input type="color" defaultValue="#fef3c7" onChange={(event) => applyColor('background-color', event.target.value)} aria-label="Choose highlight color" /></label>
                    <button type="button" onClick={() => runFormatCommand(() => changeIndent('in'))} role="menuitem"><IndentIncrease size={13} /> Indent list</button>
                    <button type="button" onClick={() => runFormatCommand(() => changeIndent('out'))} role="menuitem"><IndentDecrease size={13} /> Outdent list</button>
                    <button type="button" onClick={() => runFormatCommand(() => insertBlock(INSERT_BLOCKS[7]))} role="menuitem"><Minus size={13} /> Insert divider</button>
                  </div>
                </div>
                <div className="sb-toolbar-menu-group">
                  <span className="sb-toolbar-menu-title">Alignment</span>
                  <div className="sb-toolbar-command-grid">
                    <button type="button" onClick={() => runFormatCommand(() => alignSelection('left'))} role="menuitem"><AlignLeft size={13} /> Align left</button>
                    <button type="button" onClick={() => runFormatCommand(() => alignSelection('center'))} role="menuitem"><AlignCenter size={13} /> Center</button>
                    <button type="button" onClick={() => runFormatCommand(() => alignSelection('right'))} role="menuitem"><AlignRight size={13} /> Align right</button>
                    <button type="button" onClick={() => runFormatCommand(() => alignSelection('justify'))} role="menuitem"><AlignJustify size={13} /> Justify</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {toolbarPosition === 'top' && <span className="sb-live-mode"><span aria-hidden="true" />{editorStatus}</span>}
    </div>
  );

  return (
    <div className="sb-note-editor flex h-full flex-col">
      {toolbarPosition === 'top' && toolbar}
      {toolbarPosition === 'following' && (
        <div className="sb-editor-meta">
          {documentStats}
          <span className="sb-live-mode"><span aria-hidden="true" />{editorStatus}</span>
        </div>
      )}
      <div className="flex min-h-9 items-center gap-2 border-b border-slate-100 px-3 py-1.5 dark:border-neutral-800">
        <Tags size={13} className="shrink-0 text-slate-400 dark:text-neutral-500" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {displayedTags.map((tag) => (
            <span key={tag} style={tagPillStyle(tag, tagColors)} className="inline-flex items-center gap-1 rounded-full border border-transparent bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">
              #{tag}
              {mode !== 'reading' && <label title={`Choose a color for #${tag}`} className="grid h-3.5 w-3.5 cursor-pointer place-items-center rounded-full border border-current/25" style={{ backgroundColor: tagColorFor(tag, tagColors) ?? '#0d9488' }}>
                <input type="color" value={tagColorFor(tag, tagColors) ?? '#0d9488'} onChange={(event) => setTagColor(tag, event.target.value)} aria-label={`Choose a color for #${tag}`} className="sr-only" />
              </label>}
              {mode !== 'reading' && tagColorFor(tag, tagColors) && <button type="button" onClick={() => clearTagColor(tag)} title={`Reset color for #${tag}`} aria-label={`Reset color for #${tag}`} className="leading-none opacity-60 hover:opacity-100">×</button>}
            </span>
          ))}
          <div className="flex items-center">
            <input
              value={tagDraft}
              disabled={mode === 'reading'}
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }}
              placeholder={displayedTags.length ? 'Add tag' : 'Add a tag'}
              aria-label="Add tag"
              className="w-24 bg-transparent px-1 py-0.5 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:w-32 dark:text-neutral-200 dark:placeholder:text-neutral-500"
            />
            <button type="button" onClick={addTag} disabled={mode === 'reading' || !normaliseTag(tagDraft)} title="Add tag" aria-label="Add tag" className="rounded p-0.5 text-slate-400 hover:bg-teal-50 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-teal-500/10 dark:hover:text-teal-300">
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>
      {mode !== 'reading' && (
        <NoteProperties
          content={content}
          onAdd={(key, value) => updateProperty(key, value)}
          onUpdate={(key, value) => updateProperty(key, value)}
          onRemove={(key) => updateProperty(key, null)}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {mode === 'reading' ? (
          <div className="sb-reading-pane min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white px-5 dark:border-neutral-800 dark:bg-neutral-900" onClick={openReadingLink} dangerouslySetInnerHTML={{ __html: readingHtml }} />
        ) : (
          <div ref={hostRef} className="sb-writing-pane sb-live-editor min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white px-3 dark:border-neutral-800 dark:bg-neutral-900" />
        )}
      </div>
      {toolbarPosition === 'following' && mode !== 'reading' && toolbar}
    </div>
  );
});

export default NoteEditor;
