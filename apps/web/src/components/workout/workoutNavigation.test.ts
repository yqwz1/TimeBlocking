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

  it('restores the powerlifting panel and selected competition lift from URL state', () => {
    const state = resolveWorkoutRoute(new URLSearchParams('section=powerlifting&panel=lift&lift=deadlift&range=8w'));
    expect(state).toMatchObject({ section: 'powerlifting', powerliftingPanel: 'lift', powerliftingLift: 'deadlift', range: '8w' });
    expect(resolveWorkoutRoute(new URLSearchParams('section=powerlifting&panel=nope&lift=row')).powerliftingPanel).toBe('overview');
  });

  it('keeps the Volume & recovery controls in shareable URL state', () => {
    const state = resolveWorkoutRoute(new URLSearchParams('section=volume&range=8w&compare=1&metric=recovery&region=lower&sort=load'));
    expect(state).toMatchObject({ section: 'volume', range: '8w', compare: true, volumeMetric: 'recovery', volumeRegion: 'lower', volumeSort: 'load' });
  });
});
