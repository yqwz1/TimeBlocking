import { Link2, Link2Off, Sparkles, Wand2 } from 'lucide-react';
import type { NoteDetailDTO, NoteSuggestionsDTO, RelatedNoteDTO } from '@timeblock/shared';
import { highlightSnippet } from '../../lib/markdown.js';

export default function BacklinksPanel({
  note,
  onNavigate,
  onLinkUnlinked,
  relatedNotes,
  suggestions,
  suggestLoading,
  onRequestSuggestions,
  onAcceptLink,
  onAcceptTag,
  onDismissSuggestions,
}: {
  note: NoteDetailDTO;
  onNavigate: (id: string) => void;
  onLinkUnlinked: (mentioningNoteId: string) => void;
  relatedNotes: RelatedNoteDTO[];
  suggestions: NoteSuggestionsDTO | null;
  suggestLoading: boolean;
  onRequestSuggestions: () => void;
  onAcceptLink: (title: string) => void;
  onAcceptTag: (tag: string) => void;
  onDismissSuggestions: () => void;
}) {
  return (
    <div className="sb-backlinks flex h-full flex-col gap-5 overflow-auto text-sm">
      <section className="sb-insight-section">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
          <Link2 size={13} /> Backlinks ({note.backlinks.length})
        </h3>
        {note.backlinks.length === 0 ? (
          <p className="text-xs text-slate-400 dark:text-neutral-500">
            No backlinks yet — link to this note with <code>[[{note.title}]]</code> from another note.
          </p>
        ) : (
          <ul className="space-y-2">
            {note.backlinks.map((b) => (
              <li key={b.id}>
                <button onClick={() => onNavigate(b.id)} className="block w-full rounded-md border border-slate-200 p-2 text-left hover:border-teal-300 hover:bg-teal-50/50 dark:border-neutral-800 dark:hover:border-teal-700 dark:hover:bg-teal-500/5">
                  <div className="font-medium text-slate-700 dark:text-neutral-200">{b.title}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-400 dark:text-neutral-500">{b.snippet}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sb-insight-section">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
          <Link2Off size={13} /> Unlinked mentions ({note.unlinkedMentions.length})
        </h3>
        {note.unlinkedMentions.length === 0 ? (
          <p className="text-xs text-slate-400 dark:text-neutral-500">No unlinked mentions found.</p>
        ) : (
          <ul className="space-y-2">
            {note.unlinkedMentions.map((m) => (
              <li key={m.id} className="rounded-md border border-slate-200 p-2 dark:border-neutral-800">
                <div className="flex items-center justify-between gap-2">
                  <button onClick={() => onNavigate(m.id)} className="truncate font-medium text-slate-700 hover:underline dark:text-neutral-200">
                    {m.title}
                  </button>
                  <button onClick={() => onLinkUnlinked(m.id)} className="shrink-0 rounded border border-teal-200 px-1.5 py-0.5 text-xs text-teal-700 hover:bg-teal-50 dark:border-teal-800 dark:text-teal-300 dark:hover:bg-teal-500/10">
                    Link it
                  </button>
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-400 dark:text-neutral-500" dangerouslySetInnerHTML={{ __html: highlightSnippet(m.snippet) }} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {relatedNotes.length > 0 && (
        <section className="sb-insight-section">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
            <Sparkles size={13} /> Related notes
          </h3>
          <ul className="space-y-1.5">
            {relatedNotes.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => onNavigate(r.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-left hover:border-teal-300 hover:bg-teal-50/50 dark:border-neutral-800 dark:hover:border-teal-700 dark:hover:bg-teal-500/5"
                >
                  <span className="truncate font-medium text-slate-700 dark:text-neutral-200">{r.title}</span>
                  <span className="shrink-0 text-xs text-slate-400 dark:text-neutral-500">{Math.round(r.score * 100)}%</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="sb-insight-section sb-suggestions-section">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
            <Wand2 size={13} /> Suggestions
          </h3>
          <button
            onClick={onRequestSuggestions}
            disabled={suggestLoading}
            className="rounded border border-teal-200 px-1.5 py-0.5 text-xs text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:border-teal-800 dark:text-teal-300 dark:hover:bg-teal-500/10"
          >
            {suggestLoading ? 'Thinking…' : 'Suggest'}
          </button>
        </div>
        {!suggestions && !suggestLoading && <p className="text-xs text-slate-400 dark:text-neutral-500">Ask the AI for links/tags it thinks fit this note. Nothing is added until you accept it.</p>}
        {suggestions && (suggestions.links.length > 0 || suggestions.tags.length > 0) && (
          <div className="space-y-2">
            {suggestions.links.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {suggestions.links.map((l) => (
                  <button
                    key={l}
                    onClick={() => onAcceptLink(l)}
                    className="rounded-full border border-dashed border-teal-300 px-2 py-0.5 text-xs text-teal-700 hover:bg-teal-50 dark:border-teal-700 dark:text-teal-300 dark:hover:bg-teal-500/10"
                  >
                    + [[{l}]]
                  </button>
                ))}
              </div>
            )}
            {suggestions.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {suggestions.tags.map((t) => (
                  <button
                    key={t}
                    onClick={() => onAcceptTag(t)}
                    className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-white/5"
                  >
                    + #{t}
                  </button>
                ))}
              </div>
            )}
            <button onClick={onDismissSuggestions} className="text-xs text-slate-400 underline hover:text-slate-600 dark:hover:text-neutral-300">
              dismiss
            </button>
          </div>
        )}
        {suggestions && suggestions.links.length === 0 && suggestions.tags.length === 0 && (
          <p className="text-xs text-slate-400 dark:text-neutral-500">No suggestions this time.</p>
        )}
      </section>

      {note.tags.length > 0 && (
        <section className="sb-insight-section">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Tags</h3>
          <div className="flex flex-wrap gap-1.5">
            {note.tags.map((t) => (
              <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-white/5 dark:text-neutral-300">
                #{t}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
