import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DayWeekPlanner from '../components/plan/DayWeekPlanner.js';
import TodayView from '../components/today/TodayView.js';

export default function TodayPage({ onOpenTask }: { onOpenTask?: (id: string | null) => void }) {
  const [mode, setMode] = useState<'today' | 'plan'>('today');
  const [, setParams] = useSearchParams();

  const openObjectives = () =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('view', 'objectives');
      return n;
    });

  if (mode === 'plan') {
    return <DayWeekPlanner onExit={() => setMode('today')} />;
  }
  return <TodayView onPlan={() => setMode('plan')} onOpenObjectives={openObjectives} onOpenTask={onOpenTask} />;
}
