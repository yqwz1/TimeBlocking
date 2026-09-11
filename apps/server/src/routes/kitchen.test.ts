import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '../db/client.js';
import { kitchenFoods } from '../db/schema.js';
import { registerKitchenRoutes } from './kitchen.js';

describe('kitchen routes', () => {
  let db: DB;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    db = createDb(':memory:');
    app = Fastify();
    registerKitchenRoutes(app, db);
    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  async function createChicken() {
    const response = await app.inject({ method: 'POST', url: '/kitchen/foods', payload: {
      name: 'Chicken breast', category: 'Meat', unit: 'g', preparationState: 'cooked', nutritionBasisAmount: 100,
      proteinPerBasis: 30, caloriesPerBasis: 165, carbsPerBasis: 0, fatPerBasis: 3.6,
      portionMode: 'whole', planningIncrement: null, dailyMaxQuantity: null, lowStockThreshold: 150, plannerEligible: true,
    } });
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  it('creates foods and exact stock portions with calculated macros', async () => {
    const food = await createChicken();
    const stock = await app.inject({ method: 'POST', url: `/kitchen/foods/${food.id}/stock`, payload: { portions: [{ amount: 180, label: 'Bag A' }, { amount: 240, label: 'Bag B', expiresOn: '2026-08-30' }] } });
    expect(stock.statusCode).toBe(201);
    expect(stock.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Bag A', macrosRemaining: expect.objectContaining({ proteinG: 54 }) }),
      expect.objectContaining({ label: 'Bag B', macrosRemaining: expect.objectContaining({ proteinG: 72 }) }),
    ]));
    const dashboard = await app.inject({ method: 'GET', url: '/kitchen/dashboard?date=2026-08-11' });
    expect(dashboard.json()).toMatchObject({
      settings: { dailyProteinTarget: 120, dailyCaloriesTarget: 2500, dailyCarbsTarget: 325 },
      stockMacros: { proteinG: 126, caloriesKcal: 693, carbsG: 0 },
      foods: [{ stockQuantity: 420 }],
    });
  });

  it('generates reservations, blocks conflicting subtraction, consumes, and undoes', async () => {
    const food = await createChicken();
    const stock = await app.inject({ method: 'POST', url: `/kitchen/foods/${food.id}/stock`, payload: { portions: [{ amount: 200, label: 'Bag A' }, { amount: 200, label: 'Bag B' }] } });
    const stockIds = stock.json().map((item: { id: string }) => item.id);
    const generated = await app.inject({ method: 'POST', url: '/kitchen/plans/generate', payload: { dateLocal: '2026-08-11' } });
    expect(generated.statusCode).toBe(200);
    const plan = generated.json();
    expect(plan.plannedMacros.proteinG).toBe(120);
    expect(plan.lines).toHaveLength(2);

    const conflict = await app.inject({ method: 'POST', url: `/kitchen/stock/${stockIds[0]}/adjust`, payload: { deltaQuantity: -10, reason: 'correction' } });
    expect(conflict.statusCode).toBe(409);

    const line = plan.lines[0];
    const consumed = await app.inject({ method: 'POST', url: `/kitchen/plans/${plan.id}/lines/${line.id}/consume`, payload: { actualQuantity: 180 } });
    expect(consumed.statusCode).toBe(200);
    expect(consumed.json().lines.find((item: { id: string }) => item.id === line.id)).toMatchObject({ status: 'consumed', actualQuantity: 180 });

    const repeated = await app.inject({ method: 'POST', url: `/kitchen/plans/${plan.id}/lines/${line.id}/consume`, payload: {} });
    expect(repeated.statusCode).toBe(200);
    const undo = await app.inject({ method: 'POST', url: `/kitchen/plans/${plan.id}/lines/${line.id}/undo` });
    expect(undo.json().lines.find((item: { id: string }) => item.id === line.id).status).toBe('planned');
  });

  it('manually adds and removes an available stock item from today’s plan', async () => {
    const food = await createChicken();
    const stock = await app.inject({ method: 'POST', url: `/kitchen/foods/${food.id}/stock`, payload: { portions: [{ amount: 240, label: 'Manual bag' }] } });
    const stockId = stock.json()[0].id;

    const added = await app.inject({ method: 'POST', url: '/kitchen/plans/lines', payload: { dateLocal: '2026-08-11', stockPortionId: stockId, quantity: 180 } });
    expect(added.statusCode).toBe(201);
    expect(added.json()).toMatchObject({ status: 'draft', plannedMacros: { proteinG: 54 }, lines: [{ foodName: 'Chicken breast', plannedQuantity: 180, status: 'planned' }] });

    const unavailable = await app.inject({ method: 'POST', url: '/kitchen/plans/lines', payload: { dateLocal: '2026-08-11', stockPortionId: stockId, quantity: 100 } });
    expect(unavailable.statusCode).toBe(409);
    expect(unavailable.json().error).toContain('Only 60 g is available');

    const plan = added.json();
    const removed = await app.inject({ method: 'DELETE', url: `/kitchen/plans/${plan.id}/lines/${plan.lines[0].id}` });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ status: 'draft', plannedMacros: { proteinG: 0 }, lines: [] });
    const dashboard = await app.inject({ method: 'GET', url: '/kitchen/dashboard?date=2026-08-11' });
    expect(dashboard.json().foods[0].availableQuantity).toBe(240);
  });

  it('deletes an unreserved food and records its remaining stock as discarded', async () => {
    const food = await createChicken();
    await app.inject({ method: 'POST', url: `/kitchen/foods/${food.id}/stock`, payload: { portions: [{ amount: 240, label: 'To delete' }] } });

    const deleted = await app.inject({ method: 'DELETE', url: `/kitchen/foods/${food.id}` });
    expect(deleted.statusCode).toBe(204);

    const dashboard = await app.inject({ method: 'GET', url: '/kitchen/dashboard?date=2026-08-11' });
    expect(dashboard.json().foods).toEqual([]);
    expect(dashboard.json().movements).toEqual(expect.arrayContaining([
      expect.objectContaining({ foodId: food.id, deltaQuantity: -240, reason: 'discarded', note: 'Food deleted' }),
    ]));
  });

  it('does not delete food whose stock is reserved by today’s plan', async () => {
    const food = await createChicken();
    await app.inject({ method: 'POST', url: `/kitchen/foods/${food.id}/stock`, payload: { portions: [{ amount: 400 }] } });
    await app.inject({ method: 'POST', url: '/kitchen/plans/generate', payload: { dateLocal: '2026-08-11' } });

    const deleted = await app.inject({ method: 'DELETE', url: `/kitchen/foods/${food.id}` });
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json().error).toContain('Remove this food from today’s plan');
    const dashboard = await app.inject({ method: 'GET', url: '/kitchen/dashboard?date=2026-08-11' });
    expect(dashboard.json().foods).toHaveLength(1);
  });

  it('clears the dashboard after cancellation and does not duplicate lines when regenerated', async () => {
    const food = await createChicken();
    await app.inject({ method: 'POST', url: `/kitchen/foods/${food.id}/stock`, payload: { portions: [{ amount: 200, label: 'Bag A' }, { amount: 200, label: 'Bag B' }] } });

    const generated = await app.inject({ method: 'POST', url: '/kitchen/plans/generate', payload: { dateLocal: '2026-08-11' } });
    const firstPlan = generated.json();
    expect(firstPlan.lines).toHaveLength(2);

    const cancelled = await app.inject({ method: 'POST', url: `/kitchen/plans/${firstPlan.id}/cancel` });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe('cancelled');
    expect(cancelled.json().lines).toEqual([]);

    const clearedDashboard = await app.inject({ method: 'GET', url: '/kitchen/dashboard?date=2026-08-11' });
    expect(clearedDashboard.json().plan).toBeNull();

    const regenerated = await app.inject({ method: 'POST', url: '/kitchen/plans/generate', payload: { dateLocal: '2026-08-11' } });
    expect(regenerated.statusCode).toBe(200);
    expect(regenerated.json().lines).toHaveLength(2);
    expect(regenerated.json().lines.every((line: { status: string }) => line.status === 'planned')).toBe(true);
  });

  it('rejects an unbounded splittable food without erasing the existing plan', async () => {
    const food = await createChicken();
    await app.inject({ method: 'POST', url: `/kitchen/foods/${food.id}/stock`, payload: { portions: [{ amount: 200, label: 'Bag A' }, { amount: 200, label: 'Bag B' }] } });
    const initial = await app.inject({ method: 'POST', url: '/kitchen/plans/generate', payload: { dateLocal: '2026-08-11' } });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().lines).toHaveLength(2);

    db.update(kitchenFoods).set({ portionMode: 'splittable', planningIncrement: 25, dailyMaxQuantity: null }).run();
    const rejected = await app.inject({ method: 'POST', url: '/kitchen/plans/generate', payload: { dateLocal: '2026-08-11' } });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error).toContain('Set a daily planning limit for: Chicken breast');

    const dashboard = await app.inject({ method: 'GET', url: '/kitchen/dashboard?date=2026-08-11' });
    expect(dashboard.json().plan.lines).toHaveLength(2);
  });

  it('counts manual eating toward the plan target and can undo the movement', async () => {
    const food = await createChicken();
    const stock = await app.inject({ method: 'POST', url: `/kitchen/foods/${food.id}/stock`, payload: { portions: [{ amount: 100 }, { amount: 300 }] } });
    const stockId = stock.json().find((item: { originalQuantity: number }) => item.originalQuantity === 100).id;
    const eaten = await app.inject({ method: 'POST', url: `/kitchen/stock/${stockId}/adjust`, payload: { deltaQuantity: -100, reason: 'eaten', dateLocal: '2026-08-11' } });
    expect(eaten.statusCode).toBe(200);
    const plan = await app.inject({ method: 'POST', url: '/kitchen/plans/generate', payload: { dateLocal: '2026-08-11' } });
    expect(plan.json()).toMatchObject({ targetMet: true, proteinGapG: 0, plannedMacros: { proteinG: 90 } });
    const dashboard = await app.inject({ method: 'GET', url: '/kitchen/dashboard?date=2026-08-11' });
    const movement = dashboard.json().movements.find((item: { reason: string }) => item.reason === 'eaten');
    const undone = await app.inject({ method: 'POST', url: `/kitchen/movements/${movement.id}/undo` });
    expect(undone.statusCode).toBe(200);
    const refreshed = await app.inject({ method: 'GET', url: '/kitchen/dashboard?date=2026-08-11' });
    expect(refreshed.json().consumedTodayMacros.proteinG).toBe(0);
  });

  it('reports low coverage and excludes expired stock from the plan', async () => {
    const food = await createChicken();
    await app.inject({ method: 'POST', url: `/kitchen/foods/${food.id}/stock`, payload: { portions: [{ amount: 400, expiresOn: '2026-08-10' }, { amount: 100, expiresOn: '2026-08-20' }] } });
    const plan = await app.inject({ method: 'POST', url: '/kitchen/plans/generate', payload: { dateLocal: '2026-08-11' } });
    expect(plan.json()).toMatchObject({ plannedMacros: { proteinG: 30 }, proteinGapG: 90 });
    const dashboard = await app.inject({ method: 'GET', url: '/kitchen/dashboard?date=2026-08-11' });
    expect(dashboard.json().alerts.map((alert: { kind: string }) => alert.kind)).toEqual(expect.arrayContaining(['coverage', 'expired', 'insufficient_plan']));
  });

  it('applies a scoop limit to today and repeats it across the 30-day stock runway', async () => {
    const created = await app.inject({ method: 'POST', url: '/kitchen/foods', payload: {
      name: 'Protein powder', category: 'Supplements', unit: 'scoop', preparationState: 'as_packaged', nutritionBasisAmount: 1,
      proteinPerBasis: 25, caloriesPerBasis: 110, carbsPerBasis: 2, fatPerBasis: 1,
      portionMode: 'splittable', planningIncrement: 1, dailyMaxQuantity: 2, lowStockThreshold: 6, plannerEligible: true,
    } });
    expect(created.statusCode).toBe(201);
    const food = created.json();
    const stock = await app.inject({ method: 'POST', url: `/kitchen/foods/${food.id}/stock`, payload: { portions: [{ amount: 60, label: 'Monthly tub' }] } });
    const stockId = stock.json()[0].id;

    await app.inject({ method: 'PUT', url: '/kitchen/settings', payload: { dailyProteinTarget: 75, warningCoverageDays: 7, forecastDays: 30 } });
    await app.inject({ method: 'POST', url: `/kitchen/stock/${stockId}/adjust`, payload: { deltaQuantity: -1, reason: 'eaten', dateLocal: '2026-08-11' } });
    const plan = await app.inject({ method: 'POST', url: '/kitchen/plans/generate', payload: { dateLocal: '2026-08-11' } });
    expect(plan.json()).toMatchObject({ plannedMacros: { proteinG: 25 }, proteinGapG: 25, lines: [{ plannedQuantity: 1 }] });

    await app.inject({ method: 'PUT', url: '/kitchen/settings', payload: { dailyProteinTarget: 50, warningCoverageDays: 7, forecastDays: 30 } });
    const dashboard = await app.inject({ method: 'GET', url: '/kitchen/dashboard?date=2026-08-11' });
    expect(dashboard.json()).toMatchObject({ forecast: { fullTargetDays: 30, coversHorizon: true, perFood: [{ foodName: 'Protein powder', remainingAfterForecast: 0 }] } });
  });
});
