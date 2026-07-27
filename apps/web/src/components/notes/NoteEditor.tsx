import { useEffect, useMemo, useRef, useState } from 'react';
import { closeBrackets, closeBracketsKeymap, autocompletion, type CompletionSource } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { NoteAssetUploadDTO, NoteDetailDTO, NoteSummaryDTO } from '@timeblock/shared';
import { stripFrontmatter } from '../../lib/markdown.js';
import { livePreviewExtension } from './livePreview.js';
import { encodeNotePath } from '../../hooks/notes.js';

const highlightStyle = HighlightStyle.define([
  { tag: [tags.heading1, tags.heading2, tags.heading3], fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.monospace, fontFamily: 'ui-monospace, monospace' },
  { tag: tags.link, color: '#0d9488', textDecoration: 'underline' },
  { tag: tags.list, color: 'inherit' },
]);

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

export default function NoteEditor({
  note,
  allNotes,
  onChange,
  onNavigate,
  onCreateAndOpen,
  onOpenDrivePicker,
  appendText,
  onAppended,
  vimModeEnabled = false,
}: {
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
}) {
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

  useEffect(() => {
    if (!vimModeEnabled) {
      vimStateRef.current = 'insert';
      setVimState('insert');
    }
  }, [vimModeEnabled]);

  async function uploadPastedImage(file: File): Promise<NoteAssetUploadDTO> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/notes/file-asset/${encodeNotePath(note.id)}?kind=image&ocr=1`, { method: 'POST', body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      throw new Error(body.error || 'Could not save the pasted image.');
    }
    return res.json() as Promise<NoteAssetUploadDTO>;
  }

  // (Re)create the editor when switching notes so the doc/history reset cleanly.
  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: note.content,
      extensions: [
        history(),
        closeBrackets(),
        autocompletion({ override: [wikilinkCompletionSource(() => allNotesRef.current), driveCompletionSource(() => onOpenDrivePickerRef.current())] }),
        markdown(),
        syntaxHighlighting(highlightStyle),
        livePreviewExtension({
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
        }),
        keymap.of([...closeBracketsKeymap, ...markdownKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap]),
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
            const image = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith('image/'))?.getAsFile();
            if (!image) return false;
            event.preventDefault();
            void uploadPastedImage(image)
              .then((uploaded) => {
                const end = view.state.doc.length;
                const insert = `${end > 0 ? '\n\n' : ''}${uploaded.markdown}`;
                view.dispatch({ changes: { from: end, to: end, insert } });
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
    lastEmittedRef.current = note.content;
    setContent(note.content);
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

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

  return (
    <div className="sb-note-editor flex h-full flex-col">
      <div className="sb-editor-toolbar">
        <span className="sb-word-count">{wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}</span>
        <span className="sb-live-mode">
          <span aria-hidden="true" />
          {vimModeEnabled ? `Vim · ${vimState === 'normal' ? 'Normal' : 'Insert'}` : 'Live editor'}
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={hostRef} className="sb-writing-pane sb-live-editor min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white px-3 dark:border-neutral-800 dark:bg-neutral-900" />
      </div>
    </div>
  );
}
