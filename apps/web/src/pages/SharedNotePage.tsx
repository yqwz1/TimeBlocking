import { useParams } from 'react-router-dom';
import { usePublicNote } from '../hooks/notes.js';
import { renderMarkdown, stripFrontmatter } from '../lib/markdown.js';

export default function SharedNotePage() {
  const { token = '' } = useParams();
  const query = usePublicNote(token || null);

  if (query.isLoading) {
    return <div className="mx-auto flex min-h-dvh max-w-4xl items-center justify-center px-6 text-sm text-slate-500 dark:text-neutral-400">Loading shared note…</div>;
  }

  if (query.error || !query.data) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-4xl flex-col items-center justify-center px-6 text-center">
        <p className="text-sm uppercase tracking-[0.24em] text-slate-400 dark:text-neutral-500">Shared note</p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-900 dark:text-neutral-100">Link unavailable</h1>
        <p className="mt-3 max-w-xl text-sm text-slate-500 dark:text-neutral-400">This note may have been revoked, moved, or deleted.</p>
      </div>
    );
  }

  const { body } = stripFrontmatter(query.data.content);

  return (
    <div className="min-h-dvh bg-slate-50 px-4 py-10 text-slate-900 dark:bg-neutral-950 dark:text-neutral-100">
      <article className="note-prose mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white px-6 py-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 sm:px-10 sm:py-10">
        <header className="mb-8 border-b border-slate-200 pb-6 dark:border-neutral-800">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-400 dark:text-neutral-500">Shared note</p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-900 dark:text-neutral-100">{query.data.title}</h1>
          <p className="mt-3 text-sm text-slate-500 dark:text-neutral-400">Published {new Date(query.data.publishedAt).toLocaleString()}</p>
        </header>
        <div
          dir="auto"
          className="note-prose"
          dangerouslySetInnerHTML={{
            __html: renderMarkdown(body, {
              resolveWikilink: () => ({ id: null }),
            }),
          }}
        />
      </article>
    </div>
  );
}
