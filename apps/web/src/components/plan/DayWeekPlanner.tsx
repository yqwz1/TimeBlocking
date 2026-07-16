import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { ArrowLeft } from 'lucide-react';
import type { ProposalCandidateDTO, ProposalItemDTO } from '@timeblock/shared';
import { useApplyProposal, useCreateProposal, useDiscardProposal, useProposal, useRefineProposal } from '../../hooks.js';
import { CandidateRow, FullnessMeter, PlanItemRow } from './planShared.js';

type Mode = 'day' | 'week';

function WeekDayGroup({
  date,
  isScope,
  items,
  dayLoad,
  onSelect,
  onPin,
  onReject,
  disabled,
}: {
  date: string;
  isScope: boolean;
  items: ProposalItemDTO[];
  dayLoad?: { committedMin: number; capacityMin: number };
  onSelect: () => void;
  onPin: (item: ProposalItemDTO) => void;
  onReject: (item: ProposalItemDTO) => void;
  disabled: boolean;
}) {
  const label = DateTime.fromISO(date).toFormat('ccc, LLL d');
  return (
    <div className={`rounded-lg border p-3 ${isScope ? 'border-teal-400/60 bg-teal-500/5' : 'border-slate-200 dark:border-neutral-800'}`}>
      <button type="button" onClick={onSelect} className="flex w-full items-center justify-between gap-2 text-left">
        <span className={`text-xs font-semibold uppercase tracking-wide ${isScope ? 'text-teal-600 dark:text-teal-400' : 'text-slate-500 dark:text-neutral-400'}`}>
          {label}
        </span>
        <span className="text-[11px] text-slate-400 dark:text-neutral-500">
          {items.length === 0 ? 'Nothing scheduled' : `${items.length} block${items.length === 1 ? '' : 's'}`}
        </span>
      </button>
      {dayLoad && <FullnessMeter committedMin={dayLoad.committedMin} capacityMin={dayLoad.capacityMin} />}
      {items.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {items.map((item) => (
            <PlanItemRow key={item.key} item={item} onPin={() => onPin(item)} onReject={() => onReject(item)} disabled={disabled} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Full-page "review & plan" experience for the Today tab: pick which tasks
 * are in for a day, see the proposed schedule for that day or the whole
 * week, then confirm once to write the whole diff to the calendar.
 */
export default function DayWeekPlanner({ onExit }: { onExit?: () => void } = {}) {
  const today = useMemo(() => DateTime.now().toISODate()!, []);
  const [requestedScopeDate, setRequestedScopeDate] = useState<string>(today);
  const [mode, setMode] = useState<Mode>('day');
  const [error, setError] = useState<string | null>(null);

  const { data: proposal, isLoading } = useProposal();
  const createProposal = useCreateProposal();
  const refine = useRefineProposal();
  const applyProposal = useApplyProposal();
  const discardProposal = useDiscardProposal();

  useEffect(() => {
    if (isLoading || createProposal.isPending) return;
    if (!proposal) createProposal.mutate(requestedScopeDate);
    else if (proposal.scopeDate !== requestedScopeDate) createProposal.mutate(requestedScopeDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, proposal?.scopeDate, requestedScopeDate]);

  const ready = !!proposal && proposal.scopeDate === requestedScopeDate;
  const scopeDate = proposal?.scopeDate;

  const scopeItems = ready ? proposal.items.filter((i) => i.date === scopeDate) : [];
  const dayLoad = ready ? proposal.dayLoads.find((d) => d.date === scopeDate) : undefined;
  const pickedCandidates = ready ? proposal.candidates.filter((c) => c.picked) : [];
  const pickedMin = pickedCandidates.reduce((s, c) => s + c.durationMin, 0);
  const mustDoIds = new Set(pickedCandidates.slice(0, 3).map((c) => c.taskId));
  const changedCount = proposal ? proposal.summary.created + proposal.summary.moved + proposal.summary.deleted : 0;

  const weekDates = ready ? proposal.dayLoads.map((d) => d.date).sort() : [];
  const itemsByDate = (date: string) => (ready ? proposal.items.filter((i) => i.date === date && i.change !== 'unchanged') : []);

  const tomorrow = DateTime.fromISO(today).plus({ days: 1 }).toISODate()!;

  const toggle = (c: ProposalCandidateDTO) => {
    if (!proposal) return;
    refine.mutate({ id: proposal.id, ...(c.picked ? { unpickTaskIds: [c.taskId] } : { pickTaskIds: [c.taskId] }) });
  };
  const pin = (item: ProposalItemDTO) => proposal && refine.mutate({ id: proposal.id, pins: [item.key] });
  const reject = (item: ProposalItemDTO) => proposal && item.taskId && refine.mutate({ id: proposal.id, rejectTaskIds: [item.taskId] });

  const handleConfirm = () => {
    if (!proposal) return;
    setError(null);
    applyProposal.mutate(proposal.id, {
      onSuccess: () => onExit?.(),
      onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    });
  };

  const handleDiscard = () => {
    if (!proposal) return;
    discardProposal.mutate(proposal.id, { onSuccess: () => onExit?.() });
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              <ArrowLeft size={13} /> Back to today
            </button>
          )}
          <h1 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Plan your day</h1>
          <p className="text-sm text-slate-500 dark:text-neutral-400">Pick what's in, then confirm to write it to your calendar.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-1 dark:border-neutral-700">
            <button
              type="button"
              onClick={() => setRequestedScopeDate(today)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                requestedScopeDate === today ? 'bg-teal-600 text-white' : 'text-slate-500 hover:bg-slate-50 dark:text-neutral-400 dark:hover:bg-white/5'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setRequestedScopeDate(tomorrow)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                requestedScopeDate === tomorrow ? 'bg-teal-600 text-white' : 'text-slate-500 hover:bg-slate-50 dark:text-neutral-400 dark:hover:bg-white/5'
              }`}
            >
              Tomorrow
            </button>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-1 dark:border-neutral-700">
            <button
              type="button"
              onClick={() => setMode('day')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                mode === 'day' ? 'bg-slate-900 text-white dark:bg-white dark:text-neutral-900' : 'text-slate-500 hover:bg-slate-50 dark:text-neutral-400 dark:hover:bg-white/5'
              }`}
            >
              Day
            </button>
            <button
              type="button"
              onClick={() => setMode('week')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                mode === 'week' ? 'bg-slate-900 text-white dark:bg-white dark:text-neutral-900' : 'text-slate-500 hover:bg-slate-50 dark:text-neutral-400 dark:hover:bg-white/5'
              }`}
            >
              Week
            </button>
          </div>
        </div>
      </div>

      {!ready ? (
        <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-200 text-sm text-slate-400 dark:border-neutral-800 dark:text-neutral-500">
          Drafting…
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-2">
          <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 p-4 dark:border-neutral-800">
            <div className="mb-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Triage</h3>
                <span className="text-right text-xs text-slate-500 dark:text-neutral-400">{(pickedMin / 60).toFixed(1)}h picked</span>
              </div>
              {dayLoad && <FullnessMeter committedMin={dayLoad.committedMin} capacityMin={dayLoad.capacityMin} />}
            </div>
            <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
              {proposal.candidates.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-neutral-500">Nothing waiting for a decision.</p>
              ) : (
                proposal.candidates.map((c) => (
                  <CandidateRow key={c.taskId} c={c} mustDo={mustDoIds.has(c.taskId)} onToggle={() => toggle(c)} disabled={refine.isPending} />
                ))
              )}
            </div>
          </div>

          <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 p-4 dark:border-neutral-800">
            {mode === 'day' ? (
              <>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                  Proposed day — {DateTime.fromISO(scopeDate!).toFormat('ccc, LLL d')}
                </h3>
                <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
                  {scopeItems.length === 0 ? (
                    <p className="text-sm text-slate-400 dark:text-neutral-500">Nothing scheduled for this day yet.</p>
                  ) : (
                    scopeItems.map((item) => (
                      <PlanItemRow key={item.key} item={item} onPin={() => pin(item)} onReject={() => reject(item)} disabled={refine.isPending} />
                    ))
                  )}
                </div>
              </>
            ) : (
              <>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Proposed week</h3>
                <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                  {weekDates.map((date) => (
                    <WeekDayGroup
                      key={date}
                      date={date}
                      isScope={date === scopeDate}
                      items={itemsByDate(date)}
                      dayLoad={proposal.dayLoads.find((d) => d.date === date)}
                      onSelect={() => setRequestedScopeDate(date)}
                      onPin={pin}
                      onReject={reject}
                      disabled={refine.isPending}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
          {error === 'conflict' ? 'Your calendar changed since this was drafted. Redraft to see the current state.' : error}
        </div>
      )}

      {ready && (
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 px-5 py-3 dark:border-neutral-800">
          <button
            type="button"
            onClick={handleDiscard}
            disabled={discardProposal.isPending}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-white/5"
          >
            Discard
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 dark:text-neutral-400">
              +{proposal.summary.created} · ~{proposal.summary.moved} · −{proposal.summary.deleted}
            </span>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={applyProposal.isPending || changedCount === 0}
              className="rounded-md bg-teal-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {applyProposal.isPending ? 'Confirming…' : 'Confirm my week'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
