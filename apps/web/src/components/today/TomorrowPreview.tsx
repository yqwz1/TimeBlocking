import type { ScheduleItemDTO } from '@timeblock/shared';
import { blockMinutes, fmtDur, fmtTime } from './format.js';
import { KindIcon } from './SectionCard.js';

function TomorrowRow({ item }: { item: ScheduleItemDTO }) {
  return (
    <li className="flex items-center gap-3 rounded-lg px-1 py-1.5">
      <span className="w-16 shrink-0 text-right text-xs font-medium tabular-nums text-[var(--g-text-faint)]">{fmtTime(item.start)}</span>
      <KindIcon kind={item.kind} className="shrink-0 text-[var(--g-text-faint)]" />
      <span className="truncate text-sm text-[var(--g-text-dim)]">{item.title}</span>
      <span className="ml-auto shrink-0 text-xs text-[var(--g-text-faint)]">{fmtDur(blockMinutes(item))}</span>
    </li>
  );
}

export default function TomorrowPreview({ items }: { items: ScheduleItemDTO[] }) {
  if (items.length === 0) return <p className="text-sm text-[var(--g-text-faint)]">Nothing planned yet — tomorrow fills in as tasks are scheduled.</p>;
  return (
    <ul className="divide-y divide-white/5">
      {items
        .slice()
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
        .map((b) => (
          <TomorrowRow key={b.id} item={b} />
        ))}
    </ul>
  );
}
