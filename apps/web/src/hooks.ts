import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { celebrateTaskComplete } from './lib/celebrate.js';
import type {
  AchievementDTO,
  AnalyticsDailyDTO,
  AttachmentDTO,
  BriefDTO,
  CalendarListEntryDTO,
  DailyHighlightInput,
  DailyPlanDTO,
  DriveBackupDTO,
  DriveBackupStatusDTO,
  DriveConnectionDTO,
  DailyShutdownInput,
  DayResultDTO,
  EventDTO,
  EventInput,
  EventPatch,
  GamificationSummaryDTO,
  GoalDTO,
  GoalInput,
  GoalMilestoneInput,
  HabitDTO,
  HabitInput,
  LabelDTO,
  LabelInput,
  LearningStatsDTO,
  ObjectiveDTO,
  ObjectiveInput,
  ProjectDetailDTO,
  ProjectInput,
  ProposalDTO,
  ProposalRefineInput,
  ReminderDTO,
  ReminderFiredEventDTO,
  ReminderInput,
  ScheduleItemDTO,
  ScheduleRunDTO,
  Settings,
  SetupStatusDTO,
  SyncStatusDTO,
  TaskDetailDTO,
  TaskDTO,
  TaskInput,
  TaskPatch,
  TaskViewDTO,
  TodayPlanDTO,
  WeeklyAnalyticsDTO,
  WeeklyReviewDTO,
  WeeklyReviewInput,
  XpEventDTO,
} from '@timeblock/shared';
import { api } from './api';
import { undoStack } from './lib/undoStack.js';
import { showUndoToast } from './lib/actionToast.js';

// ---------- live sync (SSE) ----------

/** Browser-side event name for a fired reminder pushed over SSE; ReminderToasts listens for it. */
export const REMINDER_FIRED_EVENT = 'tb:reminder-fired';

/** Keeps sync status + schedule/task queries fresh by listening to server push updates. */
export function useLiveSync() {
  const qc = useQueryClient();
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (ev) => {
      try {
        const status: SyncStatusDTO = JSON.parse(ev.data);
        qc.setQueryData(['sync', 'status'], status);
      } catch {
        // ignore malformed heartbeat/comment frames
      }
      qc.invalidateQueries({ queryKey: ['schedule'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['labels'] });
      qc.invalidateQueries({ queryKey: ['habits'] });
      qc.invalidateQueries({ queryKey: ['objectives'] });
      qc.invalidateQueries({ queryKey: ['goals'] });
      qc.invalidateQueries({ queryKey: ['gamification'] });
      qc.invalidateQueries({ queryKey: ['plan'] });
      qc.invalidateQueries({ queryKey: ['daily'] });
      qc.invalidateQueries({ queryKey: ['weekly-review'] });
    };
    es.addEventListener('reminder', (ev: MessageEvent) => {
      try {
        const dto: ReminderFiredEventDTO = JSON.parse(ev.data);
        window.dispatchEvent(new CustomEvent<ReminderFiredEventDTO>(REMINDER_FIRED_EVENT, { detail: dto }));
      } catch {
        // ignore malformed frame
      }
      qc.invalidateQueries({ queryKey: ['tasks'] });
    });
    return () => es.close();
  }, [qc]);
}

// ---------- setup ----------

export const useSetupStatus = () => useQuery({ queryKey: ['setup', 'status'], queryFn: () => api.get<SetupStatusDTO>('/setup/status') });

export const useGoogleCalendars = (enabled: boolean) =>
  useQuery({ queryKey: ['setup', 'calendars'], queryFn: () => api.get<CalendarListEntryDTO[]>('/setup/calendars'), enabled });

export const useSaveCalendars = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (busyCalendarIds: string[]) => api.post<{ ok: true; appCalendarId: string }>('/setup/calendars', { busyCalendarIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['setup', 'status'] }),
  });
};

export const useDisconnectGoogle = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/setup/google/disconnect'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['setup', 'status'] });
      qc.invalidateQueries({ queryKey: ['setup', 'calendars'] });
    },
  });
};

// ---------- Google Drive (Second Brain mirror) ----------

export const useDriveConnection = () =>
  useQuery({ queryKey: ['drive', 'status'], queryFn: () => api.get<DriveConnectionDTO>('/drive/status'), refetchInterval: 30_000 });

export const useDriveBackupStatus = () =>
  useQuery({ queryKey: ['drive', 'backups', 'status'], queryFn: () => api.get<DriveBackupStatusDTO>('/drive/backups/status'), refetchInterval: 15_000 });

export const useDriveBackups = (enabled: boolean) =>
  useQuery({ queryKey: ['drive', 'backups'], queryFn: () => api.get<DriveBackupDTO[]>('/drive/backups'), enabled });

export const useBackupDriveNow = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<DriveBackupDTO>('/drive/backups'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['drive', 'backups'] }); qc.invalidateQueries({ queryKey: ['drive', 'backups', 'status'] }); },
  });
};

export const useRestoreDriveBackup = () =>
  useMutation({ mutationFn: (id: string) => api.post<{ ok: true; inspectionPath: string }>(`/drive/backups/${encodeURIComponent(id)}/restore`) });

// ---------- sync ----------

export const useSyncStatus = () =>
  useQuery({ queryKey: ['sync', 'status'], queryFn: () => api.get<SyncStatusDTO>('/sync/status'), refetchInterval: 30_000 });

export const useManualSync = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<SyncStatusDTO>('/sync'),
    onSuccess: () => qc.invalidateQueries(),
  });
};

// ---------- plan proposals (propose -> approve scheduling) ----------

export const useProposal = () =>
  useQuery({ queryKey: ['plan', 'proposal'], queryFn: () => api.get<ProposalDTO | null>('/plan/proposal') });

export const useCreateProposal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scopeDate?: string) => api.post<ProposalDTO>('/plan/proposal', scopeDate ? { scopeDate } : undefined),
    onSuccess: (proposal) => qc.setQueryData(['plan', 'proposal'], proposal),
  });
};

export const useRefineProposal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...opts }: { id: string } & ProposalRefineInput) => api.post<ProposalDTO>(`/plan/proposal/${id}/refine`, opts),
    onSuccess: (proposal) => qc.setQueryData(['plan', 'proposal'], proposal),
  });
};

export const useApplyProposal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ScheduleRunDTO>(`/plan/proposal/${id}/apply`),
    onSuccess: () => qc.invalidateQueries(),
  });
};

export const useDiscardProposal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/plan/proposal/${id}`),
    onSuccess: () => qc.setQueryData(['plan', 'proposal'], null),
  });
};

// ---------- schedule ----------

export const useSchedule = (fromIso: string, toIso: string, opts?: { external?: boolean }) => {
  const external = opts?.external ?? true;
  return useQuery({
    queryKey: ['schedule', fromIso, toIso, external],
    queryFn: () =>
      api.get<ScheduleItemDTO[]>(
        `/schedule?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&external=${external ? '1' : '0'}`,
      ),
    placeholderData: (prev) => prev,
  });
};

/** Patches the cached start/end for `id` across every cached ['schedule', ...] query so a
 * moved block doesn't visually snap back to its stale cached position before the
 * server round-trip (or a follow-on SSE invalidation) resolves. */
function patchScheduleCache(qc: ReturnType<typeof useQueryClient>, id: string, startUtc: string, endUtc: string) {
  qc.setQueriesData<ScheduleItemDTO[] | undefined>({ queryKey: ['schedule'] }, (items) =>
    items?.map((item) => (item.id === id ? { ...item, start: startUtc, end: endUtc } : item)),
  );
}

/** `prevStartUtc`/`prevEndUtc` (the block's time before this move) are optional — when the caller
 * supplies them, the move becomes undoable. */
export const useMoveBlock = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, startUtc, endUtc }: { id: string; startUtc: string; endUtc: string; prevStartUtc?: string; prevEndUtc?: string }) =>
      api.patch(`/blocks/${id}`, { startUtc, endUtc }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['schedule'] });
      const previous = qc.getQueriesData<ScheduleItemDTO[] | undefined>({ queryKey: ['schedule'] });
      patchScheduleCache(qc, vars.id, vars.startUtc, vars.endUtc);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
      if (!vars.prevStartUtc || !vars.prevEndUtc) return;
      const { id, startUtc, endUtc, prevStartUtc, prevEndUtc } = vars;
      undoStack.push({
        label: 'Move event',
        undo: async () => {
          patchScheduleCache(qc, id, prevStartUtc, prevEndUtc);
          await api.patch(`/blocks/${id}`, { startUtc: prevStartUtc, endUtc: prevEndUtc });
          qc.invalidateQueries({ queryKey: ['schedule'] });
        },
        redo: async () => {
          patchScheduleCache(qc, id, startUtc, endUtc);
          await api.patch(`/blocks/${id}`, { startUtc, endUtc });
          qc.invalidateQueries({ queryKey: ['schedule'] });
        },
      });
    },
  });
};

export const useLockBlock = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/blocks/${id}/lock`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
      undoStack.push({
        label: 'Lock event',
        undo: async () => {
          await api.post(`/blocks/${id}/unlock`);
          qc.invalidateQueries({ queryKey: ['schedule'] });
        },
        redo: async () => {
          await api.post(`/blocks/${id}/lock`);
          qc.invalidateQueries({ queryKey: ['schedule'] });
        },
      });
    },
  });
};

export const useUnlockBlock = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/blocks/${id}/unlock`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
      undoStack.push({
        label: 'Unlock event',
        undo: async () => {
          await api.post(`/blocks/${id}/lock`);
          qc.invalidateQueries({ queryKey: ['schedule'] });
        },
        redo: async () => {
          await api.post(`/blocks/${id}/unlock`);
          qc.invalidateQueries({ queryKey: ['schedule'] });
        },
      });
    },
  });
};

// ---------- tasks ----------

export const useTasks = (view: string) => useQuery({ queryKey: ['tasks', view], queryFn: () => api.get<TaskViewDTO[]>(`/tasks?view=${view}`) });

function useTaskAction(action: 'complete' | 'unschedule' | 'reschedule') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/tasks/${id}/${action}`),
    // Fire the celebration on click rather than waiting on the round-trip — the
    // animation/sound felt laggy gated behind the network + invalidation cycle.
    onMutate: () => {
      if (action === 'complete') celebrateTaskComplete();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
      qc.invalidateQueries({ queryKey: ['gamification'] });
      qc.invalidateQueries({ queryKey: ['plan'] });
    },
  });
}

export const useCompleteTask = () => useTaskAction('complete');
export const useUnscheduleTask = () => useTaskAction('unschedule');
export const useRescheduleTask = () => useTaskAction('reschedule');

/** Drop a task onto an explicit calendar slot (drag-to-schedule). */
export const useScheduleTaskAt = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, startUtc, endUtc }: { id: string; startUtc: string; endUtc: string }) =>
      api.post(`/tasks/${id}/schedule-at`, { startUtc, endUtc }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
    },
  });
};

// ---------- calendar events (meetings) ----------

const invalidateSchedule = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['schedule'] });
  qc.invalidateQueries({ queryKey: ['plan'] });
};

export const useCreateEvent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EventInput) => api.post<EventDTO>('/calendar-events', input),
    onSuccess: () => invalidateSchedule(qc),
  });
};

export const useUpdateEvent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: EventPatch }) => api.patch<EventDTO>(`/calendar-events/${id}`, patch),
    onSuccess: () => invalidateSchedule(qc),
  });
};

export const useDeleteEvent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/calendar-events/${id}`),
    onSuccess: () => invalidateSchedule(qc),
  });
};

// ---------- task manager: full CRUD, projects, labels ----------

export interface TaskListFilters {
  q?: string;
  projectId?: string;
  label?: string;
  status?: string;
  priority?: number;
  dueFrom?: string;
  dueTo?: string;
  parentId?: string;
  includeClosed?: boolean;
  pinned?: boolean;
}

function taskListQuery(filters: TaskListFilters): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === '') continue;
    params.set(k, String(v));
  }
  return params.toString();
}

export const useTaskList = (filters: TaskListFilters = {}) =>
  useQuery({
    queryKey: ['tasks', 'all', filters],
    queryFn: () => api.get<TaskDTO[]>(`/tasks/all${taskListQuery(filters) ? `?${taskListQuery(filters)}` : ''}`),
  });

/** Pinned tasks (favorites), shown in the sidebar. */
export const usePinnedTasks = () =>
  useQuery({
    queryKey: ['tasks', 'all', { pinned: true, includeClosed: false }],
    queryFn: () => api.get<TaskDTO[]>('/tasks/all?pinned=1'),
  });

export const useUpcomingTasks = (days = 7) =>
  useQuery({
    queryKey: ['tasks', 'upcoming', days],
    queryFn: () => api.get<{ overdue: TaskDTO[]; byDate: Record<string, TaskDTO[]> }>(`/tasks/upcoming?days=${days}`),
  });

export const useTaskDetail = (id: string | null) =>
  useQuery({
    queryKey: ['tasks', 'detail', id],
    queryFn: () => api.get<TaskDetailDTO>(`/tasks/${id}`),
    enabled: !!id,
  });

function invalidateTaskWrites(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['tasks'] });
  qc.invalidateQueries({ queryKey: ['schedule'] });
  qc.invalidateQueries({ queryKey: ['plan'] });
  qc.invalidateQueries({ queryKey: ['projects'] });
}

/** Best-effort lookup of a full task from whatever's already cached (detail panel or a list view). */
function findCachedTask(qc: ReturnType<typeof useQueryClient>, id: string): TaskDTO | undefined {
  const detail = qc.getQueryData<TaskDetailDTO>(['tasks', 'detail', id]);
  if (detail) return detail;
  for (const [, data] of qc.getQueriesData<TaskDTO[]>({ queryKey: ['tasks', 'all'] })) {
    const found = data?.find((t) => t.id === id);
    if (found) return found;
  }
  return undefined;
}

export function taskToInput(t: TaskDTO): TaskInput {
  return {
    content: t.content,
    description: t.description,
    projectId: t.projectId,
    parentId: t.parentId,
    priority: t.priority,
    dueDate: t.dueDate,
    dueDatetimeUtc: t.dueDatetimeUtc,
    durationMin: t.durationMin,
    difficulty: t.difficulty,
    labels: t.labels,
    links: t.links,
    color: t.color,
    status: t.status,
    skipScheduling: t.skipScheduling,
    pinned: t.pinned,
  };
}

export const useCreateTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TaskInput) => api.post<TaskDTO>('/tasks', input),
    onSuccess: (created, input) => {
      invalidateTaskWrites(qc);
      let currentId = created.id;
      undoStack.push({
        label: `Create "${created.content}"`,
        undo: async () => {
          await api.delete(`/tasks/${currentId}`);
          invalidateTaskWrites(qc);
        },
        redo: async () => {
          const t = await api.post<TaskDTO>('/tasks', input);
          currentId = t.id;
          invalidateTaskWrites(qc);
        },
      });
    },
  });
};

export const useUpdateTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) => api.patch<TaskDTO>(`/tasks/${id}`, patch),
    // Patch the cache (and fire the completion celebration) immediately on click rather
    // than waiting for the round-trip + invalidation — otherwise the checkbox/animation/sound
    // all lag behind a full list refetch, which reads as sluggish. Roll back on error.
    onMutate: async ({ id, patch }) => {
      const prev = findCachedTask(qc, id);
      if (patch.status === 'done') {
        celebrateTaskComplete();
        // The row leaves the list on completion — surface an immediate, low-friction
        // way to reverse it (bottom-left), reopening to whatever status it held before.
        const reopenTo = prev?.status && prev.status !== 'done' ? prev.status : 'todo';
        showUndoToast(`Completed “${prev?.content ?? 'task'}”`, async () => {
          await api.patch(`/tasks/${id}`, { status: reopenTo });
          invalidateTaskWrites(qc);
        });
      }
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const snapshots = qc.getQueriesData({ queryKey: ['tasks'] });
      qc.setQueriesData({ queryKey: ['tasks'] }, (old: unknown) => {
        if (Array.isArray(old)) return old.map((t: TaskDTO) => (t.id === id ? { ...t, ...patch } : t));
        if (old && typeof old === 'object' && (old as TaskDTO).id === id) return { ...(old as TaskDTO), ...patch };
        return old;
      });
      return { prev, snapshots };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSuccess: (_data, variables, ctx) => {
      invalidateTaskWrites(qc);
      const prev = ctx?.prev;
      if (!prev) return;
      const { id, patch } = variables;
      const inversePatch: TaskPatch = {};
      for (const key of Object.keys(patch) as (keyof TaskPatch)[]) {
        (inversePatch as Record<string, unknown>)[key] = prev[key];
      }
      undoStack.push({
        label: `Edit "${prev.content}"`,
        undo: async () => {
          await api.patch(`/tasks/${id}`, inversePatch);
          invalidateTaskWrites(qc);
        },
        redo: async () => {
          await api.patch(`/tasks/${id}`, patch);
          invalidateTaskWrites(qc);
        },
      });
    },
  });
};

export const useReorderTasks = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.post('/tasks/reorder', { ids }),
    onSuccess: () => invalidateTaskWrites(qc),
  });
};

export const useDeleteTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const detail = await api.get<TaskDetailDTO>(`/tasks/${id}`).catch(() => undefined);
      await api.delete(`/tasks/${id}`);
      return detail;
    },
    onSuccess: (detail) => {
      invalidateTaskWrites(qc);
      if (!detail) return;
      const input = taskToInput(detail);
      let currentId = detail.id;
      undoStack.push({
        label: `Delete "${detail.content}"`,
        undo: async () => {
          const t = await api.post<TaskDTO>('/tasks', input);
          currentId = t.id;
          invalidateTaskWrites(qc);
        },
        redo: async () => {
          await api.delete(`/tasks/${currentId}`);
          invalidateTaskWrites(qc);
        },
      });
    },
  });
};

export const useReopenTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/tasks/${id}/reopen`),
    onSuccess: () => invalidateTaskWrites(qc),
  });
};

export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: () => api.get<ProjectDetailDTO[]>('/projects') });

export const useCreateProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProjectInput) => api.post<ProjectDetailDTO>('/projects', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
};

export const useUpdateProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ProjectInput> }) => api.patch<ProjectDetailDTO>(`/projects/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
};

export const useDeleteProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
};

export const useLabels = () => useQuery({ queryKey: ['labels'], queryFn: () => api.get<LabelDTO[]>('/labels') });

export const useLabelColorMap = (): Map<string, string | null> => {
  const { data } = useLabels();
  const map = new Map<string, string | null>();
  for (const l of data ?? []) map.set(l.name, l.color);
  return map;
};

export const useCreateLabel = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LabelInput) => api.post<LabelDTO>('/labels', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['labels'] }),
  });
};

export const useUpdateLabel = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<LabelInput> }) => api.patch<LabelDTO>(`/labels/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['labels'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
};

export const useDeleteLabel = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/labels/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['labels'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
};

export const useReminders = (taskId: string | null) =>
  useQuery({
    queryKey: ['tasks', 'reminders', taskId],
    queryFn: () => api.get<ReminderDTO[]>(`/tasks/${taskId}/reminders`),
    enabled: !!taskId,
  });

export const useCreateReminder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: ReminderInput }) => api.post<ReminderDTO>(`/tasks/${taskId}/reminders`, input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['tasks', 'reminders', vars.taskId] });
      qc.invalidateQueries({ queryKey: ['tasks', 'detail', vars.taskId] });
    },
  });
};

export const useDeleteReminder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/reminders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
};

// ---------- task dependencies ("blocked by" chains) ----------

export const useAddDependency = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, blockerId }: { taskId: string; blockerId: string }) => api.post<TaskDTO>(`/tasks/${taskId}/dependencies`, { blockerId }),
    onSuccess: () => invalidateTaskWrites(qc),
  });
};

export const useRemoveDependency = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, blockerId }: { taskId: string; blockerId: string }) => api.delete<TaskDTO>(`/tasks/${taskId}/dependencies/${blockerId}`),
    onSuccess: () => invalidateTaskWrites(qc),
  });
};

export const useAttachments = (taskId: string | null) =>
  useQuery({
    queryKey: ['tasks', 'attachments', taskId],
    queryFn: () => api.get<AttachmentDTO[]>(`/tasks/${taskId}/attachments`),
    enabled: !!taskId,
  });

export const useUploadAttachment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, file }: { taskId: string; file: File }) => api.upload<AttachmentDTO>(`/tasks/${taskId}/attachments`, file),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['tasks', 'attachments', vars.taskId] });
      qc.invalidateQueries({ queryKey: ['tasks', 'detail', vars.taskId] });
    },
  });
};

export const useDeleteAttachment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/attachments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
};

// ---------- settings ----------

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') });

export interface AiUsageDashboard {
  configured: boolean;
  provider: 'openrouter' | 'gemini';
  generationModel: string;
  embeddingModel: string;
  local: { inputTokens: number; outputTokens: number; reasoningTokens: number; cachedTokens: number; billableTokens: number; estimatedUsd: number; exactUsageRate: number | null; calls: number; periodStart: string };
  providerBalance: { totalCreditsUsd: number | null; usedCreditsUsd: number | null; remainingCreditsUsd: number | null; keyLimitUsd: number | null; keyRemainingUsd: number | null; keyUsageUsd: number | null; reset: 'daily' | 'weekly' | 'monthly' | null; available: boolean; message: string | null };
}

export const useAiUsageDashboard = () =>
  useQuery({ queryKey: ['assistant', 'usage'], queryFn: () => api.get<AiUsageDashboard>('/assistant/usage'), refetchInterval: 60_000, retry: false });

export const useUpdateSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api.put<Settings>('/settings', patch),
    onSuccess: () => qc.invalidateQueries(),
  });
};

// ---------- habits ----------

export const useHabits = () => useQuery({ queryKey: ['habits'], queryFn: () => api.get<HabitDTO[]>('/habits') });

export const useCreateHabit = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HabitInput) => api.post<HabitDTO>('/habits', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['habits'] }),
  });
};

export const useUpdateHabit = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<HabitInput> }) => api.patch<HabitDTO>(`/habits/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['habits'] }),
  });
};

export const useDeleteHabit = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/habits/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['habits'] }),
  });
};

export const useSkipHabitToday = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/habits/${id}/skip-today`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
    },
  });
};

export const useCompleteHabitToday = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/habits/${id}/complete-today`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
      qc.invalidateQueries({ queryKey: ['plan'] });
      qc.invalidateQueries({ queryKey: ['gamification'] });
    },
  });
};

// ---------- objectives ----------

export const useObjectives = (weekStart?: string) =>
  useQuery({
    queryKey: ['objectives', weekStart ?? 'current'],
    queryFn: () => api.get<ObjectiveDTO[]>(`/objectives${weekStart ? `?weekStart=${weekStart}` : ''}`),
  });

export const useCreateObjective = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ObjectiveInput) => api.post<ObjectiveDTO>('/objectives', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objectives'] }),
  });
};

export const useUpdateObjective = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => api.patch<ObjectiveDTO>(`/objectives/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objectives'] }),
  });
};

export const useDeleteObjective = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/objectives/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objectives'] }),
  });
};

// ---------- goals ----------

export const useGoals = (year: number, quarter: number | 'all') =>
  useQuery({
    queryKey: ['goals', year, quarter],
    queryFn: () => api.get<GoalDTO[]>(`/goals?year=${year}&quarter=${quarter}`),
  });

export const useCreateGoal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GoalInput) => api.post<GoalDTO>('/goals', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
};

export const useUpdateGoal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => api.patch<GoalDTO>(`/goals/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
};

export const useDeleteGoal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/goals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
};

export const useCreateGoalMilestone = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, title }: { goalId: string; title: GoalMilestoneInput['title'] }) =>
      api.post<GoalDTO>(`/goals/${goalId}/milestones`, { title }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
};

export const useUpdateGoalMilestone = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, id, patch }: { goalId: string; id: string; patch: Partial<{ title: string; done: boolean; sortOrder: number }> }) =>
      api.patch<GoalDTO>(`/goals/${goalId}/milestones/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
};

export const useDeleteGoalMilestone = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, id }: { goalId: string; id: string }) => api.delete<GoalDTO>(`/goals/${goalId}/milestones/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
};

export const useReorderGoalMilestones = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, ids }: { goalId: string; ids: string[] }) => api.post<GoalDTO>(`/goals/${goalId}/milestones/reorder`, { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
};

// ---------- analytics / today / brief ----------

export const useAnalyticsDaily = (date?: string) =>
  useQuery({ queryKey: ['analytics', 'daily', date ?? 'today'], queryFn: () => api.get<AnalyticsDailyDTO>(`/analytics/daily${date ? `?date=${date}` : ''}`) });

export const useAnalyticsWeekly = (weekStart?: string) =>
  useQuery({
    queryKey: ['analytics', 'weekly', weekStart ?? 'current'],
    queryFn: () => api.get<WeeklyAnalyticsDTO>(`/analytics/weekly${weekStart ? `?weekStart=${weekStart}` : ''}`),
  });

export const useTodayPlan = () => useQuery({ queryKey: ['plan', 'today'], queryFn: () => api.get<TodayPlanDTO>('/plan/today'), refetchInterval: 60_000 });

export const useGenerateBrief = () => useMutation({ mutationFn: () => api.post<BriefDTO>('/brief') });

// ---------- daily rituals: highlight + shutdown ----------

export const useDailyPlan = () =>
  useQuery({ queryKey: ['daily', 'today'], queryFn: () => api.get<DailyPlanDTO>('/daily'), refetchInterval: 60_000 });

export const useUpdateHighlight = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ date, patch }: { date: string; patch: DailyHighlightInput }) => api.patch<DailyPlanDTO>(`/daily/${date}`, patch),
    onSuccess: (data) => qc.setQueryData(['daily', 'today'], data),
  });
};

export const useShutdownDay = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ date, input }: { date: string; input: DailyShutdownInput }) => api.post<DailyPlanDTO>(`/daily/${date}/shutdown`, input),
    onSuccess: (data) => {
      qc.setQueryData(['daily', 'today'], data);
      qc.invalidateQueries({ queryKey: ['gamification'] });
    },
  });
};

export const useReopenShutdown = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => api.post<DailyPlanDTO>(`/daily/${date}/shutdown/reopen`),
    onSuccess: (data) => qc.setQueryData(['daily', 'today'], data),
  });
};

// ---------- weekly review ----------

export const useWeeklyReview = (weekStart?: string) =>
  useQuery({
    queryKey: ['weekly-review', weekStart ?? 'current'],
    queryFn: () => api.get<WeeklyReviewDTO>(`/weekly-review${weekStart ? `?weekStart=${weekStart}` : ''}`),
  });

export const useSaveWeeklyReview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ weekStart, input }: { weekStart: string; input: WeeklyReviewInput }) => api.put<WeeklyReviewDTO>(`/weekly-review/${weekStart}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['weekly-review'] }),
  });
};

export const useCompleteWeeklyReview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ weekStart, input }: { weekStart: string; input: WeeklyReviewInput }) => api.post<WeeklyReviewDTO>(`/weekly-review/${weekStart}/complete`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weekly-review'] });
      qc.invalidateQueries({ queryKey: ['gamification'] });
    },
  });
};

export const useReopenWeeklyReview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (weekStart: string) => api.post<WeeklyReviewDTO>(`/weekly-review/${weekStart}/reopen`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['weekly-review'] }),
  });
};

// ---------- learning ----------

export const useLearningStats = () => useQuery({ queryKey: ['learning', 'stats'], queryFn: () => api.get<LearningStatsDTO>('/learning/stats') });

export const useResetLearning = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/learning/reset'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['learning'] }),
  });
};

// ---------- gamification ----------

export const useGamificationSummary = () =>
  useQuery({
    queryKey: ['gamification', 'summary'],
    queryFn: () => api.get<GamificationSummaryDTO>('/gamification/summary'),
    refetchInterval: 60_000,
  });

export const useAchievements = () =>
  useQuery({ queryKey: ['gamification', 'achievements'], queryFn: () => api.get<AchievementDTO[]>('/gamification/achievements') });

export const useXpHistory = (days = 30) =>
  useQuery({
    queryKey: ['gamification', 'xp-history', days],
    queryFn: () => api.get<{ date: string; xp: number }[]>(`/gamification/xp-history?days=${days}`),
  });

export const useStreakCalendar = (weeks = 12) =>
  useQuery({
    queryKey: ['gamification', 'streak-calendar', weeks],
    queryFn: () => api.get<DayResultDTO[]>(`/gamification/streak-calendar?weeks=${weeks}`),
  });

export const useGamificationEvents = (afterSeq: number) =>
  useQuery({
    queryKey: ['gamification', 'events', afterSeq],
    queryFn: () => api.get<XpEventDTO[]>(`/gamification/events?afterSeq=${afterSeq}`),
    enabled: afterSeq > 0,
  });

export const useBuyFreeze = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true; freezes: number }>('/gamification/freeze/buy'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gamification'] }),
  });
};

// ---------- demo mode (dev-only) ----------

export const useDemoStatus = () =>
  useQuery({
    queryKey: ['demo', 'status'],
    queryFn: () => api.get<{ available: boolean; active: boolean }>('/demo/status'),
    enabled: import.meta.env.DEV,
    retry: false,
  });

export const useSeedDemo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/demo/seed'),
    onSuccess: () => qc.invalidateQueries(),
  });
};

export const useResetDemo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/demo/reset'),
    onSuccess: () => qc.invalidateQueries(),
  });
};
