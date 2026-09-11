import type { FastifyInstance, FastifyReply } from 'fastify';
import { DateTime } from 'luxon';
import {
  KitchenFoodInputSchema,
  KitchenFoodPatchSchema,
  KitchenPlanConsumeSchema,
  KitchenPlanGenerateSchema,
  KitchenPlanLineAddSchema,
  KitchenSettingsInputSchema,
  KitchenStockAddSchema,
  KitchenStockAdjustmentSchema,
} from '@timeblock/shared';
import type { DB } from '../db/client.js';
import { getSettings } from '../settings.js';
import {
  KitchenError,
  addKitchenPlanLine,
  addKitchenStock,
  adjustKitchenStock,
  cancelKitchenPlan,
  consumeKitchenPlanLine,
  createKitchenFood,
  deleteKitchenFood,
  generateKitchenPlan,
  getKitchenDashboard,
  getKitchenSettings,
  getKitchenStatus,
  listKitchenFoods,
  removeKitchenPlanLine,
  saveKitchenSettings,
  undoKitchenPlanLine,
  undoKitchenMovement,
  updateKitchenFood,
} from '../kitchen/service.js';
import { fetchD4DProteinDeals, getKitchenDeals, refreshKitchenDeals, type D4DResult } from '../kitchen/deals.js';

function localToday(db: DB) {
  return DateTime.now().setZone(getSettings(db).timezone).toISODate()!;
}

function validDate(value: string | undefined, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && DateTime.fromISO(value).isValid ? value : fallback;
}

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof KitchenError) return reply.code(error.statusCode).send({ error: error.message });
  throw error;
}

export function registerKitchenRoutes(app: FastifyInstance, db: DB, dealFetcher: (today: string) => Promise<D4DResult> = fetchD4DProteinDeals) {
  app.get('/kitchen/settings', async () => getKitchenSettings(db));
  app.put<{ Body: unknown }>('/kitchen/settings', async (req, reply) => {
    const parsed = KitchenSettingsInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return saveKitchenSettings(db, parsed.data);
  });

  app.get<{ Querystring: { date?: string } }>('/kitchen/dashboard', async (req) => getKitchenDashboard(db, validDate(req.query.date, localToday(db))));
  app.get('/kitchen/status', async () => getKitchenStatus(db, localToday(db)));
  app.get('/kitchen/deals', async () => getKitchenDeals(db, localToday(db), dealFetcher));
  app.post('/kitchen/deals/refresh', async (_req, reply) => {
    try { return await refreshKitchenDeals(db, localToday(db), dealFetcher); }
    catch (error) { return reply.code(502).send({ error: error instanceof Error ? error.message : 'D4D refresh failed' }); }
  });

  app.get<{ Querystring: { archived?: string } }>('/kitchen/foods', async (req) => listKitchenFoods(db, req.query.archived === '1'));
  app.post<{ Body: unknown }>('/kitchen/foods', async (req, reply) => {
    const parsed = KitchenFoodInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try { return reply.code(201).send(createKitchenFood(db, parsed.data)); } catch (error) { return fail(reply, error); }
  });
  app.patch<{ Params: { id: string }; Body: unknown }>('/kitchen/foods/:id', async (req, reply) => {
    const parsed = KitchenFoodPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try { return updateKitchenFood(db, req.params.id, parsed.data); } catch (error) { return fail(reply, error); }
  });
  app.delete<{ Params: { id: string } }>('/kitchen/foods/:id', async (req, reply) => {
    try { deleteKitchenFood(db, req.params.id, localToday(db)); return reply.code(204).send(); } catch (error) { return fail(reply, error); }
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/kitchen/foods/:id/stock', async (req, reply) => {
    const parsed = KitchenStockAddSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try { return reply.code(201).send(addKitchenStock(db, req.params.id, parsed.data, localToday(db))); } catch (error) { return fail(reply, error); }
  });
  app.post<{ Params: { id: string }; Body: unknown }>('/kitchen/stock/:id/adjust', async (req, reply) => {
    const parsed = KitchenStockAdjustmentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try { return adjustKitchenStock(db, req.params.id, parsed.data, localToday(db)); } catch (error) { return fail(reply, error); }
  });

  app.post<{ Body: unknown }>('/kitchen/plans/generate', async (req, reply) => {
    const parsed = KitchenPlanGenerateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const date = validDate(parsed.data.dateLocal, localToday(db));
    try { return generateKitchenPlan(db, parsed.data, date); } catch (error) { return fail(reply, error); }
  });
  app.post<{ Body: unknown }>('/kitchen/plans/lines', async (req, reply) => {
    const parsed = KitchenPlanLineAddSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const date = validDate(parsed.data.dateLocal, localToday(db));
    try { return reply.code(201).send(addKitchenPlanLine(db, parsed.data, date)); } catch (error) { return fail(reply, error); }
  });
  app.delete<{ Params: { planId: string; lineId: string } }>('/kitchen/plans/:planId/lines/:lineId', async (req, reply) => {
    try { return removeKitchenPlanLine(db, req.params.planId, req.params.lineId); } catch (error) { return fail(reply, error); }
  });
  app.post<{ Params: { planId: string; lineId: string }; Body: unknown }>('/kitchen/plans/:planId/lines/:lineId/consume', async (req, reply) => {
    const parsed = KitchenPlanConsumeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try { return consumeKitchenPlanLine(db, req.params.planId, req.params.lineId, parsed.data.actualQuantity); } catch (error) { return fail(reply, error); }
  });
  app.post<{ Params: { planId: string; lineId: string } }>('/kitchen/plans/:planId/lines/:lineId/undo', async (req, reply) => {
    try { return undoKitchenPlanLine(db, req.params.planId, req.params.lineId); } catch (error) { return fail(reply, error); }
  });
  app.post<{ Params: { id: string } }>('/kitchen/plans/:id/cancel', async (req, reply) => {
    try { return cancelKitchenPlan(db, req.params.id); } catch (error) { return fail(reply, error); }
  });
  app.post<{ Params: { id: string } }>('/kitchen/movements/:id/undo', async (req, reply) => {
    try { return undoKitchenMovement(db, req.params.id); } catch (error) { return fail(reply, error); }
  });
}
