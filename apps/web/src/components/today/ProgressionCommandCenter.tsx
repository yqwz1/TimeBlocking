import { Award, Coins, Flame, Lock, Sparkles, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useProgressionDashboard, useSelectProgressionMission } from '../../hooks.js';

function Meter({ value, target }: { value: number; target: number }) {
  return <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-neutral-800"><div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 transition-[width]" style={{ width: `${Math.min(100, target ? (value / target) * 100 : 0)}%` }} /></div>;
}

export default function ProgressionCommandCenter() {
  const { data, isLoading } = useProgressionDashboard();
  const select = useSelectProgressionMission();
  if (isLoading || !data) return <div className="h-36 animate-pulse rounded-2xl bg-slate-100 dark:bg-neutral-900/70" />;
  if (!data.started) return <section className="rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-cyan-50 p-4 dark:border-violet-500/25 dark:from-violet-950/30 dark:to-cyan-950/20"><div className="flex items-center gap-3"><Sparkles className="text-violet-500" /><div><p className="font-semibold text-slate-900 dark:text-white">Season 1 starts {data.season.startLocal}</p><p className="text-sm text-slate-600 dark:text-neutral-300">Your legacy XP is preserved separately. This season begins with a fresh command center.</p></div></div></section>;
  const contract = data.contract;
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-slate-100 bg-gradient-to-r from-violet-50 via-white to-cyan-50 px-4 py-3 dark:border-neutral-800 dark:from-violet-950/30 dark:via-neutral-900 dark:to-cyan-950/20">
      <div className="flex items-center gap-2"><Award size={18} className="text-violet-500" /><span className="text-sm font-semibold text-slate-900 dark:text-white">Level {data.level}</span><span className="text-xs text-slate-500">{data.xpIntoLevel}/{data.xpForNextLevel} XP</span></div>
      <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-300"><Coins size={16} />{data.credits} Credits</div>
      <div className="flex items-center gap-1.5 text-sm font-medium text-orange-700 dark:text-orange-300"><Flame size={16} />{data.activeStreak} active-day streak</div>
      <div className="flex items-center gap-1.5 text-sm font-medium text-cyan-700 dark:text-cyan-300"><Trophy size={16} />{data.season.tier} · {data.season.rankPoints} rank</div>
      <Link to="/progress" className="ml-auto text-sm font-medium text-violet-600 hover:underline dark:text-violet-300">Open progress</Link>
    </div>
    {contract && <div className="p-4"><div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold text-slate-900 dark:text-white">Today’s contract</h2><p className="text-xs text-slate-500">{contract.state === 'rest' ? 'Planned rest day — your streak is safely paused.' : contract.state === 'failed' ? 'This contract was missed.' : contract.state === 'complete' ? 'Full contract complete.' : 'Core missions protect your streak; the challenge improves your rewards.'}</p></div>{contract.state === 'locked' && <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Lock size={12} /> Locked</span>}</div><div className="grid gap-3 md:grid-cols-3">{contract.missions.filter((m) => m.type === 'core' || m.selected || contract.state === 'open').map((m) => <div key={m.id} className={`rounded-xl border p-3 ${m.completedAt ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/25 dark:bg-emerald-500/10' : 'border-slate-200 dark:border-neutral-700'}`}><div className="flex gap-2"><span className="mt-0.5 text-xs font-bold uppercase tracking-wide text-violet-500">{m.type === 'core' ? 'Core' : 'Challenge'}</span>{m.type === 'optional' && !m.selected && contract.state === 'open' && <button onClick={() => select.mutate(m.id)} className="ml-auto text-xs font-medium text-violet-600 hover:underline disabled:opacity-50" disabled={select.isPending}>Choose</button>}</div><p className="mt-1 text-sm font-medium text-slate-800 dark:text-neutral-100">{m.title}</p><p className="mt-0.5 text-xs text-slate-500">{m.progress}/{m.target} · +{m.rewards.xp} XP · +{m.rewards.credits} Credits</p><Meter value={m.progress} target={m.target} /></div>)}</div></div>}
  </section>;
}
