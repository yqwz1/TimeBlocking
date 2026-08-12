import { describe, expect, it } from 'vitest';
import { optimizeKitchenPlan, type PlannerFood, type PlannerPortion } from './service.js';

const food = (overrides: Partial<PlannerFood> = {}): PlannerFood => ({
  id: 'chicken',
  name: 'Chicken breast',
  nutritionBasisAmount: 100,
  proteinPerBasis: 30,
  caloriesPerBasis: 165,
  carbsPerBasis: 0,
  fatPerBasis: 3.6,
  portionMode: 'whole',
  planningIncrement: null,
  dailyMaxQuantity: null,
  dailyMaxPortions: null,
  plannerEligible: true,
  ...overrides,
});

const portion = (id: string, quantity: number, overrides: Partial<PlannerPortion> = {}): PlannerPortion => ({ id, foodId: 'chicken', availableQuantity: quantity, expiresOn: null, createdAtUtc: `2026-08-0${id.length}T00:00:00Z`, ...overrides });

describe('kitchen optimizer', () => {
  it('chooses the smallest target-meeting bag combination deterministically', () => {
    const result = optimizeKitchenPlan({ foods: [food()], portions: [portion('a', 100), portion('bb', 200), portion('ccc', 300)], targetProteinG: 89, dateLocal: '2026-08-11' });
    expect(result.map((item) => item.stockPortionId)).toEqual(['ccc']);
    expect(result[0]?.macros.proteinG).toBe(90);
  });

  it('honors pinned and excluded stock', () => {
    const result = optimizeKitchenPlan({ foods: [food()], portions: [portion('a', 100), portion('b', 200), portion('c', 300)], targetProteinG: 60, dateLocal: '2026-08-11', pinnedStockIds: ['a'], excludedStockIds: ['b'] });
    expect(result.map((item) => item.stockPortionId).sort()).toEqual(['a', 'c']);
  });

  it('fills the remaining target from a splittable portion using its increment', () => {
    const milk = food({ id: 'milk', name: 'Protein milk', portionMode: 'splittable', planningIncrement: 10, proteinPerBasis: 10 });
    const result = optimizeKitchenPlan({ foods: [milk], portions: [{ ...portion('milk-lot', 500), foodId: 'milk' }], targetProteinG: 31, dateLocal: '2026-08-11' });
    expect(result).toMatchObject([{ stockPortionId: 'milk-lot', quantity: 310, macros: { proteinG: 31 } }]);
  });

  it('uses a larger splittable portion for coverage when a daily portion limit would trap a leftover', () => {
    const chicken = food({ portionMode: 'splittable', planningIncrement: 25, dailyMaxQuantity: 1_000, dailyMaxPortions: 1, proteinPerBasis: 30 });
    const portions = [
      portion('leftover', 50, { createdAtUtc: '2026-08-11T00:00:00Z' }),
      portion('full-bag', 400, { createdAtUtc: '2026-08-12T00:00:00Z' }),
    ];

    const normalPlan = optimizeKitchenPlan({ foods: [chicken], portions, targetProteinG: 120, dateLocal: '2026-08-12' });
    expect(normalPlan).toMatchObject([{ stockPortionId: 'leftover', macros: { proteinG: 15 } }]);

    const runwayPlan = optimizeKitchenPlan({ foods: [chicken], portions, targetProteinG: 120, dateLocal: '2026-08-12', preferLargestPortions: true });
    expect(runwayPlan).toMatchObject([{ stockPortionId: 'full-bag', quantity: 400, macros: { proteinG: 120 } }]);
  });

  it('excludes expired portions and returns the best available shortfall', () => {
    const result = optimizeKitchenPlan({ foods: [food()], portions: [portion('expired', 400, { expiresOn: '2026-08-10' }), portion('fresh', 100)], targetProteinG: 120, dateLocal: '2026-08-11' });
    expect(result.map((item) => item.stockPortionId)).toEqual(['fresh']);
    expect(result[0]?.macros.proteinG).toBe(30);
  });

  it('uses earliest expiry as the stable tie-breaker', () => {
    const result = optimizeKitchenPlan({ foods: [food()], portions: [portion('later', 200, { expiresOn: '2026-08-20' }), portion('sooner', 200, { expiresOn: '2026-08-15' })], targetProteinG: 60, dateLocal: '2026-08-11' });
    expect(result.map((item) => item.stockPortionId)).toEqual(['sooner']);
  });

  it('respects persistent per-food daily quantity limits', () => {
    const limited = food({ dailyMaxQuantity: 200 });
    const result = optimizeKitchenPlan({ foods: [limited], portions: [portion('one', 200), portion('two', 200)], targetProteinG: 120, dateLocal: '2026-08-11' });
    expect(result).toHaveLength(1);
    expect(result[0]?.macros.proteinG).toBe(60);
  });

  it('counts quantities already eaten toward the per-food daily limit', () => {
    const powder = food({ id: 'powder', name: 'Protein powder', nutritionBasisAmount: 1, proteinPerBasis: 25, portionMode: 'splittable', planningIncrement: 1, dailyMaxQuantity: 2 });
    const result = optimizeKitchenPlan({
      foods: [powder],
      portions: [{ ...portion('tub', 20), foodId: 'powder' }],
      targetProteinG: 75,
      dateLocal: '2026-08-11',
      initialQuantitiesByFood: new Map([['powder', 1]]),
    });
    expect(result).toMatchObject([{ stockPortionId: 'tub', quantity: 1, macros: { proteinG: 25 } }]);
  });

  it('prefers a varied food mix when target accuracy is equal', () => {
    const beef = food({ id: 'beef', name: 'Ground beef' });
    const tuna = food({ id: 'tuna', name: 'Tuna' });
    const result = optimizeKitchenPlan({
      foods: [food(), beef, tuna],
      portions: [
        portion('chicken-1', 100),
        portion('chicken-2', 100),
        portion('chicken-3', 100),
        { ...portion('beef-1', 100), foodId: 'beef' },
        { ...portion('tuna-1', 100), foodId: 'tuna' },
      ],
      targetProteinG: 90,
      dateLocal: '2026-08-11',
    });
    expect(new Set(result.map((item) => item.foodId))).toEqual(new Set(['chicken', 'beef', 'tuna']));
  });

  it('limits variable-weight whole foods by stock portion count', () => {
    const limited = food({ dailyMaxPortions: 1 });
    const result = optimizeKitchenPlan({
      foods: [limited],
      portions: [portion('small', 170), portion('large', 219)],
      targetProteinG: 120,
      dateLocal: '2026-08-11',
    });
    expect(result).toHaveLength(1);
  });

  it('counts an already eaten stock portion toward the daily portion limit', () => {
    const limited = food({ dailyMaxPortions: 1 });
    const result = optimizeKitchenPlan({
      foods: [limited],
      portions: [portion('remaining', 219)],
      targetProteinG: 60,
      dateLocal: '2026-08-11',
      initialQuantitiesByFood: new Map([['chicken', 170]]),
      initialPortionCountsByFood: new Map([['chicken', 1]]),
    });
    expect(result).toEqual([]);
  });
});
