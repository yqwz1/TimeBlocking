import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkoutExerciseHistoryDTO, WorkoutJobDTO, WorkoutStatusDTO, WorkoutSummaryDTO } from '@timeblock/shared';
import { api } from '../api.js';

export const useWorkoutStatus = () => useQuery({
  queryKey: ['workout', 'status'],
  queryFn: () => api.get<WorkoutStatusDTO>('/workout/status'),
  refetchInterval: 2_000,
});

export const useWorkoutSummary = () => useQuery({
  queryKey: ['workout', 'summary', 4],
  queryFn: () => api.get<WorkoutSummaryDTO>('/workout/summary'),
  retry: 1,
});

export const useWorkoutExerciseHistory = (exercise: string | null, from?: string, to?: string) => useQuery({
  queryKey: ['workout', 'exercise-history', exercise, from ?? null, to ?? null],
  queryFn: () => {
    const range = new URLSearchParams();
    if (from) range.set('from', from);
    if (to) range.set('to', to);
    const suffix = range.size ? `?${range.toString()}` : '';
    return api.get<WorkoutExerciseHistoryDTO>(`/workout/exercises/${encodeURIComponent(exercise!)}/history${suffix}`);
  },
  enabled: Boolean(exercise),
  staleTime: 60_000,
});

export const useWorkoutJob = (id: string | null) => useQuery({
  queryKey: ['workout', 'job', id],
  queryFn: () => api.get<WorkoutJobDTO>(`/workout/jobs/${id}`),
  enabled: Boolean(id),
  refetchInterval: (query) => ['completed', 'failed', 'interrupted'].includes(query.state.data?.status ?? '') ? false : 1_000,
});

function useWorkoutMutation<T = Record<string, unknown>>(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: T) => api.post<WorkoutJobDTO>(path, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['workout', 'status'] }); },
  });
}

export const useWorkoutSync = () => useWorkoutMutation<{ full: boolean }>('/workout/sync');
export const useWorkoutReport = () => useWorkoutMutation('/workout/report');
export const useWorkoutBacktest = () => useWorkoutMutation('/workout/backtest');
export const useWorkoutBodyweight = () => useWorkoutMutation<{ weight: number; date?: string; note?: string }>('/workout/bodyweight');
export const useWorkoutGoal = () => useWorkoutMutation<Record<string, unknown>>('/workout/goals');
export const useWorkoutNote = () => useWorkoutMutation<{ category: string; text: string }>('/workout/notes');
export const useWorkoutPredict = () => useWorkoutMutation<{ exercise: string; weight: number }>('/workout/predict');
export const useWorkoutCalibrate = () => useWorkoutMutation<{ exercise?: string }>('/workout/calibrate');
export const useWorkoutCompare = () => useWorkoutMutation<{ muscle?: string }>('/workout/compare');
export const useWorkoutSetPlan = () => useWorkoutMutation<{ muscle?: string }>('/workout/set-plan');
export const useWorkoutRoutinePreview = () => useWorkoutMutation('/workout/routines/preview');
export const useWorkoutRoutineApply = () => useWorkoutMutation<{ previewHash: string; confirm: true }>('/workout/routines/apply');

export function useWorkoutCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string) => api.put<{ saved: boolean; hevyConnected: boolean }>('/workout/settings/credential', { apiKey }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['workout', 'status'] }),
  });
}

export function useWorkoutImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.upload<WorkoutJobDTO>('/workout/import', file),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['workout', 'status'] }),
  });
}
