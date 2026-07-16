import type { BoardFileDTO, BoardSceneDTO } from '@timeblock/shared';
import { api } from '../api.js';

export const whiteboardApi = {
  scene: (boardId: string) => api.get<BoardSceneDTO>(`/whiteboards/${boardId}/scene`),
  files: (boardId: string) => api.get<BoardFileDTO[]>(`/whiteboards/${boardId}/files`),
  saveScene: (boardId: string, elements: unknown[], appState: Record<string, unknown>) =>
    api.put(`/whiteboards/${boardId}/scene`, { elements, appState }),
  uploadFile: (boardId: string, file: { id: string; mimeType: string; dataUrl: string }) =>
    api.post(`/whiteboards/${boardId}/files`, file),
};
