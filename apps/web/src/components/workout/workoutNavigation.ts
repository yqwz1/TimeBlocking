import type { WorkoutView } from './WorkoutSidebar.js';
import type { OverviewMetric } from './WorkoutOverview.js';
import type { StrengthMode } from './WorkoutStrength.js';
import type { PowerliftingPanel } from './WorkoutPowerlifting.js';
import type { WorkoutPowerliftingSlot } from '@timeblock/shared';
import type { StrengthSort, WorkoutRange } from './workoutAnalytics.js';
import type { VolumeChartMetric, VolumeSort } from './workoutVolumeAnalytics.js';

const VIEWS = new Set<WorkoutView>(['overview', 'strength', 'powerlifting', 'volume', 'body', 'calendar', 'records', 'goals', 'tools', 'settings']);
const RANGES = new Set<WorkoutRange>(['4w', '8w', '12w', 'all']);
const OVERVIEW_METRICS = new Set<OverviewMetric>(['sessions', 'workingSets', 'volume', 'bodyweight']);
const STRENGTH_MODES = new Set<StrengthMode>(['progress', 'performance', 'sessions', 'coach', 'compare']);
const STRENGTH_SORTS = new Set<StrengthSort>(['attention', 'trend', 'recent', 'sessions', 'e1rm', 'name']);
const POWERLIFTING_PANELS = new Set<PowerliftingPanel>(['overview', 'lift', 'meet']);
const POWERLIFTING_SLOTS = new Set<WorkoutPowerliftingSlot>(['squat', 'bench', 'deadlift']);
const VOLUME_METRICS = new Set<VolumeChartMetric>(['sets', 'load', 'recovery']);
const VOLUME_SORTS = new Set<VolumeSort>(['attention', 'volume', 'load', 'name']);

export function resolveWorkoutRoute(params: URLSearchParams) {
  const requestedView = params.get('section') as WorkoutView | null;
  const section: WorkoutView = requestedView && VIEWS.has(requestedView) ? requestedView : 'overview';
  const requestedRange = params.get('range') as WorkoutRange | null;
  const range: WorkoutRange = requestedRange && RANGES.has(requestedRange) ? requestedRange : '12w';
  const overviewMetricParam = params.get('metric') as OverviewMetric | null;
  const strengthModeParam = params.get('metric') as StrengthMode | null;
  const strengthSortParam = params.get('sort') as StrengthSort | null;
  const powerliftingPanelParam = params.get('panel') as PowerliftingPanel | null;
  const powerliftingLiftParam = params.get('lift') as WorkoutPowerliftingSlot | null;
  const volumeMetricParam = params.get('metric') as VolumeChartMetric | null;
  const volumeSortParam = params.get('sort') as VolumeSort | null;
  return {
    section,
    range,
    compare: params.get('compare') === '1',
    exercise: params.get('exercise') ?? '',
    search: params.get('search') ?? '',
    status: params.get('status') ?? 'all',
    muscle: params.get('muscle') ?? 'all',
    overviewMetric: overviewMetricParam && OVERVIEW_METRICS.has(overviewMetricParam) ? overviewMetricParam : 'workingSets' as OverviewMetric,
    strengthMode: strengthModeParam && STRENGTH_MODES.has(strengthModeParam) ? strengthModeParam : 'progress' as StrengthMode,
    strengthSort: strengthSortParam && STRENGTH_SORTS.has(strengthSortParam) ? strengthSortParam : 'attention' as StrengthSort,
    powerliftingPanel: powerliftingPanelParam && POWERLIFTING_PANELS.has(powerliftingPanelParam) ? powerliftingPanelParam : 'overview' as PowerliftingPanel,
    powerliftingLift: powerliftingLiftParam && POWERLIFTING_SLOTS.has(powerliftingLiftParam) ? powerliftingLiftParam : 'squat' as WorkoutPowerliftingSlot,
    volumeMetric: volumeMetricParam && VOLUME_METRICS.has(volumeMetricParam) ? volumeMetricParam : 'sets' as VolumeChartMetric,
    volumeRegion: params.get('region') ?? 'all',
    volumeSort: volumeSortParam && VOLUME_SORTS.has(volumeSortParam) ? volumeSortParam : 'attention' as VolumeSort,
  };
}

export function setWorkoutParameter(params: URLSearchParams, key: string, value: string) {
  const next = new URLSearchParams(params);
  if (!value || (value === 'all' && ['status', 'muscle', 'region'].includes(key))) next.delete(key);
  else next.set(key, value);
  return next;
}

export function selectWorkoutSection(params: URLSearchParams, section: WorkoutView, extras: Record<string, string> = {}) {
  let next = setWorkoutParameter(params, 'section', section);
  if (section === 'overview' && !OVERVIEW_METRICS.has(next.get('metric') as OverviewMetric)) next.set('metric', 'workingSets');
  if (section === 'strength' && !STRENGTH_MODES.has(next.get('metric') as StrengthMode)) next.set('metric', 'progress');
  if (section === 'powerlifting' && !POWERLIFTING_PANELS.has(next.get('panel') as PowerliftingPanel)) next.set('panel', 'overview');
  if (section === 'volume' && !VOLUME_METRICS.has(next.get('metric') as VolumeChartMetric)) next.set('metric', 'sets');
  for (const [key, value] of Object.entries(extras)) next = setWorkoutParameter(next, key, value);
  return next;
}
