import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConceptDTO,
  ConceptStatusDTO,
  GraphInsightsDTO,
  GraphIndexFreshnessDTO,
  GraphPathResultDTO,
  GraphQueryResponseDTO,
  GraphTimelineDTO,
  GraphLayoutPointDTO,
  GraphWhyDTO,
  InboxNoteDTO,
  InboxTriageSuggestionDTO,
  NoteChatResponseDTO,
  NoteConflictDTO,
  NoteDetailDTO,
  NoteDTO,
  NoteGraphDTO,
  NoteAssetUploadDTO,
  NoteDraftLinkedInInput,
  NoteSearchResultDTO,
  NoteShareDTO,
  NoteSnapshotDTO,
  NoteSnapshotDetailDTO,
  NoteSuggestionsDTO,
  NoteSummaryDTO,
  NoteTrashEntryDTO,
  NoteQueryResultDTO,
  OnThisDayDTO,
  PublicNoteDTO,
  RelatedNoteDTO,
  StudyQueueDTO,
  StudyReviewBlockDTO,
  StudyReviewResultDTO,
  SuggestedEdgeDTO,
  TemplateSummaryDTO,
  VaultTaskHubDTO,
} from '@timeblock/shared';
import { api } from '../api.js';

/** Encodes a vault-relative path (which contains `/`) for use inside a URL path segment-by-segment. */
export function encodeNotePath(id: string): string {
  return id.split('/').map(encodeURIComponent).join('/');
}

export class NoteConflictError extends Error {
  constructor(public conflict: NoteConflictDTO) {
    super('conflict');
  }
}

export const useNoteTree = () => useQuery({ queryKey: ['notes', 'tree'], queryFn: () => api.get<NoteSummaryDTO[]>('/notes/tree') });

export const useInboxNotes = () => useQuery({ queryKey: ['notes', 'inbox'], queryFn: () => api.get<InboxNoteDTO[]>('/notes/inbox') });

export const useNoteSearch = (q: string) =>
  useQuery({
    queryKey: ['notes', 'search', q],
    queryFn: () => api.get<NoteSearchResultDTO[]>(`/notes/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
  });

export const useNote = (id: string | null) =>
  useQuery({
    queryKey: ['notes', 'file', id],
    queryFn: () => api.get<NoteDetailDTO>(`/notes/file/${encodeNotePath(id!)}`),
    enabled: !!id,
  });

export const usePublicNote = (token: string | null) =>
  useQuery({
    queryKey: ['notes', 'public', token],
    queryFn: () => api.get<PublicNoteDTO>(`/notes/public/${encodeURIComponent(token!)}`),
    enabled: !!token,
    retry: false,
  });

export const useCreateNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { path: string; content?: string }) => api.post<NoteDTO>('/notes/file', input),
    // Broad invalidation (not just 'tree'): a note created inside the templates/daily folder
    // should refresh those lists too, not just the file tree.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const useQuickCaptureNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { text: string; title?: string; folder?: string; sourceUrl?: string }) => api.post<NoteDTO>('/notes/capture', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const useClipUrlToInbox = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; summarize?: boolean; folder?: string }) => api.post<NoteDTO>('/notes/clip-url', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const useSaveNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, content, expectedUpdatedAt }: { id: string; content: string; expectedUpdatedAt: string | null }) => {
      const res = await api.put<NoteDTO | NoteConflictDTO>(`/notes/file/${encodeNotePath(id)}`, { content, expectedUpdatedAt });
      if ('error' in res && res.error === 'conflict') throw new NoteConflictError(res);
      return res as NoteDTO;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['notes', 'tree'] });
      qc.invalidateQueries({ queryKey: ['notes', 'file', vars.id] });
    },
  });
};

export const useDeleteNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true; trashId: string }>(`/notes/file/${encodeNotePath(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const useMoveNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ from, path }: { from: string; path: string }) => api.post<NoteDTO>('/notes/move', { from, path }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const useNoteShare = (id: string | null) =>
  useQuery({
    queryKey: ['notes', 'share', id],
    queryFn: () => api.get<NoteShareDTO>(`/notes/file-share/${encodeNotePath(id!)}`),
    enabled: !!id,
  });

export const useCreateNoteShare = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<NoteShareDTO>(`/notes/file-share/${encodeNotePath(id)}`),
    onSuccess: (_data, id) => qc.invalidateQueries({ queryKey: ['notes', 'share', id] }),
  });
};

export const useRevokeNoteShare = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<NoteShareDTO>(`/notes/file-share/${encodeNotePath(id)}`),
    onSuccess: (_data, id) => qc.invalidateQueries({ queryKey: ['notes', 'share', id] }),
  });
};

export const useNoteSnapshots = (id: string | null, enabled = true) =>
  useQuery({
    queryKey: ['notes', 'snapshots', id],
    queryFn: () => api.get<NoteSnapshotDTO[]>(`/notes/file-snapshots/${encodeNotePath(id!)}`),
    enabled: !!id && enabled,
  });

export const useNoteSnapshot = (id: string | null, snapshotId: string | null, enabled = true) =>
  useQuery({
    queryKey: ['notes', 'snapshots', id, snapshotId],
    queryFn: () => api.get<NoteSnapshotDetailDTO>(`/notes/file-snapshot/${encodeURIComponent(snapshotId!)}/${encodeNotePath(id!)}`),
    enabled: !!id && !!snapshotId && enabled,
  });

export const useRestoreNoteSnapshot = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, snapshotId }: { id: string; snapshotId: string }) =>
      api.post<NoteDTO>(`/notes/file-snapshot-restore/${encodeNotePath(id)}`, { snapshotId }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['notes', 'file', vars.id] });
      qc.invalidateQueries({ queryKey: ['notes', 'tree'] });
      qc.invalidateQueries({ queryKey: ['notes', 'snapshots', vars.id] });
    },
  });
};

export const useNoteTrash = () => useQuery({ queryKey: ['notes', 'trash'], queryFn: () => api.get<NoteTrashEntryDTO[]>('/notes/trash') });

export const useRestoreNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (trashId: string) => api.post<{ ok: true; path: string }>(`/notes/trash/${encodeURIComponent(trashId)}/restore`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const usePurgeTrashEntry = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (trashId: string) => api.delete(`/notes/trash/${encodeURIComponent(trashId)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', 'trash'] }),
  });
};

export const useReindexNotes = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true; count: number }>('/notes/reindex'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const useNoteGraph = (enabled: boolean) =>
  useQuery({ queryKey: ['notes', 'graph'], queryFn: () => api.get<NoteGraphDTO>('/notes/graph'), enabled, refetchInterval: enabled ? 3_000 : false });

export const useGraphTimeline = (enabled: boolean) =>
  useQuery({ queryKey: ['notes', 'graph', 'timeline'], queryFn: () => api.get<GraphTimelineDTO>('/notes/graph/timeline'), enabled, staleTime: 60_000 });

export const useGraphEra = (at: string | null) =>
  useQuery({
    queryKey: ['notes', 'graph', 'era', at],
    queryFn: () => api.get<NoteGraphDTO>(`/notes/graph/era?at=${encodeURIComponent(at!)}`),
    enabled: !!at,
    placeholderData: (previous) => previous,
  });

export const useGraphIndexFreshness = (enabled: boolean) =>
  useQuery({ queryKey: ['notes', 'graph', 'jobs'], queryFn: () => api.get<GraphIndexFreshnessDTO>('/notes/graph/jobs'), enabled, refetchInterval: enabled ? 1_500 : false });

export const useSaveGraphLayout = () =>
  useMutation({ mutationFn: (points: GraphLayoutPointDTO[]) => api.put<{ ok: true; count: number }>('/notes/graph/layout', { mode: 'connectivity', points }) });

export const useTemplates = () =>
  useQuery({ queryKey: ['notes', 'templates'], queryFn: () => api.get<TemplateSummaryDTO[]>('/notes/templates') });

export const useOpenDailyNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<NoteDTO>('/notes/daily'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', 'tree'] }),
  });
};

export const useCreateNoteFromTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { path: string; templateId: string }) => api.post<NoteDTO>('/notes/from-template', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const useToggleNotePin = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<NoteDTO>('/notes/pin', { id }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['notes', 'tree'] });
      qc.invalidateQueries({ queryKey: ['notes', 'file', id] });
    },
  });
};

export const useRelatedNotes = (id: string | null) =>
  useQuery({
    queryKey: ['notes', 'related', id],
    queryFn: () => api.get<RelatedNoteDTO[]>(`/notes/related/${encodeNotePath(id!)}`),
    enabled: !!id,
  });

export const useSuggestLinksAndTags = () =>
  useMutation({ mutationFn: (id: string) => api.post<NoteSuggestionsDTO>('/notes/suggest', { id }) });

export const useVaultChat = () =>
  useMutation({
    mutationFn: (input: { message: string; focusNoteIds?: string[]; history?: { role: 'user' | 'assistant'; content: string }[] }) =>
      api.post<NoteChatResponseDTO>('/notes/chat', input),
  });

export const useGenerateDigest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<NoteDTO>('/notes/digest'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const useDraftLinkedInPost = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NoteDraftLinkedInInput) => api.post<NoteDTO>('/notes/draft-linkedin', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const useNoteQuery = () =>
  useMutation({ mutationFn: (query: string) => api.post<NoteQueryResultDTO>('/notes/query', { query }) });

export const useVaultTasks = (filters?: { tag?: string; folder?: string; status?: 'open' | 'done' | 'all'; due?: string }) => {
  const params = new URLSearchParams();
  if (filters?.tag) params.set('tag', filters.tag);
  if (filters?.folder) params.set('folder', filters.folder);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.due) params.set('due', filters.due);
  const query = params.toString();
  return useQuery({
    queryKey: ['notes', 'tasks', query],
    queryFn: () => api.get<VaultTaskHubDTO>(`/notes/tasks${query ? `?${query}` : ''}`),
  });
};

export const useToggleVaultTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) => api.post<{ ok: true }>(`/notes/tasks/${encodeURIComponent(id)}/toggle`, { completed }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes', 'tasks'] });
      qc.invalidateQueries({ queryKey: ['notes', 'file'] });
      qc.invalidateQueries({ queryKey: ['notes', 'graph'] });
    },
  });
};

export const useStudyQueue = () =>
  useQuery({ queryKey: ['notes', 'study', 'queue'], queryFn: () => api.get<StudyQueueDTO>('/notes/study/queue') });

export const useReviewStudyCard = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { cardId: string; rating: 'again' | 'hard' | 'good' | 'easy' }) => api.post<StudyReviewResultDTO>('/notes/study/review', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', 'study', 'queue'] }),
  });
};

export const useScheduleStudyReviewBlock = () =>
  useMutation({
    mutationFn: (input?: { noteId?: string; durationMin?: number }) => api.post<StudyReviewBlockDTO>('/notes/study/review-block', input),
  });

export const useOnThisDay = () =>
  useQuery({ queryKey: ['notes', 'on-this-day'], queryFn: () => api.get<OnThisDayDTO>('/notes/on-this-day'), staleTime: 60_000 });

export const useInboxTriageSuggestion = () =>
  useMutation({ mutationFn: (id: string) => api.post<InboxTriageSuggestionDTO>('/notes/inbox/triage/suggest', { id }) });

export const useApplyInboxTriage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; title: string; destinationFolder: string; tags: string[]; links: string[] }) =>
      api.post<NoteDTO>('/notes/inbox/triage/apply', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const useEmbeddingsStatus = () =>
  useQuery({ queryKey: ['notes', 'embeddings', 'status'], queryFn: () => api.get<{ count: number; aiEnabled: boolean }>('/notes/embeddings/status') });

export const useReindexEmbeddings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true; count: number }>('/notes/embeddings/reindex'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', 'embeddings', 'status'] }),
  });
};

export const useRebuildGraph = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/notes/graph/rebuild'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', 'graph'] }),
  });
};

// ── The Graph — G6 (NL query · connection explorer · suggested edges) ─────────

export const useGraphQuery = () =>
  useMutation({ mutationFn: (message: string) => api.post<GraphQueryResponseDTO>('/notes/graph/query', { message }) });

export const useGraphPath = () =>
  useMutation({ mutationFn: ({ source, target }: { source: string; target: string }) => api.post<GraphPathResultDTO>('/notes/graph/path', { source, target }) });

export const useGraphWhy = () =>
  useMutation({ mutationFn: ({ source, target }: { source: string; target: string }) => api.post<GraphWhyDTO>('/notes/graph/why', { source, target }) });

export const useGraphSuggestions = (enabled: boolean) =>
  useQuery({ queryKey: ['notes', 'graph', 'suggestions'], queryFn: () => api.get<SuggestedEdgeDTO[]>('/notes/graph/suggestions'), enabled });

export const useGraphInsights = (enabled: boolean) =>
  useQuery({ queryKey: ['notes', 'graph', 'insights'], queryFn: () => api.get<GraphInsightsDTO>('/notes/graph/insights'), enabled });

export const useAcceptSuggestion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ source, target }: { source: string; target: string }) => api.post<{ ok: true }>('/notes/graph/suggestions/accept', { source, target }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notes', 'graph'] });
      qc.invalidateQueries({ queryKey: ['notes', 'graph', 'suggestions'] });
    },
  });
};

export const useDismissSuggestion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ source, target }: { source: string; target: string }) => api.post<{ ok: true }>('/notes/graph/suggestions/dismiss', { source, target }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', 'graph', 'suggestions'] }),
  });
};

// ── Concepts (G3) ────────────────────────────────────────────────────────────
export const useConcepts = (enabled = true) =>
  useQuery({ queryKey: ['notes', 'concepts'], queryFn: () => api.get<ConceptDTO[]>('/notes/concepts'), enabled });

export const useConceptStatus = () =>
  useQuery({ queryKey: ['notes', 'concepts', 'status'], queryFn: () => api.get<ConceptStatusDTO>('/notes/concepts/status') });

export const useExtractConcepts = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true; running: boolean }>('/notes/concepts/extract'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', 'concepts'] }),
  });
};

const invalidateConcepts = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['notes', 'concepts'] });
  qc.invalidateQueries({ queryKey: ['notes', 'graph'] });
};

export const useRenameConcept = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.post<{ ok: true }>(`/notes/concepts/${encodeURIComponent(id)}/rename`, { name }),
    onSuccess: () => invalidateConcepts(qc),
  });
};

export const useMergeConcepts = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, intoId }: { id: string; intoId: string }) => api.post<{ ok: true }>(`/notes/concepts/${encodeURIComponent(id)}/merge`, { intoId }),
    onSuccess: () => invalidateConcepts(qc),
  });
};

export const useBlacklistConcept = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ ok: true }>(`/notes/concepts/${encodeURIComponent(id)}/blacklist`),
    onSuccess: () => invalidateConcepts(qc),
  });
};
