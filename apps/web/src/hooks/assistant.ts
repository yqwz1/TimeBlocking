import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActionProposal,
  AssistantChatInput,
  AssistantChatResponse,
  AssistantMessage,
  AssistantThread,
  ChiefOfStaffBriefing,
  MemoryClaim,
  MemoryClaimPatch,
  MemoryStatus,
  ProactiveInsight,
} from '@timeblock/shared';
import { api } from '../api.js';

export const useAssistantThreads = () =>
  useQuery({ queryKey: ['assistant', 'threads'], queryFn: () => api.get<AssistantThread[]>('/assistant/threads') });

export const useAssistantThread = (id: string | null) =>
  useQuery({
    queryKey: ['assistant', 'threads', id],
    queryFn: () => api.get<{ thread: AssistantThread; messages: AssistantMessage[] }>(`/assistant/threads/${encodeURIComponent(id!)}`),
    enabled: !!id,
  });

export const useCreateAssistantThread = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (title?: string) => api.post<AssistantThread>('/assistant/threads', { title }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assistant', 'threads'] }),
  });
};

export const useAssistantChat = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AssistantChatInput) => api.post<AssistantChatResponse>('/assistant/chat', input),
    onSuccess: (response) => {
      qc.invalidateQueries({ queryKey: ['assistant', 'threads'] });
      qc.invalidateQueries({ queryKey: ['assistant', 'threads', response.thread.id] });
      qc.invalidateQueries({ queryKey: ['assistant', 'memories'] });
      qc.invalidateQueries({ queryKey: ['assistant', 'proposals'] });
    },
  });
};

export const useAssistantMessageFeedback = () =>
  useMutation({
    mutationFn: ({ messageId, rating, detail }: { messageId: string; rating: 'helpful' | 'not_helpful'; detail?: string }) =>
      api.post<{ ok: true }>(`/assistant/messages/${encodeURIComponent(messageId)}/feedback`, { rating, detail }),
  });

export const useMemories = (status?: MemoryStatus) =>
  useQuery({
    queryKey: ['assistant', 'memories', status ?? 'active'],
    queryFn: () => api.get<MemoryClaim[]>(`/assistant/memories${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  });

export const useUpdateMemory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: MemoryClaimPatch }) =>
      api.patch<MemoryClaim>(`/assistant/memories/${encodeURIComponent(id)}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assistant', 'memories'] }),
  });
};

export const useForgetMemory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ ok: true }>(`/assistant/memories/${encodeURIComponent(id)}/forget`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assistant', 'memories'] }),
  });
};

export const useAssistantOnboarding = (enabled = true) =>
  useQuery({
    queryKey: ['assistant', 'onboarding'],
    queryFn: () =>
      api.get<{ questions: Array<{ id: string; memoryClass: MemoryClaim['memoryClass']; prompt: string }> }>('/assistant/onboarding'),
    enabled,
    staleTime: Infinity,
  });

export const useSubmitAssistantOnboarding = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (answers: Record<string, string>) => api.post<{ memories: MemoryClaim[] }>('/assistant/onboarding', { answers }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assistant', 'memories'] }),
  });
};

export const useDailyBriefing = (enabled = true) =>
  useQuery({
    queryKey: ['assistant', 'briefings', 'daily'],
    queryFn: () => api.get<ChiefOfStaffBriefing>('/assistant/briefings/daily'),
    enabled,
    staleTime: 5 * 60_000,
  });

export const useWeeklyBriefing = (enabled = true) =>
  useQuery({
    queryKey: ['assistant', 'briefings', 'weekly'],
    queryFn: () => api.get<ChiefOfStaffBriefing>('/assistant/briefings/weekly'),
    enabled,
    staleTime: 10 * 60_000,
  });

export const useProactiveInsights = (enabled = true) =>
  useQuery({
    queryKey: ['assistant', 'insights'],
    queryFn: () => api.get<ProactiveInsight[]>('/assistant/insights'),
    enabled,
  });

export const useInsightFeedback = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, helpful, status }: { id: string; helpful?: boolean; status?: 'seen' | 'dismissed' | 'acted_on' }) =>
      api.post<{ ok: true }>(`/assistant/insights/${encodeURIComponent(id)}/feedback`, { helpful, status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assistant', 'insights'] }),
  });
};

export const useActionProposals = () =>
  useQuery({
    queryKey: ['assistant', 'proposals'],
    queryFn: () => api.get<ActionProposal[]>('/assistant/proposals?status=draft,approved,failed'),
  });

export const useApproveActionProposal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, confirmPreview = false }: { id: string; confirmPreview?: boolean }) =>
      api.post<ActionProposal>(`/assistant/proposals/${encodeURIComponent(id)}/approve`, { confirmPreview }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assistant', 'proposals'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['goals'] });
      qc.invalidateQueries({ queryKey: ['notes'] });
    },
  });
};

export const useRejectActionProposal = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ActionProposal>(`/assistant/proposals/${encodeURIComponent(id)}/reject`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assistant', 'proposals'] }),
  });
};
