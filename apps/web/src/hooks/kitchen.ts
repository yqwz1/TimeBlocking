import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  KitchenDashboardDTO,
  KitchenDealsDTO,
  KitchenFoodDTO,
  KitchenFoodInput,
  KitchenFoodPatch,
  KitchenPlanConsumeInput,
  KitchenPlanDTO,
  KitchenPlanGenerateInput,
  KitchenPlanLineAddInput,
  KitchenSettingsDTO,
  KitchenSettingsInput,
  KitchenStatusDTO,
  KitchenStockAddInput,
  KitchenStockAdjustmentInput,
  KitchenStockPortionDTO,
  KitchenStockMovementDTO,
} from '@timeblock/shared';
import { api } from '../api.js';

function invalidateKitchen(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['kitchen'] });
}

export const useKitchenDashboard = () => useQuery({ queryKey: ['kitchen', 'dashboard'], queryFn: () => api.get<KitchenDashboardDTO>('/kitchen/dashboard') });
export const useKitchenStatus = () => useQuery({ queryKey: ['kitchen', 'status'], queryFn: () => api.get<KitchenStatusDTO>('/kitchen/status'), staleTime: 60_000, retry: 1 });
export const useKitchenDeals = () => useQuery({ queryKey: ['kitchen', 'deals'], queryFn: () => api.get<KitchenDealsDTO>('/kitchen/deals'), staleTime: 5 * 60_000, retry: false });

export function useRefreshKitchenDeals() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.post<KitchenDealsDTO>('/kitchen/deals/refresh', {}), onSuccess: (data) => qc.setQueryData(['kitchen', 'deals'], data) });
}

export function useSaveKitchenSettings() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: KitchenSettingsInput) => api.put<KitchenSettingsDTO>('/kitchen/settings', input), onSuccess: () => invalidateKitchen(qc) });
}

export function useCreateKitchenFood() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: KitchenFoodInput) => api.post<KitchenFoodDTO>('/kitchen/foods', input), onSuccess: () => invalidateKitchen(qc) });
}

export function useUpdateKitchenFood() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: KitchenFoodPatch }) => api.patch<KitchenFoodDTO>(`/kitchen/foods/${id}`, patch), onSuccess: () => invalidateKitchen(qc) });
}

export function useArchiveKitchenFood() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.delete(`/kitchen/foods/${id}`), onSuccess: () => invalidateKitchen(qc) });
}

export function useAddKitchenStock() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ foodId, input }: { foodId: string; input: KitchenStockAddInput }) => api.post<KitchenStockPortionDTO[]>(`/kitchen/foods/${foodId}/stock`, input), onSuccess: () => invalidateKitchen(qc) });
}

export function useAdjustKitchenStock() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ stockId, input }: { stockId: string; input: KitchenStockAdjustmentInput }) => api.post<KitchenStockPortionDTO>(`/kitchen/stock/${stockId}/adjust`, input), onSuccess: () => invalidateKitchen(qc) });
}

export function useGenerateKitchenPlan() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: KitchenPlanGenerateInput) => api.post<KitchenPlanDTO>('/kitchen/plans/generate', input), onSuccess: () => invalidateKitchen(qc) });
}

export function useAddKitchenPlanLine() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: KitchenPlanLineAddInput) => api.post<KitchenPlanDTO>('/kitchen/plans/lines', input), onSuccess: () => invalidateKitchen(qc) });
}

export function useRemoveKitchenPlanLine() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ planId, lineId }: { planId: string; lineId: string }) => api.delete<KitchenPlanDTO>(`/kitchen/plans/${planId}/lines/${lineId}`), onSuccess: () => invalidateKitchen(qc) });
}

export function useConsumeKitchenPlanLine() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ planId, lineId, input }: { planId: string; lineId: string; input: KitchenPlanConsumeInput }) => api.post<KitchenPlanDTO>(`/kitchen/plans/${planId}/lines/${lineId}/consume`, input), onSuccess: () => invalidateKitchen(qc) });
}

export function useUndoKitchenPlanLine() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ planId, lineId }: { planId: string; lineId: string }) => api.post<KitchenPlanDTO>(`/kitchen/plans/${planId}/lines/${lineId}/undo`, {}), onSuccess: () => invalidateKitchen(qc) });
}

export function useCancelKitchenPlan() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (planId: string) => api.post<KitchenPlanDTO>(`/kitchen/plans/${planId}/cancel`, {}), onSuccess: () => invalidateKitchen(qc) });
}

export function useUndoKitchenMovement() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (movementId: string) => api.post<KitchenStockMovementDTO>(`/kitchen/movements/${movementId}/undo`, {}), onSuccess: () => invalidateKitchen(qc) });
}
