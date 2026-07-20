import { useEffect, useMemo, useRef, useState } from 'react';
import { closeBrackets, closeBracketsKeymap, autocompletion, type CompletionSource } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { NoteDetailDTO, NoteSummaryDTO } from '@timeblock/shared';
import { renderMarkdown, stripFrontmatter, toggleCheckboxAtLine } from '../../lib/markdown.js';

const highlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.5em', fontWeight: '700' },
  { tag: tags.heading2, fontSize: '1.3em', fontWeight: '700' },
  { tag: tags.heading3, fontSize: '1.15em', fontWeight: '700' },
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

type ViewMode = 'edit' | 'split' | 'preview';

export default function NoteEditor({
  note,
  allNotes,
  onChange,
  onNavigate,
  onCreateAndOpen,
  appendText,
  onAppended,
}: {
  note: NoteDetailDTO;
  allNotes: NoteSummaryDTO[];
  onChange: (content: string) => void;
  onNavigate: (id: string) => void;
  onCreateAndOpen: (title: string) => void;
  /** Set to append text to the live doc (e.g. accepting a suggested [[link]]/#tag) without discarding unsaved edits. */
  appendText?: string | null;
  onAppended?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastEmittedRef = useRef<string>(note.content);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const allNotesRef = useRef(allNotes);
  allNotesRef.current = allNotes;
  const [content, setContent] = useState(note.content);
  const [mode, setMode] = useState<ViewMode>('split');

  // (Re)create the editor when switching notes so the doc/history reset cleanly.
  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: note.content,
      extensions: [
        history(),
        closeBrackets(),
        autocompletion({ override: [wikilinkCompletionSource(() => allNotesRef.current)] }),
        markdown(),
        syntaxHighlighting(highlightStyle),
        keymap.of([...closeBracketsKeymap, ...markdownKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap]),
        placeholder('Start writing…'),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ dir: 'auto' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const value = update.state.doc.toString();
            lastEmittedRef.current = value;
            setContent(value);
            onChangeRef.current(value);
          }
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '14px' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
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

  const resolveWikilink = useMemo(() => {
    const byStem = new Map<string, string>();
    const byTitle = new Map<string, string>();
    for (const n of allNotes) {
      const stem = n.id.split('/').pop()!.replace(/\.md$/i, '');
      byStem.set(stem.toLowerCase(), n.id);
      byTitle.set(n.title.toLowerCase(), n.id);
    }
    return (target: string) => ({ id: byStem.get(target.toLowerCase()) ?? byTitle.get(target.toLowerCase()) ?? null });
  }, [allNotes]);

  const { body, frontmatterLineCount } = useMemo(() => stripFrontmatter(content), [content]);
  const previewHtml = useMemo(() => renderMarkdown(body, { resolveWikilink }), [body, resolveWikilink]);
  const wordCount = useMemo(() => body.trim().split(/\s+/).filter(Boolean).length, [body]);

  function handlePreviewClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const link = target.closest<HTMLAnchorElement>('a.wikilink');
    if (link) {
      e.preventDefault();
      const id = link.dataset.wikilinkId;
      const title = link.dataset.wikilinkTarget ?? '';
      if (id) onNavigate(id);
      else if (title) onCreateAndOpen(title);
      return;
    }
    const checkbox = target.closest<HTMLInputElement>('input[type="checkbox"][data-line]');
    if (checkbox) {
      const line = Number(checkbox.dataset.line);
      const next = toggleCheckboxAtLine(content, frontmatterLineCount, line);
      viewRef.current?.dispatch({ changes: { from: 0, to: viewRef.current.state.doc.length, insert: next } });
    }
  }

  return (
    <div className="sb-note-editor flex h-full flex-col">
      <div className="sb-editor-toolbar">
        <span className="sb-word-count">{wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}</span>
        <div className="sb-view-toggle" role="tablist" aria-label="Editor view">
          {(['edit', 'split', 'preview'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors ${
              mode === m ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/5'
            }`}
          >
            {m}
          </button>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 gap-4">
        <div ref={hostRef} className={`sb-writing-pane min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white px-3 dark:border-neutral-800 dark:bg-neutral-900 ${mode === 'preview' ? 'hidden' : ''}`} />
        {mode !== 'edit' && (
          <div
            className="note-prose sb-preview-pane min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900"
            dir="auto"
            onClick={handlePreviewClick}
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        )}
      </div>
    </div>
  );
}
