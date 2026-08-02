// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkoutExerciseDTO, WorkoutExerciseHistoryDTO } from '@timeblock/shared';
import { ExerciseFilters, ExerciseRow, SessionHistory } from './WorkoutStrength.js';

const history: WorkoutExerciseHistoryDTO = {
  schema_version: 1,
  exercise: 'Bench Press',
  muscle: 'chest',
  epochs: [{ epoch: 0, first_date: '2026-07-08', last_date: '2026-07-08', sessions: 1 }],
  sessions: [{
    date: '2026-07-08', title: 'Upper strength', duration_min: 55, total_volume: 1500,
    working_sets: 3, top_weight: 100, top_reps: 5, top_e1rm: 116.7,
    sets: [
      { index: 0, type: 'warmup', weight: 60, reps: 8, rpe: null, rir: null, rest_seconds: 90, e1rm: 76, volume: 480, epoch: 0, is_working: false, quality_flag: null },
      { index: 1, type: 'normal', weight: 100, reps: 5, rpe: 8, rir: 2, rest_seconds: 180, e1rm: 116.7, volume: 500, epoch: 0, is_working: true, quality_flag: 'reviewed_correction' },
    ],
  }],
};

describe('Strength session disclosure', () => {
  afterEach(cleanup);

  it('renders expandable complete set history and data-quality context', () => {
    const { container } = render(<SessionHistory history={history} loading={false} error={null} />);
    const disclosure = container.querySelector('details');
    expect(disclosure).not.toBeNull();
    fireEvent.click(screen.getByText('Upper strength'));
    expect(disclosure?.open).toBe(true);
    for (const field of ['RPE', 'RIR', 'Rest', 'e1RM', 'Volume', 'Epoch', 'Data note: reviewed correction']) expect(container.textContent).toContain(field);
    expect(screen.getByText('warmup')).toBeTruthy();
  });

  it('explains empty and error states', () => {
    const { rerender } = render(<SessionHistory history={{ ...history, sessions: [] }} loading={false} error={null} />);
    expect(screen.getByText('No sessions fall inside this date range.')).toBeTruthy();
    rerender(<SessionHistory loading={false} error={new Error('History unavailable')} />);
    expect(screen.getByText('History unavailable')).toBeTruthy();
  });

  it('operates exercise selection and all filters from accessible controls', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onParam = vi.fn();
    const lift = { name: 'Bench Press', muscle: 'chest', epoch: 0, n_sessions: 8, last_trained: '2026-07-08', best_e1rm: 116.7, best_e1rm_set: '100 × 5', heaviest: '100 × 5', e1rm_trend_per_week: 1.2, trend_confidence: 'high', status: 'progressing', recent_pr: null, next_target: null, forecast: null, individualization: { grace_state: 'learning', confidence: 55, n_fresh: 6 }, plateau: { verdict: 'progressing', onset: null }, series: [['2026-07-01', 110], ['2026-07-08', 116.7]] } as WorkoutExerciseDTO;
    const { rerender } = render(<ExerciseRow exercise={lift} selected={false} onClick={onSelect} />);
    await user.click(screen.getByRole('button', { name: /Bench Press/i }));
    expect(onSelect).toHaveBeenCalledOnce();

    rerender(<ExerciseFilters search="" status="all" muscle="all" sort="attention" muscles={['chest', 'legs']} onParam={onParam} />);
    await user.type(screen.getByPlaceholderText('Search exercises'), 'bench');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'plateau' } });
    fireEvent.change(screen.getByLabelText('Muscle'), { target: { value: 'chest' } });
    fireEvent.change(screen.getByLabelText('Sort exercises'), { target: { value: 'recent' } });
    expect(onParam).toHaveBeenCalledWith('status', 'plateau', true);
    expect(onParam).toHaveBeenCalledWith('muscle', 'chest', true);
    expect(onParam).toHaveBeenCalledWith('sort', 'recent', true);
  });
});
