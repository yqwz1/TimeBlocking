import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardDTO } from '@timeblock/shared';
import { api } from '../api.js';

export const useBoards = (q?: string) =>
  useQuery({
    queryKey: ['whiteboards', q ?? ''],
    queryFn: () => api.get<BoardDTO[]>(`/whiteboards${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  });

export const useCreateBoard = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<BoardDTO>('/whiteboards', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whiteboards'] }),
  });
};

export const useRenameBoard = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.patch<BoardDTO>(`/whiteboards/${id}`, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whiteboards'] }),
  });
};

export const useDeleteBoard = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/whiteboards/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whiteboards'] }),
  });
};
