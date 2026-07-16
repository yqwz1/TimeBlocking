import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import type { ProposalCandidateDTO, ProposalItemDTO } from '@timeblock/shared';
import { useApplyProposal, useCreateProposal, useDiscardProposal, useProposal, useRefineProposal } from '../../hooks.js';
import { springs } from '../../lib/motion.js';
import { CandidateRow, FullnessMeter, PlanItemRow } from './planShared.js';

/**
 * `requestedScopeDate` is only supplied by explicit "Plan my day/tomorrow"
 * entry points, which force a fresh draft for that specific day. Ambient entry
 * points (the header chip) omit it, so an in-progress draft for whatever day
 * it was made for is shown as-is instead of being discarded and re-drafted.
 */
export default function PlanDayModal({ requestedScopeDate, label, onClose }: { requestedScopeDate?: string; label: string; onClose: () => void }) {
  const { data: proposal, isLoading } = useProposal();
  const createProposal = useCreateProposal();
  const refine = useRefineProposal();
  const applyProposal = useApplyProposal();
  const discardProposal = useDiscardProposal();
  const [error, setError] = useState<string | null>(null);
  const [showLater, setShowLater] = useState(false);

  useEffect(() => {
    if (isLoading || createProposal.isPending) return;
    if (!proposal) createProposal.mutate(requestedScopeDate);
    else if (requestedScopeDate && proposal.scopeDate !== requestedScopeDate) createProposal.mutate(requestedScopeDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, proposal?.scopeDate, requestedScopeDate]);

  const ready = !!proposal && (!requestedScopeDate || proposal.scopeDate === requestedScopeDate);
  const scopeDate = proposal?.scopeDate;

  const scopeItems = ready ? proposal.items.filter((i) => i.date === scopeDate) : [];
  const laterItems = ready ? proposal.items.filter((i) => i.date !== scopeDate && i.change !== 'unchanged') : [];
  const dayLoad = ready ? proposal.dayLoads.find((d) => d.date === scopeDate) : undefined;
  const pickedCandidates = ready ? proposal.candidates.filter((c) => c.picked) : [];
  const pickedMin = pickedCandidates.reduce((s, c) => s + c.durationMin, 0);
  const mustDoIds = new Set(pickedCandidates.slice(0, 3).map((c) => c.taskId));
  const changedCount = proposal ? proposal.summary.created + proposal.summary.moved + proposal.summary.deleted : 0;

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
      onSuccess: () => onClose(),
      onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    });
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-40 bg-black/50" />
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={springs.snappy}
        className="fixed inset-4 z-50 mx-auto flex max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900 md:inset-8"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">{label}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5">
            <X size={16} />
          </button>
        </div>

        {!ready ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400 dark:text-neutral-500">Drafting…</div>
        ) : (
          <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-2">
            <div className="flex flex-col overflow-hidden border-b border-slate-100 p-4 dark:border-neutral-800 md:border-b-0 md:border-r">
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

            <div className="flex flex-col overflow-hidden p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Proposed day</h3>
              <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
                {scopeItems.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-neutral-500">Nothing scheduled for this day yet.</p>
                ) : (
                  scopeItems.map((item) => (
                    <PlanItemRow key={item.key} item={item} onPin={() => pin(item)} onReject={() => reject(item)} disabled={refine.isPending} />
                  ))
                )}
                {laterItems.length > 0 && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setShowLater((v) => !v)}
                      className="text-xs font-medium text-teal-600 hover:underline dark:text-teal-400"
                    >
                      {showLater ? 'Hide' : 'Show'} later this week ({laterItems.length})
                    </button>
                    {showLater && (
                      <div className="mt-2 space-y-1.5">
                        {laterItems.map((item) => (
                          <PlanItemRow key={item.key} item={item} muted onPin={() => pin(item)} onReject={() => reject(item)} disabled={refine.isPending} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mx-5 mb-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
            {error === 'conflict' ? 'Your calendar changed since this was drafted. Redraft to see the current state.' : error}
          </div>
        )}

        {ready && (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 dark:border-neutral-800">
            <button
              type="button"
              onClick={() => discardProposal.mutate(proposal.id, { onSuccess: onClose })}
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
                {applyProposal.isPending ? 'Confirming…' : 'Confirm my day'}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </>
  );
}
