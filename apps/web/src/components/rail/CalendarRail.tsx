import { forwardRef } from 'react';
import { DateTime } from 'luxon';
import { CalendarDays, CornerDownLeft, ListTodo, Target, Zap } from 'lucide-react';
import MiniMonth from '../calendar/MiniMonth.js';
import CollapsibleSection from './CollapsibleSection.js';
import TodayFocusPanel from './TodayFocusPanel.js';
import WeeklyObjectivesPanel from './WeeklyObjectivesPanel.js';
import TaskSidebar from '../TaskSidebar.js';

export default forwardRef<HTMLDivElement, { dropActive: boolean; onJump: (d: Date) => void }>(function CalendarRail(
  { dropActive, onJump },
  ref,
) {
  return (
    <div
      ref={ref}
      className={[
        'relative flex w-[21rem] shrink-0 flex-col gap-3 overflow-y-auto rounded-2xl border-2 border-dashed p-1.5 transition-colors',
        dropActive
          ? 'border-teal-400 bg-teal-50/50 dark:border-teal-500/50 dark:bg-teal-500/[0.06]'
          : 'border-transparent',
      ].join(' ')}
    >
      {dropActive && (
        <div className="pointer-events-none sticky top-1/2 z-10 -mt-4 flex items-center justify-center gap-1.5 text-xs font-semibold text-teal-600 dark:text-teal-300">
          <CornerDownLeft size={14} /> Drop here to unschedule
        </div>
      )}
      <CollapsibleSection title="Jump to date" icon={CalendarDays} accent="slate" defaultOpen={false}>
        <div className="flex justify-center">
          <MiniMonth value={DateTime.now()} onSelect={(d) => onJump(d.toJSDate())} />
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="Today's focus" icon={Zap} accent="teal">
        <TodayFocusPanel />
      </CollapsibleSection>
      <CollapsibleSection title="Weekly objectives" icon={Target} accent="indigo">
        <WeeklyObjectivesPanel />
      </CollapsibleSection>
      <CollapsibleSection
        title="Tasks"
        icon={ListTodo}
        accent="amber"
        right={
          <span className="hidden text-[10px] font-medium text-slate-400 dark:text-neutral-500 sm:inline">
            drag to schedule
          </span>
        }
      >
        <TaskSidebar />
      </CollapsibleSection>
    </div>
  );
});
