import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConceptDTO,
  ConceptStatusDTO,
  GraphInsightsDTO,
  GraphPathResultDTO,
  GraphQueryResponseDTO,
  GraphWhyDTO,
  NoteChatResponseDTO,
  NoteConflictDTO,
  NoteDetailDTO,
  NoteDTO,
  NoteGraphDTO,
  NoteSearchResultDTO,
  NoteSuggestionsDTO,
  NoteSummaryDTO,
  NoteTrashEntryDTO,
  RelatedNoteDTO,
  SuggestedEdgeDTO,
  TemplateSummaryDTO,
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

export const useCreateNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { path: string; content?: string }) => api.post<NoteDTO>('/notes/file', input),
    // Broad invalidation (not just 'tree'): a note created inside the templates/daily folder
    // should refresh those lists too, not just the file tree.
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
  useQuery({ queryKey: ['notes', 'graph'], queryFn: () => api.get<NoteGraphDTO>('/notes/graph'), enabled });

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
    mutationFn: (input: { message: string; history?: { role: 'user' | 'assistant'; content: string }[] }) =>
      api.post<NoteChatResponseDTO>('/notes/chat', input),
  });

export const useGenerateDigest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<NoteDTO>('/notes/digest'),
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
