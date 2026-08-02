import { describe, expect, it } from 'vitest';
import { resolveWorkoutRoute, selectWorkoutSection, setWorkoutParameter } from './workoutNavigation.js';

describe('workout URL state', () => {
  it('restores the complete strength workspace from URL parameters', () => {
    const state = resolveWorkoutRoute(new URLSearchParams('section=strength&range=8w&exercise=Bench+Press&metric=sessions&status=plateau&muscle=chest&sort=recent&search=bench&compare=1'));
    expect(state).toMatchObject({ section: 'strength', range: '8w', exercise: 'Bench Press', strengthMode: 'sessions', status: 'plateau', muscle: 'chest', strengthSort: 'recent', search: 'bench', compare: true });
  });

  it('uses safe defaults and preserves unrelated parameters during selection', () => {
    expect(resolveWorkoutRoute(new URLSearchParams('section=nope&range=1w&metric=nope'))).toMatchObject({ section: 'overview', range: '12w', overviewMetric: 'workingSets' });
    const selected = selectWorkoutSection(new URLSearchParams('range=4w&metric=volume&exercise=Squat'), 'strength', { exercise: 'Bench Press' });
    expect(selected.toString()).toContain('range=4w');
    expect(selected.get('metric')).toBe('progress');
    expect(selected.get('exercise')).toBe('Bench Press');
    expect(setWorkoutParameter(selected, 'muscle', 'all').has('muscle')).toBe(false);
  });
});
