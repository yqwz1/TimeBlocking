import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  WishlistBudgetDTO,
  WishlistBudgetInput,
  WishlistItemDTO,
  WishlistItemInput,
  WishlistItemPatch,
  WishlistLinkPreviewDTO,
  WishlistPurchaseInput,
  WishlistSettingsDTO,
  WishlistSummaryDTO,
} from '@timeblock/shared';
import { api } from '../api.js';

export interface WishlistFilters {
  q?: string;
  status?: string;
  category?: string;
  priority?: number;
  verdict?: string;
  goalId?: string;
  month?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: 'recommendation' | 'priority' | 'price_asc' | 'price_desc' | 'target_date' | 'newest';
}

function queryString(filters: WishlistFilters): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

function invalidateWishlist(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['wishlist'] });
}

export const useWishlistSettings = () =>
  useQuery({ queryKey: ['wishlist', 'settings'], queryFn: () => api.get<WishlistSettingsDTO>('/wishlist/settings') });

export const useUpdateWishlistSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (currency: string) => api.put<WishlistSettingsDTO>('/wishlist/settings', { currency }),
    onSuccess: () => invalidateWishlist(qc),
  });
};

export const useWishlistBudget = (month: string) =>
  useQuery({ queryKey: ['wishlist', 'budget', month], queryFn: () => api.get<WishlistBudgetDTO>(`/wishlist/budgets/${month}`) });

export const useSaveWishlistBudget = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ month, input }: { month: string; input: WishlistBudgetInput }) => api.put<WishlistBudgetDTO>(`/wishlist/budgets/${month}`, input),
    onSuccess: () => invalidateWishlist(qc),
  });
};

export const useWishlistItems = (filters: WishlistFilters = {}) =>
  useQuery({ queryKey: ['wishlist', 'items', filters], queryFn: () => api.get<WishlistItemDTO[]>(`/wishlist/items${queryString(filters)}`) });

export const useWishlistSummary = (month: string) =>
  useQuery({ queryKey: ['wishlist', 'summary', month], queryFn: () => api.get<WishlistSummaryDTO>(`/wishlist/summary?month=${month}`) });

export const useCreateWishlistItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WishlistItemInput) => api.post<WishlistItemDTO>('/wishlist/items', input),
    onSuccess: () => invalidateWishlist(qc),
  });
};

export const useUpdateWishlistItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: WishlistItemPatch }) => api.patch<WishlistItemDTO>(`/wishlist/items/${id}`, patch),
    onSuccess: () => invalidateWishlist(qc),
  });
};

export const useDeleteWishlistItem = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.delete(`/wishlist/items/${id}`), onSuccess: () => invalidateWishlist(qc) });
};

export const usePurchaseWishlistItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: WishlistPurchaseInput }) => api.post<WishlistItemDTO>(`/wishlist/items/${id}/purchase`, input),
    onSuccess: () => invalidateWishlist(qc),
  });
};

export const usePreviewWishlistLink = () =>
  useMutation({ mutationFn: (url: string) => api.post<WishlistLinkPreviewDTO>('/wishlist/preview', { url }) });

export const useUploadWishlistImage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => api.upload<WishlistItemDTO>(`/wishlist/items/${id}/image`, file),
    onSuccess: () => invalidateWishlist(qc),
  });
};

export const useDeleteWishlistImage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<WishlistItemDTO>(`/wishlist/items/${id}/image`),
    onSuccess: () => invalidateWishlist(qc),
  });
};

export const useWishlistAdvice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<WishlistItemDTO>(`/wishlist/items/${id}/advice`),
    onSuccess: () => invalidateWishlist(qc),
  });
};
