import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useXpHistory } from '../../hooks.js';
import { SectionCard } from './SectionCard.js';

export default function XpSparkline() {
  const { data } = useXpHistory(30);
  const total = (data ?? []).reduce((sum, d) => sum + d.xp, 0);

  return (
    <SectionCard title="XP · last 30 days" badge={<span className="text-xs font-semibold text-[var(--g-text-dim)]">+{total} XP</span>}>
      <div className="h-16 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data ?? []} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="g-xp-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--g-xp-a)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--g-xp-a)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Tooltip
              cursor={false}
              contentStyle={{ background: '#0e1424', border: '1px solid var(--g-border)', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: 'var(--g-text-dim)' }}
              formatter={(value: number) => [`+${value} XP`, undefined]}
              labelFormatter={(label: string) => new Date(label + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            />
            <Area type="monotone" dataKey="xp" stroke="var(--g-xp-a)" strokeWidth={2} fill="url(#g-xp-fill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  );
}
