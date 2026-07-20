import { useEffect, useRef, useState } from 'react';
import { Network, Send, X } from 'lucide-react';
import type { NoteChatCitationDTO } from '@timeblock/shared';
import { useVaultChat } from '../../hooks/notes.js';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  citations?: NoteChatCitationDTO[];
  scope?: 'local' | 'global';
  focusNoteIds?: string[];
}

export default function ChatPanel({
  onNavigate,
  onClose,
  onShowOnGraph,
}: {
  onNavigate: (id: string) => void;
  onClose: () => void;
  /** G4 spatial citations: fly the graph to (and highlight) the answer's retrieved subgraph. */
  onShowOnGraph?: (noteIds: string[]) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const chat = useVaultChat();
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, chat.isPending]);

  function send() {
    const message = input.trim();
    if (!message || chat.isPending) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    setInput('');
    chat.mutate(
      { message, history },
      {
        onSuccess: (res) =>
          setMessages((prev) => [...prev, { role: 'assistant', content: res.answer, citations: res.citations, scope: res.scope, focusNoteIds: res.focusNoteIds }]),
        onError: () =>
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: "Couldn't reach the AI — check that it's enabled in Settings and you're online." },
          ]),
      },
    );
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-neutral-200">Vault chat</h2>
        <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-neutral-300" title="Close (Esc)">
          <X size={16} />
        </button>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
        {messages.length === 0 && (
          <p className="text-sm text-slate-400 dark:text-neutral-500">Ask a question — answers are drawn only from your notes, with clickable citations.</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            dir="auto"
            className={`rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'ml-6 bg-teal-600 text-white' : 'mr-6 bg-slate-100 text-slate-700 dark:bg-white/5 dark:text-neutral-200'}`}
          >
            {m.role === 'assistant' && m.scope && (
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                {m.scope === 'global' ? 'Across your vault' : 'From related notes'}
              </div>
            )}
            <p className="whitespace-pre-wrap">{m.content}</p>
            {m.citations && m.citations.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.citations.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onNavigate(c.id)}
                    className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-medium text-teal-700 hover:bg-white dark:bg-neutral-900 dark:text-teal-300"
                  >
                    {c.title}
                  </button>
                ))}
              </div>
            )}
            {onShowOnGraph && m.focusNoteIds && m.focusNoteIds.length > 0 && (
              <button
                onClick={() => onShowOnGraph(m.focusNoteIds!)}
                className="mt-2 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-teal-700 hover:bg-white/60 dark:text-teal-300 dark:hover:bg-white/5"
                title="Fly the graph to the notes behind this answer"
              >
                <Network size={12} /> Show on graph
              </button>
            )}
          </div>
        ))}
        {chat.isPending && <div className="mr-6 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-400 dark:bg-white/5 dark:text-neutral-500">Thinking…</div>}
      </div>
      <div className="border-t border-slate-200 p-3 dark:border-neutral-800">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            dir="auto"
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              } else if (e.key === 'Escape') onClose();
            }}
            placeholder="Ask your notes…"
            className="flex-1 resize-none rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
          <button onClick={send} disabled={!input.trim() || chat.isPending} className="rounded-md bg-teal-600 p-2 text-white disabled:opacity-40">
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
