import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Brain,
  Check,
  ChevronDown,
  CircleAlert,
  Command,
  History,
  Lightbulb,
  MessageSquareText,
  Network,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import type { AssistantMessage, EvidenceRef, MemoryClaim } from '@timeblock/shared';
import {
  useActionProposals,
  useApproveActionProposal,
  useAssistantOnboarding,
  useAssistantChat,
  useAssistantMessageFeedback,
  useAssistantThread,
  useAssistantThreads,
  useCreateAssistantThread,
  useDailyBriefing,
  useForgetMemory,
  useMemories,
  useProactiveInsights,
  useRejectActionProposal,
  useSubmitAssistantOnboarding,
  useUpdateMemory,
  useWeeklyBriefing,
} from '../../hooks/assistant.js';
import { api } from '../../api.js';

type PanelTab = 'brief' | 'chat' | 'memory';

function sourceLabel(source: EvidenceRef): string {
  const labels: Record<EvidenceRef['sourceType'], string> = {
    note: 'Note',
    task: 'Task',
    goal: 'Goal',
    habit: 'Habit',
    calendar: 'Calendar',
    reflection: 'Reflection',
    weekly_review: 'Review',
    communication: 'Message',
    assistant: 'Conversation',
    manual: 'Profile',
  };
  return labels[source.sourceType];
}

function CitationChip({ citation, onNavigate, messageId }: { citation: EvidenceRef; onNavigate: (id: string) => void; messageId?: string }) {
  const recordOpen = () => {
    if (messageId) void api.post(`/assistant/messages/${encodeURIComponent(messageId)}/citation-open`, { evidenceId: citation.id });
  };
  const content = (
    <>
      <span className="text-[9px] font-bold uppercase tracking-[0.16em] opacity-60">{sourceLabel(citation)}</span>
      <span className="max-w-44 truncate">{citation.title}</span>
    </>
  );
  const className =
    'inline-flex items-center gap-1.5 rounded-full border border-teal-900/10 bg-white/75 px-2.5 py-1 text-[11px] font-medium text-teal-900 shadow-sm transition hover:-translate-y-0.5 hover:bg-white dark:border-teal-300/10 dark:bg-neutral-900/80 dark:text-teal-200';
  if (citation.sourceType === 'note') {
    return (
      <button type="button" onClick={() => { recordOpen(); onNavigate(citation.sourceId); }} className={className} title={citation.excerpt}>
        {content}
      </button>
    );
  }
  return citation.deepLink ? (
    <a href={citation.deepLink} onClick={recordOpen} className={className} title={citation.excerpt}>
      {content}
      <ArrowUpRight size={10} />
    </a>
  ) : (
    <span className={className} title={citation.excerpt}>
      {content}
    </span>
  );
}

function BriefView({ onNavigate }: { onNavigate: (id: string) => void }) {
  const { data: daily, isLoading } = useDailyBriefing();
  const { data: weekly } = useWeeklyBriefing();
  const { data: insights = [] } = useProactiveInsights();
  const { data: proposals = [] } = useActionProposals();
  const approve = useApproveActionProposal();
  const reject = useRejectActionProposal();

  if (isLoading || !daily) {
    return <div className="grid h-full place-items-center text-sm text-stone-400">Preparing today’s command brief…</div>;
  }
  const citationById = new Map(daily.citations.map((citation) => [citation.id, citation]));
  return (
    <div className="space-y-6 pb-8">
      <section className="relative overflow-hidden rounded-[28px] border border-amber-900/10 bg-[#f4ead6] p-6 text-stone-900 shadow-[0_20px_60px_-36px_rgba(68,54,28,.65)] dark:border-amber-100/10 dark:bg-[#211f19] dark:text-stone-100">
        <div className="absolute -right-8 -top-10 h-40 w-40 rounded-full border-[22px] border-amber-400/20" />
        <div className="relative">
          <p className="mb-8 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.24em] text-amber-800/70 dark:text-amber-300/70">
            <Command size={13} /> Daily command brief
          </p>
          <h2 className="max-w-lg font-serif text-3xl leading-tight tracking-tight">{daily.title.replace(/^Command brief · /, '')}</h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-stone-600 dark:text-stone-300">{daily.summary}</p>
        </div>
      </section>

      {insights.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-stone-500 dark:text-neutral-400">
              <Lightbulb size={14} /> Worth your attention
            </h3>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              {insights.length}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {insights.slice(0, 4).map((insight) => (
              <article key={insight.id} className="rounded-2xl border border-stone-200/80 bg-white/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/70">
                <div className="mb-2 flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${insight.priority === 'high' ? 'bg-rose-500' : 'bg-amber-400'}`} />
                  <h4 className="text-sm font-semibold text-stone-800 dark:text-neutral-100">{insight.title}</h4>
                </div>
                <p className="text-xs leading-5 text-stone-500 dark:text-neutral-400">{insight.body}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {insight.evidence.slice(0, 2).map((item) => (
                    <CitationChip key={item.id} citation={item} onNavigate={onNavigate} />
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        {daily.sections.map((section) => (
          <article key={section.title} className="rounded-2xl border border-stone-200/80 bg-white/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
            <h3 className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400">{section.title}</h3>
            <div className="space-y-3">
              {section.items.map((item, index) => (
                <div key={`${item.text}-${index}`} className="group">
                  <p className="text-sm leading-5 text-stone-700 dark:text-neutral-200">{item.text}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {item.citationIds.flatMap((id) => {
                      const citation = citationById.get(id);
                      return citation ? [<CitationChip key={id} citation={citation} onNavigate={onNavigate} />] : [];
                    })}
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      {proposals.length > 0 && (
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-stone-500 dark:text-neutral-400">
            <ShieldCheck size={14} /> Waiting for your approval
          </h3>
          <div className="space-y-2">
            {proposals.slice(0, 4).map((proposal) => (
              <article key={proposal.id} className="rounded-2xl border border-teal-900/10 bg-teal-50/70 p-4 dark:border-teal-300/10 dark:bg-teal-950/20">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-semibold text-teal-950 dark:text-teal-100">{proposal.title}</h4>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-teal-900/65 dark:text-teal-200/65">{proposal.preview}</p>
                    <p className="mt-2 text-[11px] text-stone-500 dark:text-neutral-400">{proposal.reasoning}</p>
                  </div>
                  <span className="rounded-full border border-current px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-teal-700 dark:text-teal-300">
                    {proposal.riskLevel}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => approve.mutate({ id: proposal.id, confirmPreview: proposal.riskLevel === 'critical' })}
                    disabled={approve.isPending}
                    className="inline-flex items-center gap-1.5 rounded-full bg-teal-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-900 disabled:opacity-50"
                  >
                    <Check size={12} /> Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => reject.mutate(proposal.id)}
                    className="rounded-full px-3 py-1.5 text-xs font-medium text-stone-500 hover:bg-white/70 dark:hover:bg-white/5"
                  >
                    Not now
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {weekly && (
        <details className="group rounded-2xl border border-stone-200/80 bg-white/60 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-stone-700 dark:text-neutral-200">
            <span className="flex items-center gap-2"><History size={14} /> This week at a glance</span>
            <ChevronDown size={14} className="transition group-open:rotate-180" />
          </summary>
          <p className="mt-3 text-sm leading-6 text-stone-500 dark:text-neutral-400">{weekly.summary}</p>
        </details>
      )}
    </div>
  );
}

function MemoryCard({
  memory,
  onNavigate,
}: {
  memory: MemoryClaim;
  onNavigate: (id: string) => void;
}) {
  const update = useUpdateMemory();
  const forget = useForgetMemory();
  const candidate = memory.status === 'candidate';
  return (
    <article className={`rounded-2xl border p-4 ${candidate ? 'border-amber-300/60 bg-amber-50/70 dark:border-amber-500/20 dark:bg-amber-950/10' : 'border-stone-200/80 bg-white/70 dark:border-neutral-800 dark:bg-neutral-900/60'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-stone-900 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] text-white dark:bg-neutral-100 dark:text-neutral-900">
              {memory.memoryClass.replaceAll('_', ' ')}
            </span>
            <span className={`text-[10px] font-semibold ${candidate ? 'text-amber-700 dark:text-amber-300' : 'text-teal-700 dark:text-teal-300'}`}>
              {candidate ? 'Needs review' : 'Confirmed'}
            </span>
            <span className="text-[10px] text-stone-400">{Math.round(memory.confidence * 100)}%</span>
          </div>
          <p dir="auto" className="text-sm leading-6 text-stone-800 dark:text-neutral-100">{memory.claim}</p>
        </div>
        {memory.sensitivity === 'sensitive' && <ShieldCheck size={15} className="shrink-0 text-rose-500" aria-label="Sensitive memory" />}
      </div>
      {memory.evidence.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {memory.evidence.map((item) => <CitationChip key={item.id} citation={item} onNavigate={onNavigate} />)}
        </div>
      )}
      <div className="mt-4 flex items-center gap-2 border-t border-current/5 pt-3">
        {candidate && (
          <>
            <button
              type="button"
              onClick={() => update.mutate({ id: memory.id, patch: { status: 'confirmed', confidence: 1 } })}
              className="inline-flex items-center gap-1 rounded-full bg-teal-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-900"
            >
              <Check size={12} /> Confirm
            </button>
            <button
              type="button"
              onClick={() => update.mutate({ id: memory.id, patch: { status: 'rejected' } })}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-stone-500 hover:bg-white/80 dark:hover:bg-white/5"
            >
              Reject
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => forget.mutate(memory.id)}
          className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-stone-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/20"
          title="Forget this memory"
        >
          <Trash2 size={11} /> Forget
        </button>
      </div>
    </article>
  );
}

function MemoryView({ onNavigate }: { onNavigate: (id: string) => void }) {
  const { data: memories = [], isLoading } = useMemories();
  const { data: onboarding } = useAssistantOnboarding();
  const submitOnboarding = useSubmitAssistantOnboarding();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const candidates = memories.filter((memory) => memory.status === 'candidate');
  const confirmed = memories.filter((memory) => memory.status === 'confirmed');
  return (
    <div className="space-y-7 pb-8">
      <section className="rounded-[28px] bg-stone-900 p-6 text-stone-50 shadow-[0_22px_70px_-40px_rgba(0,0,0,.8)] dark:bg-black">
        <Brain size={26} className="mb-8 text-amber-300" />
        <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-stone-400">Explainable personal memory</p>
        <h2 className="mt-2 font-serif text-3xl">What the brain knows</h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-stone-400">
          Confirmed facts may shape important advice. Candidates stay labelled until you approve them. Every claim keeps its source.
        </p>
      </section>
      <details className="group rounded-2xl border border-stone-200/80 bg-white/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-stone-700 dark:text-neutral-200">
          <span className="flex items-center gap-2"><Sparkles size={14} className="text-amber-500" /> Guided onboarding interview</span>
          <ChevronDown size={14} className="transition group-open:rotate-180" />
        </summary>
        <p className="mt-2 text-xs leading-5 text-stone-400">Your submitted answers become confirmed memories. Leave any question blank to skip it.</p>
        <div className="mt-4 space-y-3">
          {onboarding?.questions.map((question) => (
            <label key={question.id} className="block">
              <span className="text-xs font-medium text-stone-600 dark:text-neutral-300">{question.prompt}</span>
              <textarea
                value={answers[question.id] ?? ''}
                onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                dir="auto"
                rows={2}
                className="mt-1 block w-full resize-y rounded-xl border border-stone-200 bg-[#fbfaf6] px-3 py-2 text-sm outline-none focus:border-amber-400 dark:border-neutral-700 dark:bg-neutral-950"
              />
            </label>
          ))}
          <button
            type="button"
            disabled={submitOnboarding.isPending || !Object.values(answers).some((answer) => answer.trim())}
            onClick={() => submitOnboarding.mutate(answers, { onSuccess: () => setAnswers({}) })}
            className="inline-flex items-center gap-1.5 rounded-full bg-stone-900 px-4 py-2 text-xs font-semibold text-amber-200 disabled:opacity-40 dark:bg-amber-300 dark:text-stone-950"
          >
            <Check size={12} /> Save approved answers
          </button>
        </div>
      </details>
      {isLoading ? (
        <p className="text-sm text-stone-400">Loading memory…</p>
      ) : (
        <>
          {candidates.length > 0 && (
            <section>
              <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
                <CircleAlert size={14} /> Review queue · {candidates.length}
              </h3>
              <div className="space-y-2">{candidates.map((memory) => <MemoryCard key={memory.id} memory={memory} onNavigate={onNavigate} />)}</div>
            </section>
          )}
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-stone-500 dark:text-neutral-400">
              <ShieldCheck size={14} /> Confirmed · {confirmed.length}
            </h3>
            <div className="space-y-2">
              {confirmed.map((memory) => <MemoryCard key={memory.id} memory={memory} onNavigate={onNavigate} />)}
              {!confirmed.length && <p className="rounded-2xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-400 dark:border-neutral-700">No confirmed memories yet. Tell the assistant “Remember that…” to add one.</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default function ChatPanel({
  onNavigate,
  onClose,
  onShowOnGraph,
  initialFocusNoteIds,
  initialMessage,
}: {
  onNavigate: (id: string) => void;
  onClose: () => void;
  onShowOnGraph?: (noteIds: string[]) => void;
  initialFocusNoteIds?: string[];
  initialMessage?: string;
}) {
  const [tab, setTab] = useState<PanelTab>('brief');
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const { data: threads = [] } = useAssistantThreads();
  const { data: threadDetail } = useAssistantThread(activeThreadId);
  const createThread = useCreateAssistantThread();
  const chat = useAssistantChat();
  const feedback = useAssistantMessageFeedback();
  const { data: allProposals = [] } = useActionProposals();
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const initialSentRef = useRef(false);

  useEffect(() => {
    if (!activeThreadId && threads[0]) setActiveThreadId(threads[0].id);
  }, [threads, activeThreadId]);

  useEffect(() => {
    if (threadDetail?.thread.id === activeThreadId) setMessages(threadDetail.messages);
  }, [threadDetail, activeThreadId]);

  useEffect(() => {
    if (tab === 'chat') inputRef.current?.focus();
  }, [tab]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, chat.isPending]);

  function send(override?: string) {
    const text = (override ?? input).trim();
    if (!text || chat.isPending) return;
    setTab('chat');
    const optimistic: AssistantMessage = {
      id: `pending:${Date.now()}`,
      threadId: activeThreadId ?? '',
      role: 'user',
      content: text,
      citations: [],
      memoriesUsed: [],
      uncertainties: [],
      proposedActionIds: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    setInput('');
    chat.mutate(
      { threadId: activeThreadId ?? undefined, message: text, focusNoteIds: initialFocusNoteIds },
      {
        onSuccess: (result) => {
          setActiveThreadId(result.thread.id);
          setMessages((current) => [...current.filter((message) => message.id !== optimistic.id), { ...optimistic, id: `user:${result.message.id}` }, result.message]);
        },
        onError: (error) => {
          setMessages((current) => [
            ...current.filter((message) => message.id !== optimistic.id),
            optimistic,
            {
              id: `error:${Date.now()}`,
              threadId: activeThreadId ?? '',
              role: 'assistant',
              content: error instanceof Error ? error.message : 'The assistant could not respond.',
              citations: [],
              memoriesUsed: [],
              uncertainties: ['The request did not complete.'],
              proposedActionIds: [],
              createdAt: new Date().toISOString(),
            },
          ]);
        },
      },
    );
  }

  useEffect(() => {
    if (!initialMessage || initialSentRef.current) return;
    initialSentRef.current = true;
    const timer = setTimeout(() => send(initialMessage), 0);
    return () => clearTimeout(timer);
  }, [initialMessage]);

  const proposalsById = useMemo(() => new Map(allProposals.map((proposal) => [proposal.id, proposal])), [allProposals]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-stone-950/25 backdrop-blur-[2px]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="flex h-full w-full max-w-3xl flex-col border-l border-stone-200 bg-[#fbfaf6] shadow-[-30px_0_90px_-45px_rgba(29,25,18,.6)] dark:border-neutral-800 dark:bg-[#121311]">
        <header className="border-b border-stone-200/80 bg-white/70 px-4 pb-3 pt-4 backdrop-blur-xl dark:border-neutral-800 dark:bg-neutral-950/70">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-stone-900 text-amber-300 shadow-lg shadow-stone-900/15 dark:bg-amber-300 dark:text-stone-950">
                <Sparkles size={17} />
              </span>
              <div className="min-w-0">
                <h1 className="truncate font-serif text-lg font-semibold text-stone-900 dark:text-stone-100">Chief of staff</h1>
                <p className="truncate text-[11px] text-stone-400">
                  {initialFocusNoteIds?.length ? `Focused on ${initialFocusNoteIds.length} graph notes` : 'Local context · cited answers · approval before action'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {tab === 'chat' && (
                <button
                  type="button"
                  onClick={() =>
                    createThread.mutate('New conversation', {
                      onSuccess: (thread) => {
                        setActiveThreadId(thread.id);
                        setMessages([]);
                        inputRef.current?.focus();
                      },
                    })
                  }
                  className="rounded-xl p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-white/5"
                  title="New conversation"
                >
                  <Plus size={16} />
                </button>
              )}
              <button type="button" onClick={onClose} className="rounded-xl p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-white/5" title="Close">
                <X size={17} />
              </button>
            </div>
          </div>
          <nav className="mt-4 flex gap-1 rounded-2xl bg-stone-100 p-1 dark:bg-neutral-900" aria-label="Chief of staff views">
            {([
              ['brief', Command, 'Brief'],
              ['chat', MessageSquareText, 'Ask'],
              ['memory', Brain, 'Memory'],
            ] as const).map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  tab === value ? 'bg-white text-stone-900 shadow-sm dark:bg-neutral-800 dark:text-white' : 'text-stone-400 hover:text-stone-700 dark:hover:text-neutral-200'
                }`}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </nav>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-5 sm:px-6" ref={tab === 'chat' ? listRef : undefined}>
          {tab === 'brief' && <BriefView onNavigate={onNavigate} />}
          {tab === 'memory' && <MemoryView onNavigate={onNavigate} />}
          {tab === 'chat' && (
            <div className="mx-auto max-w-2xl space-y-5 pb-4">
              {messages.length === 0 && (
                <div className="py-12 text-center">
                  <span className="mx-auto grid h-14 w-14 place-items-center rounded-[22px] border border-amber-300/60 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-950/20 dark:text-amber-300">
                    <MessageSquareText size={21} />
                  </span>
                  <h2 className="mt-5 font-serif text-2xl text-stone-800 dark:text-neutral-100">What needs your attention?</h2>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-stone-400">Ask across notes, tasks, goals, calendar, habits, reflections, decisions, and confirmed memory.</p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {['Plan a realistic day', 'What am I forgetting?', 'How are my goals drifting?'].map((suggestion) => (
                      <button key={suggestion} type="button" onClick={() => send(suggestion)} className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 shadow-sm hover:border-amber-300 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((message) => {
                const user = message.role === 'user';
                const messageProposals = message.proposedActionIds.flatMap((id) => (proposalsById.has(id) ? [proposalsById.get(id)!] : []));
                return (
                  <article key={message.id} className={user ? 'ml-auto max-w-[82%]' : 'max-w-[94%]'}>
                    <div
                      dir="auto"
                      className={
                        user
                          ? 'rounded-[22px_22px_6px_22px] bg-stone-900 px-4 py-3 text-sm leading-6 text-white shadow-lg shadow-stone-900/10 dark:bg-amber-300 dark:text-stone-950'
                          : 'rounded-[6px_22px_22px_22px] border border-stone-200/80 bg-white/75 px-4 py-4 text-sm leading-6 text-stone-700 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/70 dark:text-neutral-200'
                      }
                    >
                      {!user && <p className="mb-2 text-[9px] font-bold uppercase tracking-[0.2em] text-teal-700 dark:text-teal-300">Grounded response</p>}
                      <p className="whitespace-pre-wrap">{message.content}</p>
                      {!user && message.uncertainties.length > 0 && (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/20 dark:bg-amber-950/20 dark:text-amber-200">
                          <p className="mb-1 flex items-center gap-1 font-semibold"><CircleAlert size={11} /> Uncertainty</p>
                          {message.uncertainties.map((item) => <p key={item}>{item}</p>)}
                        </div>
                      )}
                      {!user && message.citations.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {message.citations.map((citation) => <CitationChip key={citation.id} citation={citation} onNavigate={onNavigate} messageId={message.id} />)}
                        </div>
                      )}
                      {!user && onShowOnGraph && message.citations.some((citation) => citation.sourceType === 'note') && (
                        <button
                          type="button"
                          onClick={() => onShowOnGraph(message.citations.filter((citation) => citation.sourceType === 'note').map((citation) => citation.sourceId))}
                          className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:underline dark:text-teal-300"
                        >
                          <Network size={11} /> Show note sources on graph
                        </button>
                      )}
                    </div>
                    {!user && !message.id.startsWith('error:') && (
                      <div className="mt-1 flex items-center gap-1 pl-2 text-stone-300">
                        <button type="button" onClick={() => feedback.mutate({ messageId: message.id, rating: 'helpful' })} className="rounded-lg p-1.5 hover:bg-stone-100 hover:text-teal-600 dark:hover:bg-white/5"><ThumbsUp size={11} /></button>
                        <button type="button" onClick={() => feedback.mutate({ messageId: message.id, rating: 'not_helpful' })} className="rounded-lg p-1.5 hover:bg-stone-100 hover:text-rose-500 dark:hover:bg-white/5"><ThumbsDown size={11} /></button>
                        {message.memoriesUsed.length > 0 && <span className="ml-1 flex items-center gap-1 text-[10px] text-stone-400"><Brain size={10} /> {message.memoriesUsed.length} memories used</span>}
                      </div>
                    )}
                    {messageProposals.length > 0 && (
                      <div className="mt-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs text-teal-900 dark:border-teal-500/20 dark:bg-teal-950/20 dark:text-teal-200">
                        <p className="font-semibold">Proposed, not applied</p>
                        {messageProposals.map((proposal) => <p key={proposal.id} className="mt-1">{proposal.title}</p>)}
                      </div>
                    )}
                  </article>
                );
              })}
              {chat.isPending && (
                <div className="flex items-center gap-2 text-xs text-stone-400">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" /> Reviewing your local context…
                </div>
              )}
            </div>
          )}
        </div>

        {tab === 'chat' && (
          <footer className="border-t border-stone-200/80 bg-white/70 p-3 backdrop-blur-xl dark:border-neutral-800 dark:bg-neutral-950/70 sm:p-4">
            <div className="mx-auto max-w-2xl">
              <div className="flex items-end gap-2 rounded-[22px] border border-stone-200 bg-white p-2 shadow-[0_10px_35px_-20px_rgba(58,47,30,.5)] focus-within:border-amber-400 dark:border-neutral-700 dark:bg-neutral-900">
                <textarea
                  ref={inputRef}
                  value={input}
                  dir="auto"
                  rows={2}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      send();
                    } else if (event.key === 'Escape') {
                      event.stopPropagation();
                      onClose();
                    }
                  }}
                  placeholder='Ask anything, or say “Remember that…”'
                  className="max-h-36 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm text-stone-800 outline-none placeholder:text-stone-300 dark:text-neutral-100 dark:placeholder:text-neutral-600"
                />
                <button
                  type="button"
                  onClick={() => send()}
                  disabled={!input.trim() || chat.isPending}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-stone-900 text-amber-300 transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-30 dark:bg-amber-300 dark:text-stone-950"
                >
                  <Send size={15} />
                </button>
              </div>
              <p className="mt-2 flex items-center justify-center gap-1 text-[10px] text-stone-300 dark:text-neutral-600">
                <ShieldCheck size={10} /> Retrieved content cannot grant permission or execute tools
              </p>
            </div>
          </footer>
        )}
      </section>
    </div>
  );
}
