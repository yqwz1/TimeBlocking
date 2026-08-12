import { useMemo, useState } from 'react';
import type { AchievementProgress, Mission, ProgressionDashboard, ProgressionEvent, RewardItem } from '@timeblock/shared';
import {
  Activity,
  Award,
  BarChart3,
  CalendarCheck2,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Coins,
  Flame,
  Focus,
  Gift,
  History,
  LayoutDashboard,
  LockKeyhole,
  Medal,
  Plus,
  RefreshCcw,
  ShieldCheck,
  ShoppingBag,
  Sprout,
  Target,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  useClaimProgressionReward,
  useCreateProgressionReward,
  useProgressionAchievements,
  useProgressionDashboard,
  useProgressionRedemptions,
  useProgressionRewards,
} from '../hooks.js';

type Tab = 'overview' | 'missions' | 'achievements' | 'rewards' | 'history';

const tabs: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'missions', label: 'Missions', icon: Target },
  { id: 'achievements', label: 'Achievements', icon: Medal },
  { id: 'rewards', label: 'Rewards', icon: ShoppingBag },
  { id: 'history', label: 'History', icon: History },
];

const achievementIcons: Record<string, LucideIcon> = {
  Foundations: Sprout,
  Commitment: CalendarCheck2,
  Planning: Target,
  'Deep Focus': Focus,
  Resilience: RefreshCcw,
  Rewards: Gift,
};

const panel = 'rounded-xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900';
const muted = 'text-slate-500 dark:text-neutral-400';

export default function ProgressPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const { data: dashboard, isLoading } = useProgressionDashboard();
  const { data: achievements = [] } = useProgressionAchievements();
  const { data: rewards = [] } = useProgressionRewards();
  const { data: redemptions = [] } = useProgressionRedemptions();
  const claim = useClaimProgressionReward();
  const createReward = useCreateProgressionReward();

  if (isLoading || !dashboard) return <ProgressSkeleton />;

  const unlockedCount = achievements.filter((item) => item.unlockedAt).length;
  const activeMissions = [...(dashboard.contract?.missions ?? []), ...dashboard.weeklyMissions];

  return (
    <div className="mx-auto max-w-6xl pb-12">
      <header className="flex flex-wrap items-start justify-between gap-5 border-b border-slate-200 pb-5 dark:border-neutral-800">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-400">Season progress</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950 dark:text-neutral-50">Your progress</h1>
          <p className={`mt-1 max-w-xl text-sm ${muted}`}>A clear view of the work you have put in, what is next, and the rewards within reach.</p>
        </div>
        <div className="flex items-center gap-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
          <HeaderValue icon={Coins} label="Balance" value={`${dashboard.credits}`} suffix="credits" />
          <span className="h-8 w-px bg-slate-200 dark:bg-neutral-700" aria-hidden />
          <HeaderValue icon={Trophy} label="Rank" value={dashboard.season.tier} />
        </div>
      </header>

      <nav className="mt-4 flex gap-1 overflow-x-auto" aria-label="Progress sections">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${tab === id ? 'bg-slate-900 text-white dark:bg-neutral-100 dark:text-neutral-950' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'}`}>
            <Icon size={15} strokeWidth={1.8} />
            {label}
            {id === 'missions' && activeMissions.length > 0 && <CountBadge value={activeMissions.filter((item) => item.completedAt).length} total={activeMissions.length} active={tab === id} />}
            {id === 'achievements' && <CountBadge value={unlockedCount} total={achievements.length} active={tab === id} />}
          </button>
        ))}
      </nav>

      <main className="mt-5">
        {!dashboard.started && (tab === 'overview' || tab === 'missions') && <SeasonWaiting dashboard={dashboard} />}
        {tab === 'overview' && <div className={!dashboard.started ? 'mt-4' : ''}><Overview dashboard={dashboard} achievements={achievements} missions={activeMissions} /></div>}
        {tab === 'missions' && <div className={!dashboard.started ? 'mt-4' : ''}><Missions dashboard={dashboard} /></div>}
        {tab === 'achievements' && <Achievements items={achievements} />}
        {tab === 'rewards' && <Rewards items={rewards} credits={dashboard.credits} redemptions={redemptions} isClaiming={claim.isPending} isCreating={createReward.isPending} onClaim={(id) => claim.mutate(id)} onCreate={(input) => createReward.mutate(input)} />}
        {tab === 'history' && <ProgressHistory events={dashboard.recentEvents} />}
      </main>
    </div>
  );
}

function HeaderValue({ icon: Icon, label, value, suffix }: { icon: LucideIcon; label: string; value: string; suffix?: string }) {
  return <div className="flex items-center gap-2.5"><Icon size={18} className="text-slate-500 dark:text-neutral-400" strokeWidth={1.8} /><div><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">{label}</p><p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-neutral-100">{value}{suffix && <span className="ml-1 font-normal text-slate-500">{suffix}</span>}</p></div></div>;
}

function CountBadge({ value, total, active }: { value: number; total: number; active: boolean }) {
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${active ? 'bg-white/15 text-white dark:bg-black/10 dark:text-neutral-700' : 'bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400'}`}>{value}/{total}</span>;
}

function Overview({ dashboard, achievements, missions }: { dashboard: ProgressionDashboard; achievements: AchievementProgress[]; missions: Mission[] }) {
  const rankStart = rankFloor(dashboard.season.tier);
  const rankTarget = dashboard.season.nextTier?.at ?? Math.max(3200, dashboard.season.rankPoints);
  const completed = missions.filter((item) => item.completedAt).length;
  const chartData = useMemo(() => buildChartData(dashboard.recentEvents), [dashboard.recentEvents]);

  return <div className="space-y-4">
    <section className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 dark:border-neutral-800 dark:bg-neutral-800 sm:grid-cols-2 lg:grid-cols-4">
      <Stat icon={Award} label="Lifetime level" value={`Level ${dashboard.level}`} detail={`${dashboard.lifetimeXp.toLocaleString()} total XP`} />
      <Stat icon={Flame} label="Active-day streak" value={`${dashboard.activeStreak} days`} detail={`Best ${dashboard.longestStreak} days`} />
      <Stat icon={Target} label="Missions" value={`${completed} of ${missions.length}`} detail="Completed this cycle" />
      <Stat icon={Gift} label="Weekly bonus" value={`${dashboard.pendingWeeklyCredits}`} detail="Pending Credits" />
    </section>

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
      <section className={`${panel} p-5`}>
        <SectionHeading icon={BarChart3} title="Recent earnings" subtitle="XP and Credits recorded over the last seven days." />
        <div className="mt-5 h-56" aria-label="Bar chart of XP and Credits earned during the last seven days">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -24 }} barGap={3}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-100 dark:text-neutral-800" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} dy={8} />
              <YAxis axisLine={false} tickLine={false} allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
              <Tooltip cursor={{ fill: 'rgba(148,163,184,0.08)' }} contentStyle={{ borderRadius: 8, borderColor: '#e2e8f0', boxShadow: 'none', fontSize: 12 }} />
              <Bar dataKey="xp" name="XP" fill="#334155" radius={[3, 3, 0, 0]} maxBarSize={20} />
              <Bar dataKey="credits" name="Credits" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex justify-center gap-5 text-xs text-slate-500"><Legend color="bg-slate-600" label="XP" /><Legend color="bg-emerald-500" label="Credits" /></div>
      </section>

      <section className={`${panel} p-5`}>
        <SectionHeading icon={Trophy} title="Season standing" subtitle={`${formatDate(dashboard.season.startLocal)} – ${formatDate(dashboard.season.endLocal)}`} />
        <div className="mt-6 flex items-end justify-between gap-4"><div><p className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-neutral-50">{dashboard.season.tier}</p><p className={`mt-1 text-sm ${muted}`}>{dashboard.season.rankPoints.toLocaleString()} rank points</p></div><Trophy size={34} strokeWidth={1.35} className="text-amber-500" /></div>
        <ProgressBar value={dashboard.season.rankPoints - rankStart} target={Math.max(1, rankTarget - rankStart)} className="mt-5" />
        <div className="mt-2 flex justify-between text-xs text-slate-500"><span>{dashboard.season.tier}</span><span>{dashboard.season.nextTier ? `${Math.max(0, dashboard.season.nextTier.at - dashboard.season.rankPoints)} to ${dashboard.season.nextTier.name}` : 'Highest rank'}</span></div>
        <div className="mt-6 border-t border-slate-100 pt-4 dark:border-neutral-800"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Lifetime level</p><ProgressBar value={dashboard.xpIntoLevel} target={dashboard.xpForNextLevel} className="mt-3" tone="slate" /><p className={`mt-2 text-xs ${muted}`}>{dashboard.xpIntoLevel} of {dashboard.xpForNextLevel} XP toward Level {dashboard.level + 1}</p></div>
      </section>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <section className={`${panel} p-5`}><SectionHeading icon={Target} title="Mission progress" subtitle="Today and this week." /><div className="mt-4 space-y-4">{missions.slice(0, 4).map((mission) => <CompactMission key={mission.id} mission={mission} />)}{missions.length === 0 && <EmptyLine text="No missions are active yet." />}</div></section>
      <section className={`${panel} p-5`}><SectionHeading icon={Medal} title="Achievement progress" subtitle={`${achievements.filter((item) => item.unlockedAt).length} of ${achievements.length} unlocked.`} /><div className="mt-4 space-y-4">{[...achievements].filter((item) => !item.unlockedAt).sort((a, b) => b.progress / b.target - a.progress / a.target).slice(0, 4).map((item) => <CompactAchievement key={item.id} item={item} />)}{achievements.every((item) => item.unlockedAt) && <EmptyLine text="Every achievement is unlocked." />}</div></section>
    </div>
  </div>;
}

function Stat({ icon: Icon, label, value, detail }: { icon: LucideIcon; label: string; value: string; detail: string }) {
  return <div className="bg-white p-4 dark:bg-neutral-900"><div className="flex items-center gap-2 text-slate-500 dark:text-neutral-400"><Icon size={15} strokeWidth={1.8} /><p className="text-xs font-medium">{label}</p></div><p className="mt-3 text-xl font-semibold tabular-nums text-slate-950 dark:text-neutral-50">{value}</p><p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">{detail}</p></div>;
}

function Missions({ dashboard }: { dashboard: ProgressionDashboard }) {
  const daily = dashboard.contract?.missions ?? [];
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
    <div className="space-y-4">
      <MissionGroup title="Today" subtitle={contractCopy(dashboard)} missions={daily} />
      <MissionGroup title="This week" subtitle="Longer goals that reward consistent work." missions={dashboard.weeklyMissions} />
    </div>
    <aside className={`${panel} h-fit p-5 lg:sticky lg:top-4`}><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Contract summary</p><div className="mt-5 space-y-5"><SummaryRow label="Core missions" value={dashboard.contract?.coreComplete ? 'Complete' : 'In progress'} done={dashboard.contract?.coreComplete} /><SummaryRow label="Optional mission" value={dashboard.contract?.optionalComplete ? 'Complete' : 'In progress'} done={dashboard.contract?.optionalComplete} /><SummaryRow label="Pending bonus" value={`${dashboard.pendingWeeklyCredits} Credits`} /></div><p className={`mt-6 border-t border-slate-100 pt-4 text-xs leading-5 dark:border-neutral-800 ${muted}`}>Core missions maintain your streak. Optional missions improve rewards but never put the streak at risk.</p></aside>
  </div>;
}

function MissionGroup({ title, subtitle, missions }: { title: string; subtitle: string; missions: Mission[] }) {
  return <section className={`${panel} p-5`}><SectionHeading icon={title === 'Today' ? CalendarCheck2 : Target} title={title} subtitle={subtitle} /><div className="mt-5 divide-y divide-slate-100 dark:divide-neutral-800">{missions.map((mission) => <MissionRow key={mission.id} mission={mission} />)}{missions.length === 0 && <EmptyLine text="No missions in this section." />}</div></section>;
}

function MissionRow({ mission }: { mission: Mission }) {
  const done = !!mission.completedAt;
  return <article className="py-4 first:pt-0 last:pb-0"><div className="flex items-start gap-3"><span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${done ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' : 'bg-slate-100 text-slate-400 dark:bg-neutral-800 dark:text-neutral-500'}`}>{done ? <Check size={15} /> : <Circle size={14} />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium text-slate-900 dark:text-neutral-100">{mission.title}</h3><span className="text-xs capitalize text-slate-400">{mission.type}</span></div><p className={`mt-1 text-sm ${muted}`}>{mission.detail}</p><div className="mt-3"><ProgressBar value={mission.progress} target={mission.target} /></div><div className="mt-2 flex flex-wrap justify-between gap-2 text-xs"><span className="tabular-nums text-slate-500">{mission.progress} / {mission.target}</span><span className="text-slate-400">+{mission.rewards.xp} XP · +{mission.rewards.credits} Credits · +{mission.rewards.rankPoints} rank</span></div></div></div></article>;
}

function Achievements({ items }: { items: AchievementProgress[] }) {
  const categories = ['All', ...new Set(items.map((item) => item.category))];
  const [category, setCategory] = useState('All');
  const [showUnlocked, setShowUnlocked] = useState(true);
  const visible = items.filter((item) => (category === 'All' || item.category === category) && (showUnlocked || !item.unlockedAt));
  return <div>
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-1 overflow-x-auto">{categories.map((name) => <button key={name} onClick={() => setCategory(name)} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${category === name ? 'bg-slate-900 text-white dark:bg-neutral-100 dark:text-neutral-950' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800'}`}>{name}</button>)}</div><label className={`flex items-center gap-2 text-xs ${muted}`}><input type="checkbox" checked={showUnlocked} onChange={(event) => setShowUnlocked(event.target.checked)} />Show unlocked</label></div>
    <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{visible.map((item) => <AchievementCard key={item.id} item={item} />)}</section>
  </div>;
}

function AchievementCard({ item }: { item: AchievementProgress }) {
  const Icon = achievementIcons[item.category] ?? Award;
  const done = !!item.unlockedAt;
  return <article className={`${panel} p-4 ${done ? 'border-emerald-200 dark:border-emerald-900/70' : ''}`}><div className="flex items-start justify-between gap-3"><span className={`grid size-10 place-items-center rounded-lg ${done ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400'}`}><Icon size={20} strokeWidth={1.7} /></span><span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${done ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400'}`}>{done ? 'Unlocked' : `Tier ${item.tier}`}</span></div><p className="mt-4 text-xs font-medium text-slate-400">{item.category}</p><h3 className="mt-0.5 font-semibold text-slate-900 dark:text-neutral-100">{item.name}</h3><p className={`mt-1 min-h-10 text-sm leading-5 ${muted}`}>{item.requirement}</p><ProgressBar value={item.progress} target={item.target} className="mt-4" /><div className="mt-2 flex items-center justify-between text-xs"><span className="tabular-nums text-slate-500">{Math.min(item.progress, item.target)} / {item.target}</span><span className="text-slate-400">+{item.xp} XP · +{item.credits} Credits</span></div>{done && <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-emerald-700 dark:border-neutral-800 dark:text-emerald-400">Unlocked {formatDate(item.unlockedAt!)}</p>}</article>;
}

type RewardDraft = Pick<RewardItem, 'title' | 'description' | 'icon' | 'creditCost' | 'template' | 'repeatable' | 'cooldownDays' | 'active' | 'realWorldPrice'>;

function Rewards({ items, credits, redemptions, isClaiming, isCreating, onClaim, onCreate }: { items: RewardItem[]; credits: number; redemptions: Array<{ id: string; rewardId: string; creditCost: number; status: string; claimedAt: string }>; isClaiming: boolean; isCreating: boolean; onClaim: (id: string) => void; onCreate: (input: RewardDraft) => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const sorted = [...items].sort((a, b) => Number(b.available) - Number(a.available) || a.creditCost - b.creditCost);
  const rewardNames = new Map(items.map((item) => [item.id, item.title]));
  return <div className="space-y-4">
    <section className={`${panel} flex flex-wrap items-center justify-between gap-4 p-5`}><div><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Available to spend</p><p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950 dark:text-neutral-50">{credits.toLocaleString()} <span className="text-base font-normal text-slate-500">Credits</span></p></div><div className="flex items-center gap-4"><p className="hidden max-w-sm text-sm text-slate-500 dark:text-neutral-400 sm:block">Choose rewards that make completed work feel tangible.</p><button type="button" onClick={() => setShowAdd((open) => !open)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-white"><Plus size={15} />Add reward</button></div></section>
    {showAdd && <RewardForm isCreating={isCreating} onCancel={() => setShowAdd(false)} onCreate={onCreate} />}
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]"><section><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-slate-900 dark:text-neutral-100">Reward shop</h2><p className={`text-xs ${muted}`}>{items.filter((item) => item.available).length} within reach</p></div><div className="grid gap-3 sm:grid-cols-2">{sorted.map((item) => <RewardCard key={item.id} item={item} credits={credits} isClaiming={isClaiming} onClaim={onClaim} />)}{items.length === 0 && <EmptyState icon={Gift} title="Your shop is empty" detail="Add a few real-life rewards, then price them in Credits." />}</div></section><aside className={`${panel} h-fit p-4 lg:sticky lg:top-4`}><SectionHeading icon={Clock3} title="Recent claims" subtitle="Rewards you chose." /><div className="mt-4 divide-y divide-slate-100 dark:divide-neutral-800">{redemptions.slice(0, 6).map((item) => <div key={item.id} className="py-3 first:pt-0"><div className="flex justify-between gap-3"><p className="text-sm font-medium text-slate-800 dark:text-neutral-200">{rewardNames.get(item.rewardId) ?? 'Reward'}</p><span className="text-xs font-medium capitalize text-slate-500">{item.status}</span></div><p className="mt-1 text-xs text-slate-400">{formatDate(item.claimedAt)} · {item.creditCost} Credits</p></div>)}{redemptions.length === 0 && <EmptyLine text="No rewards claimed yet." />}</div></aside></div>
  </div>;
}

function RewardForm({ isCreating, onCancel, onCreate }: { isCreating: boolean; onCancel: () => void; onCreate: (input: RewardDraft) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('🎁');
  const [template, setTemplate] = useState<RewardItem['template']>('small');
  const [creditCost, setCreditCost] = useState(120);
  const [repeatable, setRepeatable] = useState(true);
  const priceFor = (value: RewardItem['template']) => value === 'small' ? 120 : value === 'medium' ? 450 : value === 'major' ? 1800 : creditCost;
  return <form onSubmit={(event) => { event.preventDefault(); if (!title.trim()) return; onCreate({ title: title.trim(), description: description.trim(), icon: icon.trim() || null, creditCost, template, repeatable, cooldownDays: 0, active: true, realWorldPrice: null }); }} className={`${panel} p-5`}><div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-900 dark:text-neutral-100">Add a real-life reward</h2><p className={`mt-0.5 text-xs ${muted}`}>The app records claims; it never purchases or schedules the reward.</p></div><button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-900 dark:hover:text-neutral-100">Cancel</button></div><div className="mt-5 grid gap-4 md:grid-cols-[5rem_minmax(0,1fr)_9rem_8rem]"><label className="text-xs font-medium text-slate-500">Icon<input value={icon} onChange={(event) => setIcon(event.target.value)} maxLength={8} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-lg outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950" /></label><label className="text-xs font-medium text-slate-500">Title<input value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="Coffee break" className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" /></label><label className="text-xs font-medium text-slate-500">Size<select value={template} onChange={(event) => { const value = event.target.value as RewardItem['template']; setTemplate(value); setCreditCost(priceFor(value)); }} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"><option value="small">Small</option><option value="medium">Medium</option><option value="major">Major</option><option value="custom">Custom</option></select></label><label className="text-xs font-medium text-slate-500">Cost<input type="number" min="1" value={creditCost} onChange={(event) => { setCreditCost(Math.max(1, Number(event.target.value) || 1)); setTemplate('custom'); }} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" /></label></div><label className="mt-4 block text-xs font-medium text-slate-500">Description<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What makes this reward worth earning?" className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" /></label><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm text-slate-600 dark:text-neutral-300"><input type="checkbox" checked={repeatable} onChange={(event) => setRepeatable(event.target.checked)} />Can be claimed more than once</label><button type="submit" disabled={isCreating || !title.trim()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">{isCreating ? 'Adding…' : 'Add to shop'}</button></div></form>;
}

function RewardCard({ item, credits, isClaiming, onClaim }: { item: RewardItem; credits: number; isClaiming: boolean; onClaim: (id: string) => void }) {
  const pct = Math.min(100, (credits / Math.max(1, item.creditCost)) * 100);
  return <article className={`${panel} flex min-h-56 flex-col p-4`}><div className="flex items-start justify-between gap-3"><span className="grid size-10 place-items-center rounded-lg bg-amber-50 text-xl text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{item.icon || <Gift size={20} />}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">{item.template}</span></div><h3 className="mt-4 font-semibold text-slate-900 dark:text-neutral-100">{item.title}</h3><p className={`mt-1 flex-1 text-sm leading-5 ${muted}`}>{item.description || 'A personal reward for work completed.'}</p><div className="mt-4"><div className="flex items-center justify-between text-xs"><span className="font-semibold tabular-nums text-slate-800 dark:text-neutral-200">{item.creditCost} Credits</span><span className="text-slate-400">{credits >= item.creditCost ? 'Ready' : `${item.creditCost - credits} more needed`}</span></div><ProgressBar value={pct} target={100} className="mt-2" tone={item.available ? 'green' : 'slate'} /></div><div className="mt-4 flex items-center justify-between gap-3"><p className="text-[11px] text-slate-400">{item.repeatable ? `Repeatable${item.cooldownDays ? ` · ${item.cooldownDays}d cooldown` : ''}` : 'One-time reward'}</p><button type="button" onClick={() => onClaim(item.id)} disabled={!item.available || isClaiming} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-white dark:disabled:bg-neutral-800 dark:disabled:text-neutral-500">{item.available ? 'Claim reward' : <span className="inline-flex items-center gap-1"><LockKeyhole size={11} />Unavailable</span>}</button></div>{!item.available && item.unavailableReason && <p className="mt-2 text-right text-[11px] text-slate-400">{item.unavailableReason}</p>}</article>;
}

function ProgressHistory({ events }: { events: ProgressionEvent[] }) {
  const earned = events.filter((event) => event.amount > 0).reduce((sum, event) => sum + event.amount, 0);
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]"><section className={`${panel} p-5`}><SectionHeading icon={History} title="Progress history" subtitle="Your most recent progression events." /><div className="mt-4 divide-y divide-slate-100 dark:divide-neutral-800">{events.map((event) => <div key={event.seq} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><span className={`grid size-8 shrink-0 place-items-center rounded-full ${event.amount >= 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400'}`}>{event.amount >= 0 ? <Activity size={15} /> : <RefreshCcw size={15} />}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium capitalize text-slate-800 dark:text-neutral-200">{event.kind.replaceAll('_', ' ')}</p><p className="mt-0.5 text-xs text-slate-400">{formatDateTime(event.createdAt)}</p></div><span className={`text-sm font-semibold tabular-nums ${event.amount >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{event.amount > 0 ? '+' : ''}{event.amount} {resourceLabel(event.resource)}</span></div>)}{events.length === 0 && <EmptyLine text="Progress events will appear here after you complete work." />}</div></section><aside className={`${panel} h-fit p-5`}><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Recent summary</p><p className="mt-4 text-3xl font-semibold tabular-nums text-slate-950 dark:text-neutral-50">+{earned}</p><p className={`mt-1 text-sm ${muted}`}>positive value across {events.length} recent events</p><p className={`mt-5 border-t border-slate-100 pt-4 text-xs leading-5 dark:border-neutral-800 ${muted}`}>Lifetime XP never decreases. Only seasonal rank and pending bonuses can be affected by a missed committed day.</p></aside></div>;
}

function ProgressBar({ value, target, className = '', tone = 'green' }: { value: number; target: number; className?: string; tone?: 'green' | 'slate' }) {
  const pct = Math.max(0, Math.min(100, target > 0 ? value / target * 100 : 0));
  return <div className={`h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800 ${className}`}><div className={`h-full rounded-full transition-[width] duration-500 ${tone === 'green' ? 'bg-emerald-500' : 'bg-slate-500 dark:bg-neutral-400'}`} style={{ width: `${pct}%` }} /></div>;
}

function CompactMission({ mission }: { mission: Mission }) {
  return <div><div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-medium text-slate-800 dark:text-neutral-200">{mission.title}</p><span className="shrink-0 text-xs tabular-nums text-slate-400">{mission.progress}/{mission.target}</span></div><ProgressBar value={mission.progress} target={mission.target} className="mt-2" /></div>;
}

function CompactAchievement({ item }: { item: AchievementProgress }) {
  const Icon = achievementIcons[item.category] ?? Award;
  return <div className="flex items-center gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400"><Icon size={16} /></span><div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><p className="truncate text-sm font-medium text-slate-800 dark:text-neutral-200">{item.name}</p><span className="text-xs tabular-nums text-slate-400">{item.progress}/{item.target}</span></div><ProgressBar value={item.progress} target={item.target} className="mt-1.5" tone="slate" /></div></div>;
}

function SectionHeading({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle: string }) {
  return <div className="flex items-start gap-2.5"><Icon size={17} className="mt-0.5 text-slate-500 dark:text-neutral-400" strokeWidth={1.8} /><div><h2 className="font-semibold text-slate-900 dark:text-neutral-100">{title}</h2><p className={`mt-0.5 text-xs ${muted}`}>{subtitle}</p></div></div>;
}

function SummaryRow({ label, value, done }: { label: string; value: string; done?: boolean }) {
  return <div className="flex items-center gap-3">{done === undefined ? <ShieldCheck size={17} className="text-slate-400" /> : done ? <CheckCircle2 size={17} className="text-emerald-600" /> : <Circle size={17} className="text-slate-300 dark:text-neutral-600" />}<div><p className="text-xs text-slate-400">{label}</p><p className="text-sm font-medium text-slate-800 dark:text-neutral-200">{value}</p></div></div>;
}

function Legend({ color, label }: { color: string; label: string }) { return <span className="inline-flex items-center gap-1.5"><span className={`size-2 rounded-sm ${color}`} />{label}</span>; }
function EmptyLine({ text }: { text: string }) { return <p className={`py-5 text-center text-sm ${muted}`}>{text}</p>; }
function EmptyState({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) { return <div className={`${panel} col-span-full grid min-h-52 place-items-center p-8 text-center`}><div><Icon size={24} className="mx-auto text-slate-400" /><h3 className="mt-3 font-medium text-slate-800 dark:text-neutral-200">{title}</h3><p className={`mt-1 text-sm ${muted}`}>{detail}</p></div></div>; }

function SeasonWaiting({ dashboard }: { dashboard: ProgressionDashboard }) {
  return <section className={`${panel} mt-5 p-8 text-center`}><CalendarCheck2 size={28} className="mx-auto text-emerald-600" /><h2 className="mt-3 text-lg font-semibold text-slate-900 dark:text-neutral-100">Season 1 begins {formatDate(dashboard.season.startLocal)}</h2><p className={`mx-auto mt-2 max-w-lg text-sm ${muted}`}>Your progress starts fresh when the season opens. Legacy XP remains preserved separately.</p></section>;
}

function ProgressSkeleton() { return <div className="mx-auto max-w-6xl animate-pulse"><div className="h-9 w-52 rounded bg-slate-100 dark:bg-neutral-800" /><div className="mt-3 h-4 w-96 max-w-full rounded bg-slate-100 dark:bg-neutral-800" /><div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 rounded-xl bg-slate-100 dark:bg-neutral-800" />)}</div><div className="mt-4 h-72 rounded-xl bg-slate-100 dark:bg-neutral-800" /></div>; }

function buildChartData(events: ProgressionEvent[]) {
  const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - (6 - index)); return date; });
  return days.map((date) => {
    const key = date.toISOString().slice(0, 10);
    const rows = events.filter((event) => event.createdAt.slice(0, 10) === key && event.amount > 0);
    return { label: date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2), xp: rows.filter((event) => event.resource === 'xp').reduce((sum, event) => sum + event.amount, 0), credits: rows.filter((event) => event.resource === 'credits').reduce((sum, event) => sum + event.amount, 0) };
  });
}

function rankFloor(tier: string) { return ({ Bronze: 0, Silver: 400, Gold: 900, Platinum: 1600, Diamond: 2400, Apex: 3200 } as Record<string, number>)[tier] ?? 0; }
function formatDate(value: string) { const date = new Date(value.includes('T') ? value : `${value}T00:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
function formatDateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function resourceLabel(resource: ProgressionEvent['resource']) { return resource === 'rank_points' ? 'rank' : resource === 'credits' ? 'Credits' : 'XP'; }
function contractCopy(dashboard: ProgressionDashboard) { const state = dashboard.contract?.state; if (state === 'rest') return 'Planned rest day. Your streak is paused safely.'; if (state === 'complete') return 'Today’s full contract is complete.'; if (state === 'failed') return 'Today’s committed contract was missed.'; return 'Complete the core missions to maintain your streak.'; }
