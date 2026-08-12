import type { WorkoutExerciseDTO, WorkoutPowerliftingLift, WorkoutPowerliftingSlot, WorkoutSummaryDTO } from '@timeblock/shared';
import { rangeBounds, type WorkoutRange } from './workoutAnalytics.js';

export const POWERLIFTING_SLOTS: WorkoutPowerliftingSlot[] = ['squat', 'bench', 'deadlift'];
export const slotLabel: Record<WorkoutPowerliftingSlot, string> = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' };

export type PowerliftingLiftModel = {
  slot: WorkoutPowerliftingSlot;
  label: string;
  lift: WorkoutPowerliftingLift;
  exercise: WorkoutExerciseDTO | null;
  current: number | null;
  best: number | null;
  contribution: number | null;
};

export function roundLoad(target: number, barWeight: number, platePairs: number[]) {
  const smallest = Math.min(...platePairs);
  const increment = smallest * 2;
  return Math.max(barWeight, Math.round((target - barWeight) / increment) * increment + barWeight);
}

export function plateBreakdown(target: number, barWeight: number, platePairs: number[]) {
  const load = roundLoad(target, barWeight, platePairs);
  let remaining = Math.max(0, (load - barWeight) / 2);
  const perSide: number[] = [];
  for (const plate of [...platePairs].sort((a, b) => b - a)) {
    while (remaining + 1e-9 >= plate) {
      perSide.push(plate);
      remaining -= plate;
    }
  }
  const loaded = barWeight + 2 * perSide.reduce((total, plate) => total + plate, 0);
  return { requested: target, loaded: Math.round(loaded * 100) / 100, perSide };
}

export function dotsCoefficient(bodyweight: number, sex: 'male' | 'female') {
  const coefficients = sex === 'female'
    ? [-57.96288, 13.6175032, -0.1126655495, 0.0005158568, -0.0000010706]
    : [-307.75076, 24.0900756, -0.1918759221, 0.0007391293, -0.000001093];
  const denominator = coefficients.reduce((total, coefficient, index) => total + coefficient * bodyweight ** index, 0);
  return denominator > 0 ? 500 / denominator : null;
}

export function wilksCoefficient(bodyweight: number, sex: 'male' | 'female') {
  const coefficients = sex === 'female'
    ? [594.31747775582, -27.23842536447, 0.82112226871, -0.00930733913, 0.00004731582, -0.00000009054]
    : [-216.0475144, 16.2606339, -0.002388645, -0.00113732, 0.00000701863, -0.00000001291];
  const denominator = coefficients.reduce((total, coefficient, index) => total + coefficient * bodyweight ** index, 0);
  return denominator > 0 ? 500 / denominator : null;
}

export function powerliftingScore(total: number | null, bodyweight: number | null, sex: 'male' | 'female', score: 'dots' | 'wilks') {
  if (total == null || bodyweight == null || bodyweight <= 0) return null;
  const coefficient = score === 'wilks' ? wilksCoefficient(bodyweight, sex) : dotsCoefficient(bodyweight, sex);
  return coefficient == null ? null : Math.round(total * coefficient * 10) / 10;
}

export function standardForLift(slot: WorkoutPowerliftingSlot, current: number | null, bodyweight: number | null, summary: WorkoutSummaryDTO) {
  const { standards } = summary.powerlifting.config;
  if (current == null || bodyweight == null) return null;
  const multiples = standards.bw_mult[slot] ?? [];
  const thresholds = multiples.map((multiple) => multiple * bodyweight);
  const tierIndex = thresholds.reduce((best, value, index) => current >= value ? index : best, -1);
  const elite = thresholds.at(-1) ?? null;
  return {
    thresholds,
    labels: standards.labels,
    tierIndex,
    label: tierIndex >= 0 ? standards.labels[tierIndex] ?? 'Building' : 'Building',
    elite,
    eliteRatio: elite ? current / elite : null,
  };
}

export function percentageRows(oneRepMax: number | null, barWeight: number, platePairs: number[]) {
  if (oneRepMax == null) return [];
  return [100, 95, 90, 85, 80, 75, 70, 65, 60].map((percent) => {
    const target = oneRepMax * percent / 100;
    const plates = plateBreakdown(target, barWeight, platePairs);
    return { percent, reps: percent >= 100 ? 1 : Math.max(1, Math.round(30 * (100 / percent - 1))), ...plates };
  });
}

export function repMaxRows(oneRepMax: number | null, barWeight: number, platePairs: number[]) {
  if (oneRepMax == null) return [];
  return [1, 2, 3, 5, 8, 10].map((reps) => {
    const target = reps === 1 ? oneRepMax : oneRepMax / (1 + reps / 30);
    const plates = plateBreakdown(target, barWeight, platePairs);
    return { reps, percent: Math.round(plates.loaded / oneRepMax * 100), ...plates };
  });
}

function addWeeks(day: string, weeks: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.round(weeks * 7));
  return date.toISOString().slice(0, 10);
}

export function projectedLift(lift: PowerliftingLiftModel, weeks: number) {
  if (lift.current == null) return null;
  const forecast = lift.exercise?.forecast;
  const horizon = forecast?.horizon_weeks ?? 0;
  const forecastValue = forecast?.e1rm_in_horizon;
  const slope = horizon > 0 && forecastValue != null ? Math.max(0, (forecastValue - lift.current) / horizon) : 0;
  const ceiling = lift.exercise?.plateau.ceiling?.ceiling ?? Infinity;
  return Math.min(ceiling, lift.current + slope * Math.max(0, weeks));
}

export function buildPowerliftingModel(summary: WorkoutSummaryDTO, range: WorkoutRange) {
  const power = summary.powerlifting;
  const bounds = rangeBounds(summary, range);
  const totalPoints = power.total_series.filter((point) => point.date >= bounds.from && point.date <= bounds.to);
  const latestPoint = power.total_series.at(-1) ?? null;
  const liftModels = POWERLIFTING_SLOTS.map((slot) => {
    const lift = power.lifts.find((item) => item.slot === slot) ?? { slot, name: null, present: false };
    const exercise = lift.name ? summary.exercises.find((item) => item.name === lift.name) ?? null : null;
    const current = latestPoint?.[slot] ?? exercise?.series.at(-1)?.[1] ?? lift.best_e1rm ?? null;
    return { slot, label: slotLabel[slot], lift, exercise, current, best: lift.best_e1rm ?? exercise?.best_e1rm ?? null, contribution: null };
  });
  const full = liftModels.every((lift) => lift.current != null);
  const currentTotal = full ? liftModels.reduce((total, lift) => total + (lift.current ?? 0), 0) : null;
  const bestTotal = liftModels.every((lift) => lift.best != null) ? liftModels.reduce((total, lift) => total + (lift.best ?? 0), 0) : null;
  const lifts = liftModels.map((lift) => ({ ...lift, contribution: currentTotal && lift.current != null ? lift.current / currentTotal : null }));
  const completePoints = totalPoints.filter((point) => point.present === 3);
  const totalDelta = completePoints.length >= 2 ? completePoints.at(-1)!.total - completePoints[0].total : null;
  const bodyweight = power.bodyweight_kg;
  const standards = lifts.map((lift) => ({ slot: lift.slot, standard: standardForLift(lift.slot, lift.current, bodyweight, summary) }));
  const weak = standards.filter((item) => item.standard?.eliteRatio != null).sort((a, b) => a.standard!.eliteRatio! - b.standard!.eliteRatio!)[0]?.slot ?? null;
  const score = powerliftingScore(currentTotal, bodyweight, power.config.sex, power.config.score);
  const ratio = currentTotal != null && bodyweight != null && bodyweight > 0 ? currentTotal / bodyweight : null;
  return { power, bounds, lifts, totalPoints, latestPoint, currentTotal, bestTotal, totalDelta, bodyweight, score, ratio, weak, full };
}

export function primaryPowerliftingInsight(model: ReturnType<typeof buildPowerliftingModel>) {
  const missing = model.lifts.find((lift) => !lift.lift.present || lift.current == null);
  if (missing) return { slot: missing.slot, title: `Map or log your ${missing.label.toLowerCase()}`, detail: `Your total is incomplete until ${missing.label.toLowerCase()} data is available.` };
  const declining = model.lifts.find((lift) => lift.exercise?.status === 'declining');
  if (declining) return { slot: declining.slot, title: `Protect your ${declining.label.toLowerCase()}`, detail: `Its recent trend is declining. Check readiness and use the next-session target conservatively.` };
  const plateau = model.lifts.find((lift) => lift.exercise?.status === 'plateau' && lift.slot === model.weak) ?? model.lifts.find((lift) => lift.exercise?.status === 'plateau');
  if (plateau) return { slot: plateau.slot, title: `Break the ${plateau.label.toLowerCase()} plateau`, detail: `It is flat in your current history and is the clearest opportunity to improve your total.` };
  const weak = model.lifts.find((lift) => lift.slot === model.weak);
  if (weak) return { slot: weak.slot, title: `Build your ${weak.label.toLowerCase()}`, detail: `It sits furthest from your configured elite bodyweight-multiple guide.` };
  const next = model.lifts.find((lift) => lift.exercise?.next_target);
  return { slot: next?.slot ?? 'squat', title: 'Follow the next-session prescription', detail: 'The coach has enough data to turn the next workout into a measurable progression step.' };
}

export function meetProjection(model: ReturnType<typeof buildPowerliftingModel>, today = new Date()) {
  const meetDate = model.power.config.meet_date;
  const daysOut = meetDate ? Math.round((Date.parse(`${meetDate}T00:00:00`) - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000) : null;
  const weeks = Math.max(0, (daysOut ?? 0) / 7);
  const lifts = model.lifts.map((lift) => ({ ...lift, projected: projectedLift(lift, weeks) }));
  const complete = lifts.every((lift) => lift.projected != null);
  const total = complete ? lifts.reduce((sum, lift) => sum + (lift.projected ?? 0), 0) : null;
  return { meetDate, daysOut, weeks, lifts, total, gain: total != null && model.currentTotal != null ? total - model.currentTotal : null };
}

export function attemptRows(model: ReturnType<typeof buildPowerliftingModel>) {
  const { attempt_pct: percentages, bar_weight_kg: barWeight, plate_pairs_kg: platePairs } = model.power.config;
  return model.lifts.filter((lift) => lift.current != null).map((lift) => ({
    ...lift,
    attempts: percentages.map((percentage) => ({ percentage, ...plateBreakdown(lift.current! * percentage, barWeight, platePairs) })),
  }));
}

export { addWeeks };
