// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KitchenDashboardDTO, KitchenFoodDTO } from '@timeblock/shared';

const mocks = vi.hoisted(() => ({ dashboard: null as KitchenDashboardDTO | null, mutateAsync: vi.fn() }));
vi.mock('../hooks/kitchen.js', () => {
  const mutation = () => ({ mutateAsync: mocks.mutateAsync, isPending: false });
  return {
    useKitchenDashboard: () => ({ data: mocks.dashboard, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
    useKitchenDeals: () => ({ data: { source: 'D4D Online', location: 'Mecca', regionCode: 'SAMC', dateLocal: '2026-08-11', refreshedAtUtc: '2026-08-11T06:00:00Z', stale: false, lastError: null, deals: [{ id: 'deal-1', sourceOfferId: 'source-1', category: 'Chicken', description: 'Fresh chicken breast 1 kg', store: 'Carrefour', location: 'Mecca', priceSar: 19.95, previousPriceSar: 29.95, discountPct: 33, quality: 'good', validFrom: '2026-08-10', validTo: '2026-08-15', imageUrl: null, sourceUrl: 'https://d4donline.com' }] }, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
    useAddKitchenPlanLine: mutation,
    useRefreshKitchenDeals: mutation,
    useRemoveKitchenPlanLine: mutation,
    useAddKitchenStock: mutation,
    useAdjustKitchenStock: mutation,
    useArchiveKitchenFood: mutation,
    useCancelKitchenPlan: mutation,
    useConsumeKitchenPlanLine: mutation,
    useCreateKitchenFood: mutation,
    useGenerateKitchenPlan: mutation,
    useSaveKitchenSettings: mutation,
    useUndoKitchenMovement: mutation,
    useUndoKitchenPlanLine: mutation,
    useUpdateKitchenFood: mutation,
  };
});

import KitchenPage from './KitchenPage.js';

const emptyMacros = { proteinG: 0, caloriesKcal: null, carbsG: null, fatG: null, incompleteFields: ['calories', 'carbs', 'fat'] as const };

function dashboard(foods: KitchenFoodDTO[] = []): KitchenDashboardDTO {
  return {
    dateLocal: '2026-08-11',
    settings: { dailyProteinTarget: 120, dailyCaloriesTarget: 2500, dailyCarbsTarget: 325, warningCoverageDays: 7, forecastDays: 30, updatedAtUtc: null },
    foods,
    plan: null,
    movements: [],
    stockMacros: foods.length ? foods[0]!.macrosRemaining : { ...emptyMacros, incompleteFields: [...emptyMacros.incompleteFields] },
    consumedTodayMacros: { ...emptyMacros, incompleteFields: [...emptyMacros.incompleteFields] },
    reservedProteinG: 0,
    forecast: { horizonDays: 30, fullTargetDays: 0, firstMissDate: '2026-08-11', runOutDate: '2026-08-11', coversHorizon: false, perFood: foods.map((food) => ({ foodId: food.id, foodName: food.name, projectedDepletionDate: null, remainingAfterForecast: food.availableQuantity })) },
    alerts: [],
  };
}

describe('KitchenPage', () => {
  beforeEach(() => { mocks.mutateAsync.mockReset(); });
  afterEach(cleanup);

  it('renders the first-run food setup and target', async () => {
    mocks.dashboard = dashboard();
    render(<KitchenPage />);
    expect(screen.getByText('The Kitchen')).toBeTruthy();
    expect(screen.getByText('0 / 2,500 kcal')).toBeTruthy();
    expect(screen.getByText('0 / 325 g')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Inventory' }));
    expect(screen.getByText('Add your first repeat purchase')).toBeTruthy();
    expect(screen.getByText('0 / 120 g')).toBeTruthy();
  });

  it('shows exact portions and calculated protein inventory', async () => {
    const food: KitchenFoodDTO = {
      id: 'food-1', name: 'Chicken breast', category: 'Meat', unit: 'g', preparationState: 'cooked', nutritionBasisAmount: 100,
      proteinPerBasis: 30, caloriesPerBasis: 165, carbsPerBasis: 0, fatPerBasis: 3.6, portionMode: 'whole', planningIncrement: null,
      dailyMaxQuantity: null, dailyMaxPortions: null, lowStockThreshold: 150, plannerEligible: true, archived: false, stockQuantity: 240, reservedQuantity: 0,
      availableQuantity: 240, macrosRemaining: { proteinG: 72, caloriesKcal: 396, carbsG: 0, fatG: 8.64, incompleteFields: [] }, lowStock: false,
      createdAtUtc: '2026-08-11T00:00:00Z', updatedAtUtc: '2026-08-11T00:00:00Z', portions: [{ id: 'bag-1', foodId: 'food-1', label: 'Bag 1', originalQuantity: 240, remainingQuantity: 240, reservedQuantity: 0, availableQuantity: 240, expiresOn: null, status: 'available', macrosRemaining: { proteinG: 72, caloriesKcal: 396, carbsG: 0, fatG: 8.64, incompleteFields: [] }, createdAtUtc: '2026-08-11T00:00:00Z', updatedAtUtc: '2026-08-11T00:00:00Z' }],
    };
    mocks.dashboard = dashboard([food]);
    render(<KitchenPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Inventory' }));
    expect(screen.getAllByText('Chicken breast').length).toBeGreaterThan(0);
    expect(screen.getAllByText('72 g').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Add exact bags/i })).toBeTruthy();
  });

  it('adds an available stock portion to today’s plan', async () => {
    const food: KitchenFoodDTO = {
      id: 'food-1', name: 'Chicken breast', category: 'Meat', unit: 'g', preparationState: 'cooked', nutritionBasisAmount: 100,
      proteinPerBasis: 30, caloriesPerBasis: 165, carbsPerBasis: 0, fatPerBasis: 3.6, portionMode: 'whole', planningIncrement: null,
      dailyMaxQuantity: null, dailyMaxPortions: null, lowStockThreshold: 150, plannerEligible: true, archived: false, stockQuantity: 240, reservedQuantity: 0,
      availableQuantity: 240, macrosRemaining: { proteinG: 72, caloriesKcal: 396, carbsG: 0, fatG: 8.64, incompleteFields: [] }, lowStock: false,
      createdAtUtc: '2026-08-11T00:00:00Z', updatedAtUtc: '2026-08-11T00:00:00Z', portions: [{ id: 'bag-1', foodId: 'food-1', label: 'Bag 1', originalQuantity: 240, remainingQuantity: 240, reservedQuantity: 0, availableQuantity: 240, expiresOn: null, status: 'available', macrosRemaining: { proteinG: 72, caloriesKcal: 396, carbsG: 0, fatG: 8.64, incompleteFields: [] }, createdAtUtc: '2026-08-11T00:00:00Z', updatedAtUtc: '2026-08-11T00:00:00Z' }],
    };
    mocks.dashboard = dashboard([food]);
    mocks.mutateAsync.mockResolvedValue({});
    render(<KitchenPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(screen.getByRole('dialog', { name: 'Add to today’s plan' })).toBeTruthy();
    expect(screen.getByText('240 g available')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Add to plan' }));
    expect(mocks.mutateAsync).toHaveBeenCalledWith({ dateLocal: '2026-08-11', stockPortionId: 'bag-1', quantity: 240 });
  });

  it('blocks generation and links to the per-item daily limit', async () => {
    const chicken: KitchenFoodDTO = {
      id: 'food-1', name: 'Chicken breast', category: 'Meat', unit: 'g', preparationState: 'raw', nutritionBasisAmount: 100,
      proteinPerBasis: 20, caloriesPerBasis: 88, carbsPerBasis: 0, fatPerBasis: 0.6, portionMode: 'splittable', planningIncrement: 25,
      dailyMaxQuantity: null, dailyMaxPortions: null, lowStockThreshold: null, plannerEligible: true, archived: false, stockQuantity: 2000, reservedQuantity: 0,
      availableQuantity: 2000, macrosRemaining: { proteinG: 400, caloriesKcal: 1760, carbsG: 0, fatG: 12, incompleteFields: [] }, lowStock: false,
      createdAtUtc: '2026-08-11T00:00:00Z', updatedAtUtc: '2026-08-11T00:00:00Z', portions: [{ id: 'bulk', foodId: 'food-1', label: '2 kg bag', originalQuantity: 2000, remainingQuantity: 2000, reservedQuantity: 0, availableQuantity: 2000, expiresOn: null, status: 'available', macrosRemaining: { proteinG: 400, caloriesKcal: 1760, carbsG: 0, fatG: 12, incompleteFields: [] }, createdAtUtc: '2026-08-11T00:00:00Z', updatedAtUtc: '2026-08-11T00:00:00Z' }],
    };
    mocks.dashboard = dashboard([chicken]);
    render(<KitchenPage />);
    expect(screen.getByText('Set realistic daily limits before planning')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate plan' }).hasAttribute('disabled')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Set Chicken breast limit' }));
    expect(screen.getByLabelText(/Maximum per day/)).toBeTruthy();
    expect(screen.getByText('Limits this item in each daily plan and in the stock runway forecast.')).toBeTruthy();
  });

  it('shows flagged deals with price, store, location, and end date', async () => {
    mocks.dashboard = dashboard();
    render(<KitchenPage />);
    await userEvent.click(screen.getByRole('button', { name: /Deals/ }));
    expect(screen.getByText('Good deal')).toBeTruthy();
    expect(screen.getByText('19.95')).toBeTruthy();
    expect(screen.getByText('Carrefour')).toBeTruthy();
    expect(screen.getByText('Mecca')).toBeTruthy();
    expect(screen.getByText('Offer ends 2026-08-15')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh deals' })).toBeTruthy();
  });
});
