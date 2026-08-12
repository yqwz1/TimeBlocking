import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type {
  KitchenAlertDTO,
  KitchenDashboardDTO,
  KitchenFoodDTO,
  KitchenFoodInput,
  KitchenFoodPatch,
  KitchenForecastDTO,
  KitchenMacroTotals,
  KitchenPlanDTO,
  KitchenPlanGenerateInput,
  KitchenPlanLineAddInput,
  KitchenSettingsDTO,
  KitchenSettingsInput,
  KitchenStatusDTO,
  KitchenStockAddInput,
  KitchenStockAdjustmentInput,
  KitchenStockMovementDTO,
  KitchenStockPortionDTO,
} from '@timeblock/shared';
import type { DB } from '../db/client.js';
import {
  kitchenFoods,
  kitchenPlanLines,
  kitchenPlans,
  kitchenSettings,
  kitchenStockMovements,
  kitchenStockPortions,
} from '../db/schema.js';
import { nowUtcIso } from '../config.js';

type FoodRow = typeof kitchenFoods.$inferSelect;
type PortionRow = typeof kitchenStockPortions.$inferSelect;
type PlanRow = typeof kitchenPlans.$inferSelect;
type PlanLineRow = typeof kitchenPlanLines.$inferSelect;

const EPSILON = 0.000_001;

export class KitchenError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
  }
}

function round(value: number, digits = 3) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

type NutritionSource = Pick<FoodRow, 'nutritionBasisAmount' | 'proteinPerBasis' | 'caloriesPerBasis' | 'carbsPerBasis' | 'fatPerBasis'>;

function macrosFor(food: NutritionSource, quantity: number): KitchenMacroTotals {
  const factor = quantity / food.nutritionBasisAmount;
  const missing: KitchenMacroTotals['incompleteFields'] = [];
  if (food.caloriesPerBasis == null) missing.push('calories');
  if (food.carbsPerBasis == null) missing.push('carbs');
  if (food.fatPerBasis == null) missing.push('fat');
  return {
    proteinG: round(food.proteinPerBasis * factor),
    caloriesKcal: food.caloriesPerBasis == null ? null : round(food.caloriesPerBasis * factor),
    carbsG: food.carbsPerBasis == null ? null : round(food.carbsPerBasis * factor),
    fatG: food.fatPerBasis == null ? null : round(food.fatPerBasis * factor),
    incompleteFields: missing,
  };
}

function combineMacros(values: KitchenMacroTotals[]): KitchenMacroTotals {
  const incomplete = new Set<KitchenMacroTotals['incompleteFields'][number]>();
  for (const value of values) value.incompleteFields.forEach((field) => incomplete.add(field));
  const complete = (field: 'caloriesKcal' | 'carbsG' | 'fatG') => values.length > 0 && values.every((value) => value[field] != null);
  return {
    proteinG: round(values.reduce((sum, value) => sum + value.proteinG, 0)),
    caloriesKcal: complete('caloriesKcal') ? round(values.reduce((sum, value) => sum + (value.caloriesKcal ?? 0), 0)) : null,
    carbsG: complete('carbsG') ? round(values.reduce((sum, value) => sum + (value.carbsG ?? 0), 0)) : null,
    fatG: complete('fatG') ? round(values.reduce((sum, value) => sum + (value.fatG ?? 0), 0)) : null,
    incompleteFields: [...incomplete],
  };
}

function snapshotMacros(row: { proteinG: number; caloriesKcal: number | null; carbsG: number | null; fatG: number | null }): KitchenMacroTotals {
  const incomplete: KitchenMacroTotals['incompleteFields'] = [];
  if (row.caloriesKcal == null) incomplete.push('calories');
  if (row.carbsG == null) incomplete.push('carbs');
  if (row.fatG == null) incomplete.push('fat');
  return { proteinG: round(row.proteinG), caloriesKcal: row.caloriesKcal, carbsG: row.carbsG, fatG: row.fatG, incompleteFields: incomplete };
}

export function getKitchenSettings(db: DB): KitchenSettingsDTO {
  const row = db.select().from(kitchenSettings).where(eq(kitchenSettings.id, 'default')).get();
  return row
    ? { dailyProteinTarget: row.dailyProteinTarget, dailyCaloriesTarget: row.dailyCaloriesTarget, dailyCarbsTarget: row.dailyCarbsTarget, warningCoverageDays: row.warningCoverageDays, forecastDays: row.forecastDays, updatedAtUtc: row.updatedAtUtc }
    : { dailyProteinTarget: 120, dailyCaloriesTarget: 2_500, dailyCarbsTarget: 325, warningCoverageDays: 7, forecastDays: 30, updatedAtUtc: null };
}

export function saveKitchenSettings(db: DB, input: KitchenSettingsInput): KitchenSettingsDTO {
  const updatedAtUtc = nowUtcIso();
  db.insert(kitchenSettings).values({ id: 'default', ...input, updatedAtUtc })
    .onConflictDoUpdate({ target: kitchenSettings.id, set: { ...input, updatedAtUtc } }).run();
  return { ...input, updatedAtUtc };
}

function reservedQuantities(db: DB, ignorePlanId?: string) {
  const activePlanIds = new Set(db.select().from(kitchenPlans).all().filter((plan) => plan.status === 'draft' && plan.id !== ignorePlanId).map((plan) => plan.id));
  const result = new Map<string, number>();
  for (const line of db.select().from(kitchenPlanLines).all()) {
    if (line.status !== 'planned' || !activePlanIds.has(line.planId)) continue;
    result.set(line.stockPortionId, round((result.get(line.stockPortionId) ?? 0) + line.plannedQuantity));
  }
  return result;
}

function portionDTO(food: FoodRow, row: PortionRow, reserved: number): KitchenStockPortionDTO {
  const available = Math.max(0, round(row.remainingQuantity - reserved));
  return {
    id: row.id,
    foodId: row.foodId,
    label: row.label,
    originalQuantity: row.originalQuantity,
    remainingQuantity: row.remainingQuantity,
    reservedQuantity: round(reserved),
    availableQuantity: available,
    expiresOn: row.expiresOn,
    status: row.status as KitchenStockPortionDTO['status'],
    macrosRemaining: macrosFor(food, row.remainingQuantity),
    createdAtUtc: row.createdAtUtc,
    updatedAtUtc: row.updatedAtUtc,
  };
}

export function listKitchenFoods(db: DB, includeArchived = false, ignorePlanId?: string): KitchenFoodDTO[] {
  const reservations = reservedQuantities(db, ignorePlanId);
  const portions = db.select().from(kitchenStockPortions).all();
  return db.select().from(kitchenFoods).all()
    .filter((food) => includeArchived || !food.archived)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((food) => {
      const foodPortions = portions.filter((portion) => portion.foodId === food.id && portion.status !== 'discarded')
        .map((portion) => portionDTO(food, portion, reservations.get(portion.id) ?? 0))
        .sort((a, b) => (a.expiresOn ?? '9999-12-31').localeCompare(b.expiresOn ?? '9999-12-31') || a.createdAtUtc.localeCompare(b.createdAtUtc));
      const stockQuantity = round(foodPortions.reduce((sum, portion) => sum + portion.remainingQuantity, 0));
      const reservedQuantity = round(foodPortions.reduce((sum, portion) => sum + portion.reservedQuantity, 0));
      const availableQuantity = round(foodPortions.reduce((sum, portion) => sum + portion.availableQuantity, 0));
      return {
        id: food.id,
        name: food.name,
        category: food.category,
        unit: food.unit as KitchenFoodDTO['unit'],
        preparationState: food.preparationState as KitchenFoodDTO['preparationState'],
        nutritionBasisAmount: food.nutritionBasisAmount,
        proteinPerBasis: food.proteinPerBasis,
        caloriesPerBasis: food.caloriesPerBasis,
        carbsPerBasis: food.carbsPerBasis,
        fatPerBasis: food.fatPerBasis,
        portionMode: food.portionMode as KitchenFoodDTO['portionMode'],
        planningIncrement: food.planningIncrement,
        dailyMaxQuantity: food.dailyMaxQuantity,
        dailyMaxPortions: food.dailyMaxPortions,
        lowStockThreshold: food.lowStockThreshold,
        plannerEligible: !!food.plannerEligible,
        archived: !!food.archived,
        portions: foodPortions,
        stockQuantity,
        reservedQuantity,
        availableQuantity,
        macrosRemaining: macrosFor(food, stockQuantity),
        lowStock: food.lowStockThreshold != null && availableQuantity <= food.lowStockThreshold,
        createdAtUtc: food.createdAtUtc,
        updatedAtUtc: food.updatedAtUtc,
      };
    });
}

function requireFood(db: DB, id: string) {
  const food = db.select().from(kitchenFoods).where(eq(kitchenFoods.id, id)).get();
  if (!food || food.archived) throw new KitchenError('Food not found', 404);
  return food;
}

function requirePortion(db: DB, id: string) {
  const portion = db.select().from(kitchenStockPortions).where(eq(kitchenStockPortions.id, id)).get();
  if (!portion) throw new KitchenError('Stock portion not found', 404);
  return portion;
}

export function createKitchenFood(db: DB, input: KitchenFoodInput): KitchenFoodDTO {
  const now = nowUtcIso();
  const id = randomUUID();
  db.insert(kitchenFoods).values({ ...input, plannerEligible: input.plannerEligible ? 1 : 0, archived: 0, id, createdAtUtc: now, updatedAtUtc: now }).run();
  return listKitchenFoods(db).find((food) => food.id === id)!;
}

export function updateKitchenFood(db: DB, id: string, patch: KitchenFoodPatch): KitchenFoodDTO {
  const existing = requireFood(db, id);
  const portionMode = patch.portionMode ?? existing.portionMode;
  const planningIncrement = patch.planningIncrement === undefined ? existing.planningIncrement : patch.planningIncrement;
  const dailyMaxQuantity = patch.dailyMaxQuantity === undefined ? existing.dailyMaxQuantity : patch.dailyMaxQuantity;
  const plannerEligible = patch.plannerEligible ?? !!existing.plannerEligible;
  if (portionMode === 'splittable' && planningIncrement == null) {
    throw new KitchenError('Splittable foods require a planning increment');
  }
  if (plannerEligible && portionMode === 'splittable' && dailyMaxQuantity == null) {
    throw new KitchenError('Splittable foods used in plans require a daily planning limit');
  }
  if (planningIncrement != null && dailyMaxQuantity != null && dailyMaxQuantity < planningIncrement) {
    throw new KitchenError('Daily planning limit must be at least one planning increment');
  }
  if (patch.unit && patch.unit !== existing.unit) {
    const hasStock = db.select().from(kitchenStockPortions).all().some((portion) => portion.foodId === id && portion.remainingQuantity > EPSILON);
    if (hasStock) throw new KitchenError('Finish or discard existing stock before changing its quantity unit', 409);
  }
  db.update(kitchenFoods).set({ ...patch, plannerEligible: patch.plannerEligible == null ? undefined : patch.plannerEligible ? 1 : 0, updatedAtUtc: nowUtcIso() }).where(eq(kitchenFoods.id, id)).run();
  return listKitchenFoods(db).find((food) => food.id === id)!;
}

export function archiveKitchenFood(db: DB, id: string) {
  requireFood(db, id);
  const hasRemaining = db.select().from(kitchenStockPortions).all().some((portion) => portion.foodId === id && portion.remainingQuantity > EPSILON);
  if (hasRemaining) throw new KitchenError('Remove, eat, or discard remaining stock before archiving this food', 409);
  db.update(kitchenFoods).set({ archived: 1, plannerEligible: 0, updatedAtUtc: nowUtcIso() }).where(eq(kitchenFoods.id, id)).run();
}

export function addKitchenStock(db: DB, foodId: string, input: KitchenStockAddInput, dateLocal: string): KitchenStockPortionDTO[] {
  const food = requireFood(db, foodId);
  const now = nowUtcIso();
  const ids: string[] = [];
  (db as any).transaction((tx: DB) => {
    for (const item of input.portions) {
      const id = randomUUID();
      ids.push(id);
      tx.insert(kitchenStockPortions).values({ id, foodId, label: item.label, originalQuantity: item.amount, remainingQuantity: item.amount, expiresOn: item.expiresOn, status: 'available', createdAtUtc: now, updatedAtUtc: now }).run();
      const macros = macrosFor(food, item.amount);
      tx.insert(kitchenStockMovements).values({ id: randomUUID(), foodId, stockPortionId: id, planLineId: null, deltaQuantity: item.amount, reason: 'stocked', dateLocal, note: item.label ?? '', proteinG: macros.proteinG, caloriesKcal: macros.caloriesKcal, carbsG: macros.carbsG, fatG: macros.fatG, reversalOfId: null, reversedAtUtc: null, createdAtUtc: now }).run();
    }
  });
  const foods = listKitchenFoods(db);
  return foods.find((item) => item.id === foodId)!.portions.filter((portion) => ids.includes(portion.id));
}

export function adjustKitchenStock(db: DB, stockId: string, input: KitchenStockAdjustmentInput, fallbackDate: string): KitchenStockPortionDTO {
  const portion = requirePortion(db, stockId);
  const food = requireFood(db, portion.foodId);
  if ((input.reason === 'eaten' || input.reason === 'discarded') && input.deltaQuantity > 0) throw new KitchenError(`${input.reason} adjustments must subtract stock`);
  const reserved = reservedQuantities(db).get(stockId) ?? 0;
  const next = round(portion.remainingQuantity + input.deltaQuantity);
  if (next < reserved - EPSILON) throw new KitchenError('This adjustment would remove stock reserved by today’s plan', 409);
  if (next < -EPSILON) throw new KitchenError('Adjustment exceeds the remaining stock', 409);
  const now = nowUtcIso();
  const absoluteMacros = macrosFor(food, Math.abs(input.deltaQuantity));
  (db as any).transaction((tx: DB) => {
    tx.update(kitchenStockPortions).set({ remainingQuantity: Math.max(0, next), status: next <= EPSILON ? (input.reason === 'discarded' ? 'discarded' : 'empty') : 'available', updatedAtUtc: now }).where(eq(kitchenStockPortions.id, stockId)).run();
    tx.insert(kitchenStockMovements).values({ id: randomUUID(), foodId: food.id, stockPortionId: stockId, planLineId: null, deltaQuantity: input.deltaQuantity, reason: input.reason, dateLocal: input.dateLocal ?? fallbackDate, note: input.note, proteinG: absoluteMacros.proteinG, caloriesKcal: absoluteMacros.caloriesKcal, carbsG: absoluteMacros.carbsG, fatG: absoluteMacros.fatG, reversalOfId: null, reversedAtUtc: null, createdAtUtc: now }).run();
  });
  return listKitchenFoods(db).find((item) => item.id === food.id)!.portions.find((item) => item.id === stockId)!;
}

export interface PlannerFood {
  id: string;
  name: string;
  nutritionBasisAmount: number;
  proteinPerBasis: number;
  caloriesPerBasis: number | null;
  carbsPerBasis: number | null;
  fatPerBasis: number | null;
  portionMode: 'whole' | 'splittable';
  planningIncrement: number | null;
  dailyMaxQuantity: number | null;
  dailyMaxPortions: number | null;
  plannerEligible: boolean;
}

export interface PlannerPortion {
  id: string;
  foodId: string;
  availableQuantity: number;
  expiresOn: string | null;
  createdAtUtc: string;
}

export interface PlannerSelection {
  foodId: string;
  stockPortionId: string;
  quantity: number;
  macros: KitchenMacroTotals;
  expiresOn: string | null;
  createdAtUtc: string;
}

interface Choice {
  proteinUnits: number;
  selections: PlannerSelection[];
  quantities: Map<string, number>;
  portionCounts: Map<string, number>;
}

function choiceOrder(a: Choice, b: Choice, targetUnits: number) {
  const aMet = a.proteinUnits >= targetUnits;
  const bMet = b.proteinUnits >= targetUnits;
  if (aMet !== bMet) return aMet ? -1 : 1;
  if (a.proteinUnits !== b.proteinUnits) return aMet ? a.proteinUnits - b.proteinUnits : b.proteinUnits - a.proteinUnits;
  const aFoods = [...a.quantities.values()].filter((quantity) => quantity > EPSILON).length;
  const bFoods = [...b.quantities.values()].filter((quantity) => quantity > EPSILON).length;
  if (aFoods !== bFoods) return bFoods - aFoods;
  if (a.selections.length !== b.selections.length) return a.selections.length - b.selections.length;
  const key = (choice: Choice) => choice.selections.map((selection) => `${selection.expiresOn ?? '9999-12-31'}:${selection.createdAtUtc}:${selection.stockPortionId}`).sort().join('|');
  return key(a).localeCompare(key(b));
}

function plannerMacros(food: PlannerFood, quantity: number): KitchenMacroTotals {
  return macrosFor(food, quantity);
}

export function optimizeKitchenPlan(args: {
  foods: PlannerFood[];
  portions: PlannerPortion[];
  targetProteinG: number;
  dateLocal: string;
  initialQuantitiesByFood?: ReadonlyMap<string, number>;
  initialPortionCountsByFood?: ReadonlyMap<string, number>;
  pinnedStockIds?: string[];
  excludedFoodIds?: string[];
  excludedStockIds?: string[];
  /**
   * A coverage forecast needs to prove that a full day is feasible. Prefer
   * portions with more usable protein so a small leftover cannot consume a
   * food's only daily stock-portion slot before a larger bag is considered.
   * Normal plan generation continues to prefer expiry order.
   */
  preferLargestPortions?: boolean;
}): PlannerSelection[] {
  const foodMap = new Map(args.foods.map((food) => [food.id, food]));
  const pinned = new Set(args.pinnedStockIds ?? []);
  const excludedFoods = new Set(args.excludedFoodIds ?? []);
  const excludedStock = new Set(args.excludedStockIds ?? []);
  const eligible = args.portions.filter((portion) => {
    const food = foodMap.get(portion.foodId);
    return !!food && food.plannerEligible && !excludedFoods.has(food.id) && !excludedStock.has(portion.id) && portion.availableQuantity > EPSILON && (!portion.expiresOn || portion.expiresOn >= args.dateLocal);
  });
  for (const id of pinned) if (!eligible.some((portion) => portion.id === id)) throw new KitchenError('A pinned portion is unavailable, expired, or excluded', 409);
  const targetUnits = Math.max(0, Math.round(args.targetProteinG * 10));
  if (targetUnits === 0) return [];

  const whole = eligible.filter((portion) => foodMap.get(portion.foodId)!.portionMode === 'whole');
  const split = eligible.filter((portion) => foodMap.get(portion.foodId)!.portionMode === 'splittable')
    .sort((a, b) => {
      const pinnedOrder = Number(pinned.has(b.id)) - Number(pinned.has(a.id));
      if (pinnedOrder !== 0) return pinnedOrder;
      if (args.preferLargestPortions) {
        const usableProtein = (portion: PlannerPortion) => {
          const food = foodMap.get(portion.foodId)!;
          const quantity = food.dailyMaxQuantity == null ? portion.availableQuantity : Math.min(portion.availableQuantity, food.dailyMaxQuantity);
          return macrosFor(food, quantity).proteinG;
        };
        const capacityOrder = usableProtein(b) - usableProtein(a);
        if (Math.abs(capacityOrder) > EPSILON) return capacityOrder;
      }
      return (a.expiresOn ?? '9999-12-31').localeCompare(b.expiresOn ?? '9999-12-31') || a.createdAtUtc.localeCompare(b.createdAtUtc) || a.id.localeCompare(b.id);
    });

  let initial: Choice = { proteinUnits: 0, selections: [], quantities: new Map(args.initialQuantitiesByFood), portionCounts: new Map(args.initialPortionCountsByFood) };
  for (const portion of whole.filter((item) => pinned.has(item.id))) {
    const food = foodMap.get(portion.foodId)!;
    const used = initial.quantities.get(food.id) ?? 0;
    const portionsUsed = initial.portionCounts.get(food.id) ?? 0;
    if (food.dailyMaxQuantity != null && used + portion.availableQuantity > food.dailyMaxQuantity + EPSILON) throw new KitchenError(`Pinned stock exceeds ${food.name}'s daily limit`, 409);
    if (food.dailyMaxPortions != null && portionsUsed + 1 > food.dailyMaxPortions) throw new KitchenError(`Pinned stock exceeds ${food.name}'s daily portion limit`, 409);
    const macros = plannerMacros(food, portion.availableQuantity);
    initial = { proteinUnits: initial.proteinUnits + Math.round(macros.proteinG * 10), selections: [...initial.selections, { foodId: food.id, stockPortionId: portion.id, quantity: portion.availableQuantity, macros, expiresOn: portion.expiresOn, createdAtUtc: portion.createdAtUtc }], quantities: new Map(initial.quantities).set(food.id, round(used + portion.availableQuantity)), portionCounts: new Map(initial.portionCounts).set(food.id, portionsUsed + 1) };
  }

  const optionalWhole = whole.filter((portion) => !pinned.has(portion.id));
  const maxWholeUnits = Math.max(0, ...optionalWhole.map((portion) => Math.round(plannerMacros(foodMap.get(portion.foodId)!, portion.availableQuantity).proteinG * 10)));
  const cap = Math.max(initial.proteinUnits, targetUnits + maxWholeUnits);
  let states = new Map<number, Choice>([[initial.proteinUnits, initial]]);
  for (const portion of optionalWhole) {
    const food = foodMap.get(portion.foodId)!;
    const macros = plannerMacros(food, portion.availableQuantity);
    const units = Math.round(macros.proteinG * 10);
    const next = new Map(states);
    for (const choice of states.values()) {
      const used = choice.quantities.get(food.id) ?? 0;
      const portionsUsed = choice.portionCounts.get(food.id) ?? 0;
      if (food.dailyMaxQuantity != null && used + portion.availableQuantity > food.dailyMaxQuantity + EPSILON) continue;
      if (food.dailyMaxPortions != null && portionsUsed + 1 > food.dailyMaxPortions) continue;
      const proteinUnits = choice.proteinUnits + units;
      if (proteinUnits > cap) continue;
      const candidate: Choice = { proteinUnits, selections: [...choice.selections, { foodId: food.id, stockPortionId: portion.id, quantity: portion.availableQuantity, macros, expiresOn: portion.expiresOn, createdAtUtc: portion.createdAtUtc }], quantities: new Map(choice.quantities).set(food.id, round(used + portion.availableQuantity)), portionCounts: new Map(choice.portionCounts).set(food.id, portionsUsed + 1) };
      const current = next.get(proteinUnits);
      if (!current || choiceOrder(candidate, current, targetUnits) < 0) next.set(proteinUnits, candidate);
    }
    states = next;
  }

  const completed: Choice[] = [];
  for (const base of states.values()) {
    let choice: Choice = { proteinUnits: base.proteinUnits, selections: [...base.selections], quantities: new Map(base.quantities), portionCounts: new Map(base.portionCounts) };
    let valid = true;
    for (const portion of split) {
      const food = foodMap.get(portion.foodId)!;
      const step = food.planningIncrement ?? 1;
      const used = choice.quantities.get(food.id) ?? 0;
      const portionsUsed = choice.portionCounts.get(food.id) ?? 0;
      if (food.dailyMaxPortions != null && portionsUsed + 1 > food.dailyMaxPortions) {
        if (pinned.has(portion.id)) { valid = false; break; }
        continue;
      }
      const foodAvailable = food.dailyMaxQuantity == null ? portion.availableQuantity : Math.max(0, Math.min(portion.availableQuantity, food.dailyMaxQuantity - used));
      if (foodAvailable + EPSILON < step) {
        if (pinned.has(portion.id)) { valid = false; break; }
        continue;
      }
      const remainingProtein = Math.max(0, (targetUnits - choice.proteinUnits) / 10);
      let quantity = remainingProtein > 0 ? Math.ceil((remainingProtein * food.nutritionBasisAmount / food.proteinPerBasis) / step - EPSILON) * step : 0;
      if (pinned.has(portion.id)) quantity = Math.max(step, quantity);
      quantity = Math.min(foodAvailable, quantity > 0 ? quantity : 0);
      quantity = Math.floor(quantity / step + EPSILON) * step;
      if (quantity <= EPSILON) continue;
      const macros = plannerMacros(food, quantity);
      choice.selections.push({ foodId: food.id, stockPortionId: portion.id, quantity: round(quantity), macros, expiresOn: portion.expiresOn, createdAtUtc: portion.createdAtUtc });
      choice.quantities.set(food.id, round(used + quantity));
      choice.portionCounts.set(food.id, portionsUsed + 1);
      choice.proteinUnits += Math.round(macros.proteinG * 10);
    }
    if (valid) completed.push(choice);
  }
  completed.sort((a, b) => choiceOrder(a, b, targetUnits));
  return completed[0]?.selections ?? [];
}

function lineDTO(row: PlanLineRow, food: FoodRow, portion: PortionRow) {
  return {
    id: row.id,
    planId: row.planId,
    foodId: row.foodId,
    foodName: food.name,
    stockPortionId: row.stockPortionId,
    stockLabel: portion.label,
    unit: food.unit as KitchenPlanDTO['lines'][number]['unit'],
    plannedQuantity: row.plannedQuantity,
    actualQuantity: row.actualQuantity,
    status: row.status as KitchenPlanDTO['lines'][number]['status'],
    macros: snapshotMacros(row),
    expiresOn: portion.expiresOn,
    createdAtUtc: row.createdAtUtc,
    consumedAtUtc: row.consumedAtUtc,
  };
}

function planDTO(db: DB, plan: PlanRow, externalConsumedProtein = 0): KitchenPlanDTO {
  const foods = new Map(db.select().from(kitchenFoods).all().map((food) => [food.id, food]));
  const portions = new Map(db.select().from(kitchenStockPortions).all().map((portion) => [portion.id, portion]));
  const lines = db.select().from(kitchenPlanLines).where(eq(kitchenPlanLines.planId, plan.id)).all()
    .filter((line) => line.status !== 'cancelled')
    .map((line) => lineDTO(line, foods.get(line.foodId)!, portions.get(line.stockPortionId)!));
  const plannedMacros = combineMacros(lines.filter((line) => line.status === 'planned').map((line) => line.macros));
  const consumedMacros = combineMacros(lines.filter((line) => line.status === 'consumed').map((line) => line.macros));
  const accounted = plannedMacros.proteinG + consumedMacros.proteinG + externalConsumedProtein;
  return { id: plan.id, dateLocal: plan.dateLocal, targetProteinG: plan.targetProteinG, status: plan.status as KitchenPlanDTO['status'], lines, plannedMacros, consumedMacros, proteinGapG: round(Math.max(0, plan.targetProteinG - accounted)), targetMet: accounted + 0.05 >= plan.targetProteinG, createdAtUtc: plan.createdAtUtc, updatedAtUtc: plan.updatedAtUtc };
}

function consumedMovementMacros(db: DB, dateLocal: string) {
  return combineMacros(db.select().from(kitchenStockMovements).where(eq(kitchenStockMovements.dateLocal, dateLocal)).all()
    .filter((movement) => movement.reason === 'eaten' && !movement.reversedAtUtc)
    .map((movement) => snapshotMacros(movement)));
}

function consumedQuantitiesByFood(db: DB, dateLocal: string) {
  const quantities = new Map<string, number>();
  for (const movement of db.select().from(kitchenStockMovements).where(eq(kitchenStockMovements.dateLocal, dateLocal)).all()) {
    if (movement.reason !== 'eaten' || movement.reversedAtUtc) continue;
    quantities.set(movement.foodId, round((quantities.get(movement.foodId) ?? 0) + Math.abs(movement.deltaQuantity)));
  }
  return quantities;
}

function consumedPortionCountsByFood(db: DB, dateLocal: string) {
  const portionIdsByFood = new Map<string, Set<string>>();
  for (const movement of db.select().from(kitchenStockMovements).where(eq(kitchenStockMovements.dateLocal, dateLocal)).all()) {
    if (movement.reason !== 'eaten' || movement.reversedAtUtc || !movement.stockPortionId) continue;
    const ids = portionIdsByFood.get(movement.foodId) ?? new Set<string>();
    ids.add(movement.stockPortionId);
    portionIdsByFood.set(movement.foodId, ids);
  }
  return new Map([...portionIdsByFood].map(([foodId, ids]) => [foodId, ids.size]));
}

function manualConsumedProtein(db: DB, dateLocal: string) {
  return round(db.select().from(kitchenStockMovements).where(eq(kitchenStockMovements.dateLocal, dateLocal)).all()
    .filter((movement) => movement.reason === 'eaten' && movement.planLineId == null && !movement.reversedAtUtc)
    .reduce((sum, movement) => sum + movement.proteinG, 0));
}

export function generateKitchenPlan(db: DB, input: KitchenPlanGenerateInput, dateLocal: string): KitchenPlanDTO {
  const settings = getKitchenSettings(db);
  const now = nowUtcIso();
  let plan = db.select().from(kitchenPlans).where(eq(kitchenPlans.dateLocal, dateLocal)).get();
  const consumedToday = consumedMovementMacros(db, dateLocal).proteinG;
  const consumedQuantities = consumedQuantitiesByFood(db, dateLocal);
  const consumedPortionCounts = consumedPortionCountsByFood(db, dateLocal);
  const remainingTarget = Math.max(0, settings.dailyProteinTarget - consumedToday);
  const foods = listKitchenFoods(db, false, plan?.id);
  const excludedFoods = new Set(input.excludedFoodIds);
  const excludedStock = new Set(input.excludedStockIds);
  const missingDailyLimits = foods.filter((food) => food.plannerEligible
    && food.portionMode === 'splittable'
    && food.dailyMaxQuantity == null
    && !excludedFoods.has(food.id)
    && food.portions.some((portion) => portion.availableQuantity > EPSILON
      && !excludedStock.has(portion.id)
      && (!portion.expiresOn || portion.expiresOn >= dateLocal)));
  if (remainingTarget > EPSILON && missingDailyLimits.length > 0) {
    throw new KitchenError(`Set a daily planning limit for: ${missingDailyLimits.map((food) => food.name).join(', ')}`, 409);
  }
  const selections = remainingTarget > EPSILON
    ? optimizeKitchenPlan({ foods, portions: foods.flatMap((food) => food.portions.map((portion) => ({ id: portion.id, foodId: food.id, availableQuantity: portion.availableQuantity, expiresOn: portion.expiresOn, createdAtUtc: portion.createdAtUtc }))), targetProteinG: remainingTarget, dateLocal, initialQuantitiesByFood: consumedQuantities, initialPortionCountsByFood: consumedPortionCounts, pinnedStockIds: input.pinnedStockIds, excludedFoodIds: input.excludedFoodIds, excludedStockIds: input.excludedStockIds })
    : [];
  (db as any).transaction((tx: DB) => {
    if (!plan) {
      plan = { id: randomUUID(), dateLocal, targetProteinG: settings.dailyProteinTarget, status: 'draft', createdAtUtc: now, updatedAtUtc: now };
      tx.insert(kitchenPlans).values(plan!).run();
    } else {
      // A daily plan row is reused when reservations are regenerated. Keep
      // consumed history, but remove both the previous draft and any lines
      // cancelled with it so they cannot reappear beside the new reservation.
      tx.delete(kitchenPlanLines).where(and(
        eq(kitchenPlanLines.planId, plan.id),
        inArray(kitchenPlanLines.status, ['planned', 'cancelled']),
      )).run();
      tx.update(kitchenPlans).set({ targetProteinG: settings.dailyProteinTarget, status: 'draft', updatedAtUtc: now }).where(eq(kitchenPlans.id, plan.id)).run();
      plan = { ...plan, targetProteinG: settings.dailyProteinTarget, status: 'draft', updatedAtUtc: now };
    }
    if (remainingTarget > EPSILON) {
      for (const selection of selections) {
        tx.insert(kitchenPlanLines).values({ id: randomUUID(), planId: plan!.id, foodId: selection.foodId, stockPortionId: selection.stockPortionId, plannedQuantity: selection.quantity, actualQuantity: null, status: 'planned', proteinG: selection.macros.proteinG, caloriesKcal: selection.macros.caloriesKcal, carbsG: selection.macros.carbsG, fatG: selection.macros.fatG, createdAtUtc: now, consumedAtUtc: null }).run();
      }
    } else {
      tx.update(kitchenPlans).set({ status: 'completed', updatedAtUtc: now }).where(eq(kitchenPlans.id, plan!.id)).run();
      plan = { ...plan!, status: 'completed' };
    }
  });
  return planDTO(db, db.select().from(kitchenPlans).where(eq(kitchenPlans.id, plan!.id)).get()!, manualConsumedProtein(db, dateLocal));
}

export function addKitchenPlanLine(db: DB, input: KitchenPlanLineAddInput, dateLocal: string): KitchenPlanDTO {
  const portion = requirePortion(db, input.stockPortionId);
  const food = requireFood(db, portion.foodId);
  if (portion.status !== 'available' || portion.remainingQuantity <= EPSILON) throw new KitchenError('This stock portion is not available', 409);
  if (portion.expiresOn && portion.expiresOn < dateLocal) throw new KitchenError('Expired stock cannot be added to today’s plan', 409);

  const reserved = reservedQuantities(db).get(portion.id) ?? 0;
  const available = round(Math.max(0, portion.remainingQuantity - reserved));
  const quantity = round(input.quantity);
  if (quantity > available + EPSILON) throw new KitchenError(`Only ${available} ${food.unit} is available`, 409);

  const settings = getKitchenSettings(db);
  const now = nowUtcIso();
  const macros = macrosFor(food, quantity);
  let plan = db.select().from(kitchenPlans).where(eq(kitchenPlans.dateLocal, dateLocal)).get();
  (db as any).transaction((tx: DB) => {
    if (!plan) {
      plan = { id: randomUUID(), dateLocal, targetProteinG: settings.dailyProteinTarget, status: 'draft', createdAtUtc: now, updatedAtUtc: now };
      tx.insert(kitchenPlans).values(plan!).run();
    } else {
      tx.update(kitchenPlans).set({ targetProteinG: settings.dailyProteinTarget, status: 'draft', updatedAtUtc: now }).where(eq(kitchenPlans.id, plan.id)).run();
      plan = { ...plan, targetProteinG: settings.dailyProteinTarget, status: 'draft', updatedAtUtc: now };
    }
    tx.insert(kitchenPlanLines).values({ id: randomUUID(), planId: plan!.id, foodId: food.id, stockPortionId: portion.id, plannedQuantity: quantity, actualQuantity: null, status: 'planned', proteinG: macros.proteinG, caloriesKcal: macros.caloriesKcal, carbsG: macros.carbsG, fatG: macros.fatG, createdAtUtc: now, consumedAtUtc: null }).run();
  });
  return planDTO(db, plan!, manualConsumedProtein(db, dateLocal));
}

export function removeKitchenPlanLine(db: DB, planId: string, lineId: string): KitchenPlanDTO {
  const plan = db.select().from(kitchenPlans).where(eq(kitchenPlans.id, planId)).get();
  const line = db.select().from(kitchenPlanLines).where(eq(kitchenPlanLines.id, lineId)).get();
  if (!plan || !line || line.planId !== planId) throw new KitchenError('Plan line not found', 404);
  if (line.status !== 'planned') throw new KitchenError('Only unconsumed plan items can be removed', 409);
  const now = nowUtcIso();
  (db as any).transaction((tx: DB) => {
    tx.delete(kitchenPlanLines).where(eq(kitchenPlanLines.id, lineId)).run();
    tx.update(kitchenPlans).set({ status: 'draft', updatedAtUtc: now }).where(eq(kitchenPlans.id, planId)).run();
  });
  return planDTO(db, { ...plan, status: 'draft', updatedAtUtc: now }, manualConsumedProtein(db, plan.dateLocal));
}

export function consumeKitchenPlanLine(db: DB, planId: string, lineId: string, actualQuantity?: number): KitchenPlanDTO {
  const plan = db.select().from(kitchenPlans).where(eq(kitchenPlans.id, planId)).get();
  const line = db.select().from(kitchenPlanLines).where(eq(kitchenPlanLines.id, lineId)).get();
  if (!line || line.planId !== planId) throw new KitchenError('Plan line not found', 404);
  if (!plan) throw new KitchenError('Active kitchen plan not found', 404);
  if (line.status === 'consumed') return planDTO(db, plan, manualConsumedProtein(db, plan.dateLocal));
  if (plan.status !== 'draft') throw new KitchenError('Active kitchen plan not found', 404);
  if (line.status !== 'planned') throw new KitchenError('Only planned portions can be consumed', 409);
  const portion = requirePortion(db, line.stockPortionId);
  const food = requireFood(db, line.foodId);
  const quantity = round(actualQuantity ?? line.plannedQuantity);
  const otherReserved = (reservedQuantities(db, planId).get(portion.id) ?? 0);
  if (quantity <= 0 || quantity > portion.remainingQuantity - otherReserved + EPSILON) throw new KitchenError('Actual quantity exceeds unreserved stock', 409);
  const macros = macrosFor(food, quantity);
  const now = nowUtcIso();
  (db as any).transaction((tx: DB) => {
    const next = round(Math.max(0, portion.remainingQuantity - quantity));
    tx.update(kitchenStockPortions).set({ remainingQuantity: next, status: next <= EPSILON ? 'empty' : 'available', updatedAtUtc: now }).where(eq(kitchenStockPortions.id, portion.id)).run();
    tx.update(kitchenPlanLines).set({ plannedQuantity: quantity, actualQuantity: quantity, status: 'consumed', proteinG: macros.proteinG, caloriesKcal: macros.caloriesKcal, carbsG: macros.carbsG, fatG: macros.fatG, consumedAtUtc: now }).where(eq(kitchenPlanLines.id, line.id)).run();
    tx.insert(kitchenStockMovements).values({ id: randomUUID(), foodId: food.id, stockPortionId: portion.id, planLineId: line.id, deltaQuantity: -quantity, reason: 'eaten', dateLocal: plan.dateLocal, note: 'Consumed from daily protein plan', proteinG: macros.proteinG, caloriesKcal: macros.caloriesKcal, carbsG: macros.carbsG, fatG: macros.fatG, reversalOfId: null, reversedAtUtc: null, createdAtUtc: now }).run();
    const outstanding = tx.select().from(kitchenPlanLines).where(and(eq(kitchenPlanLines.planId, plan.id), eq(kitchenPlanLines.status, 'planned'))).all().filter((item) => item.id !== line.id);
    if (outstanding.length === 0) tx.update(kitchenPlans).set({ status: 'completed', updatedAtUtc: now }).where(eq(kitchenPlans.id, plan.id)).run();
  });
  return planDTO(db, db.select().from(kitchenPlans).where(eq(kitchenPlans.id, plan.id)).get()!, manualConsumedProtein(db, plan.dateLocal));
}

export function undoKitchenPlanLine(db: DB, planId: string, lineId: string): KitchenPlanDTO {
  const plan = db.select().from(kitchenPlans).where(eq(kitchenPlans.id, planId)).get();
  const line = db.select().from(kitchenPlanLines).where(eq(kitchenPlanLines.id, lineId)).get();
  if (!plan || !line || line.planId !== planId) throw new KitchenError('Consumed plan line not found', 404);
  if (line.status !== 'consumed' || line.actualQuantity == null) throw new KitchenError('This line has not been consumed', 409);
  const movement = db.select().from(kitchenStockMovements).all().find((item) => item.planLineId === line.id && item.reason === 'eaten' && !item.reversedAtUtc);
  if (!movement) throw new KitchenError('Consumption has already been undone', 409);
  const portion = requirePortion(db, line.stockPortionId);
  const now = nowUtcIso();
  (db as any).transaction((tx: DB) => {
    tx.update(kitchenStockPortions).set({ remainingQuantity: round(portion.remainingQuantity + line.actualQuantity!), status: 'available', updatedAtUtc: now }).where(eq(kitchenStockPortions.id, portion.id)).run();
    tx.update(kitchenPlanLines).set({ status: 'planned', actualQuantity: null, consumedAtUtc: null }).where(eq(kitchenPlanLines.id, line.id)).run();
    tx.update(kitchenStockMovements).set({ reversedAtUtc: now }).where(eq(kitchenStockMovements.id, movement.id)).run();
    tx.insert(kitchenStockMovements).values({ id: randomUUID(), foodId: line.foodId, stockPortionId: line.stockPortionId, planLineId: line.id, deltaQuantity: line.actualQuantity!, reason: 'restored', dateLocal: plan.dateLocal, note: 'Undo plan consumption', proteinG: movement.proteinG, caloriesKcal: movement.caloriesKcal, carbsG: movement.carbsG, fatG: movement.fatG, reversalOfId: movement.id, reversedAtUtc: null, createdAtUtc: now }).run();
    tx.update(kitchenPlans).set({ status: 'draft', updatedAtUtc: now }).where(eq(kitchenPlans.id, plan.id)).run();
  });
  return planDTO(db, db.select().from(kitchenPlans).where(eq(kitchenPlans.id, plan.id)).get()!, manualConsumedProtein(db, plan.dateLocal));
}

export function cancelKitchenPlan(db: DB, planId: string): KitchenPlanDTO {
  const plan = db.select().from(kitchenPlans).where(eq(kitchenPlans.id, planId)).get();
  if (!plan) throw new KitchenError('Kitchen plan not found', 404);
  const now = nowUtcIso();
  (db as any).transaction((tx: DB) => {
    tx.update(kitchenPlanLines).set({ status: 'cancelled' }).where(and(eq(kitchenPlanLines.planId, planId), eq(kitchenPlanLines.status, 'planned'))).run();
    tx.update(kitchenPlans).set({ status: 'cancelled', updatedAtUtc: now }).where(eq(kitchenPlans.id, planId)).run();
  });
  return planDTO(db, db.select().from(kitchenPlans).where(eq(kitchenPlans.id, planId)).get()!, manualConsumedProtein(db, plan.dateLocal));
}

export function undoKitchenMovement(db: DB, movementId: string): KitchenStockMovementDTO {
  const movement = db.select().from(kitchenStockMovements).where(eq(kitchenStockMovements.id, movementId)).get();
  if (!movement) throw new KitchenError('Stock movement not found', 404);
  if (movement.reversedAtUtc) throw new KitchenError('This stock movement has already been undone', 409);
  if (movement.planLineId) throw new KitchenError('Undo this movement from its daily plan line', 409);
  const portion = requirePortion(db, movement.stockPortionId);
  const inverse = -movement.deltaQuantity;
  const next = round(portion.remainingQuantity + inverse);
  const reserved = reservedQuantities(db).get(portion.id) ?? 0;
  if (next < reserved - EPSILON || next < -EPSILON) throw new KitchenError('Undo would remove stock that is no longer available', 409);
  const now = nowUtcIso();
  const reversalId = randomUUID();
  (db as any).transaction((tx: DB) => {
    tx.update(kitchenStockPortions).set({ remainingQuantity: Math.max(0, next), status: next <= EPSILON ? 'empty' : 'available', updatedAtUtc: now }).where(eq(kitchenStockPortions.id, portion.id)).run();
    tx.update(kitchenStockMovements).set({ reversedAtUtc: now }).where(eq(kitchenStockMovements.id, movement.id)).run();
    tx.insert(kitchenStockMovements).values({ id: reversalId, foodId: movement.foodId, stockPortionId: movement.stockPortionId, planLineId: null, deltaQuantity: inverse, reason: 'restored', dateLocal: movement.dateLocal, note: `Undo ${movement.reason}`, proteinG: movement.proteinG, caloriesKcal: movement.caloriesKcal, carbsG: movement.carbsG, fatG: movement.fatG, reversalOfId: movement.id, reversedAtUtc: null, createdAtUtc: now }).run();
  });
  return movementDTO(db.select().from(kitchenStockMovements).where(eq(kitchenStockMovements.id, reversalId)).get()!);
}

function movementDTO(row: typeof kitchenStockMovements.$inferSelect): KitchenStockMovementDTO {
  return { id: row.id, foodId: row.foodId, stockPortionId: row.stockPortionId, planLineId: row.planLineId, deltaQuantity: row.deltaQuantity, reason: row.reason as KitchenStockMovementDTO['reason'], dateLocal: row.dateLocal, note: row.note, macros: snapshotMacros(row), reversedAtUtc: row.reversedAtUtc, createdAtUtc: row.createdAtUtc };
}

function buildForecast(dateLocal: string, settings: KitchenSettingsDTO, foods: KitchenFoodDTO[], consumedToday: number, consumedQuantities: ReadonlyMap<string, number>, consumedPortionCounts: ReadonlyMap<string, number>, plan: KitchenPlanDTO | null): KitchenForecastDTO {
  const plannerFoods: PlannerFood[] = foods;
  const virtual = foods.flatMap((food) => food.portions.filter((portion) => portion.availableQuantity > EPSILON).map((portion) => ({ id: portion.id, foodId: food.id, availableQuantity: portion.availableQuantity, expiresOn: portion.expiresOn, createdAtUtc: portion.createdAtUtc })));
  const depletion = new Map<string, string>();
  let fullTargetDays = 0;
  let firstMissDate: string | null = null;
  for (let offset = 0; offset < settings.forecastDays; offset += 1) {
    const day = DateTime.fromISO(dateLocal).plus({ days: offset }).toISODate()!;
    const alreadyCovered = offset === 0 ? consumedToday + (plan?.plannedMacros.proteinG ?? 0) : 0;
    const target = Math.max(0, settings.dailyProteinTarget - alreadyCovered);
    const initialQuantities = offset === 0 ? new Map(consumedQuantities) : undefined;
    const initialCounts = offset === 0 ? new Map(consumedPortionCounts) : undefined;
    if (initialQuantities && plan) {
      for (const line of plan.lines) {
        if (line.status !== 'planned') continue;
        initialQuantities.set(line.foodId, round((initialQuantities.get(line.foodId) ?? 0) + line.plannedQuantity));
        initialCounts!.set(line.foodId, (initialCounts!.get(line.foodId) ?? 0) + 1);
      }
    }
    const selections = target <= EPSILON ? [] : optimizeKitchenPlan({ foods: plannerFoods, portions: virtual, targetProteinG: target, dateLocal: day, initialQuantitiesByFood: initialQuantities, initialPortionCountsByFood: initialCounts, preferLargestPortions: true });
    const supplied = selections.reduce((sum, selection) => sum + selection.macros.proteinG, 0);
    if (alreadyCovered + supplied + 0.05 < settings.dailyProteinTarget) {
      firstMissDate = day;
      break;
    }
    fullTargetDays += 1;
    for (const selection of selections) {
      const portion = virtual.find((item) => item.id === selection.stockPortionId)!;
      portion.availableQuantity = round(Math.max(0, portion.availableQuantity - selection.quantity));
      if (portion.availableQuantity <= EPSILON && !depletion.has(selection.foodId)) {
        const anyLeft = virtual.some((item) => item.foodId === selection.foodId && item.availableQuantity > EPSILON);
        if (!anyLeft) depletion.set(selection.foodId, day);
      }
    }
  }
  return {
    horizonDays: settings.forecastDays,
    fullTargetDays,
    firstMissDate,
    runOutDate: firstMissDate,
    coversHorizon: fullTargetDays >= settings.forecastDays,
    perFood: foods.map((food) => ({ foodId: food.id, foodName: food.name, projectedDepletionDate: depletion.get(food.id) ?? null, remainingAfterForecast: round(virtual.filter((portion) => portion.foodId === food.id).reduce((sum, portion) => sum + portion.availableQuantity, 0)) })),
  };
}

export function getKitchenDashboard(db: DB, dateLocal: string): KitchenDashboardDTO {
  const settings = getKitchenSettings(db);
  const foods = listKitchenFoods(db);
  const consumedTodayMacros = consumedMovementMacros(db, dateLocal);
  const consumedQuantities = consumedQuantitiesByFood(db, dateLocal);
  const planRow = db.select().from(kitchenPlans).where(eq(kitchenPlans.dateLocal, dateLocal)).get();
  // A cancelled plan represents released reservations, not an active plan for
  // the day. Returning null restores the normal "No plan" state immediately.
  const plan = planRow && planRow.status !== 'cancelled'
    ? planDTO(db, planRow, manualConsumedProtein(db, dateLocal))
    : null;
  const forecast = buildForecast(dateLocal, settings, foods, consumedTodayMacros.proteinG, consumedQuantities, consumedPortionCountsByFood(db, dateLocal), plan);
  const alerts: KitchenAlertDTO[] = [];
  if (forecast.fullTargetDays < settings.warningCoverageDays) alerts.push({ id: 'coverage', severity: forecast.fullTargetDays === 0 ? 'critical' : 'warning', kind: 'coverage', title: 'Protein stock is running low', detail: `Current stock covers ${forecast.fullTargetDays} full target day${forecast.fullTargetDays === 1 ? '' : 's'}.`, foodId: null });
  for (const food of foods) {
    if (food.lowStock) alerts.push({ id: `low:${food.id}`, severity: food.availableQuantity <= EPSILON ? 'critical' : 'warning', kind: 'low_food', title: `${food.name} is near empty`, detail: `${round(food.availableQuantity, 1)} ${food.unit} available; threshold ${food.lowStockThreshold} ${food.unit}.`, foodId: food.id });
    const expired = food.portions.filter((portion) => portion.remainingQuantity > EPSILON && portion.expiresOn && portion.expiresOn < dateLocal);
    if (expired.length) alerts.push({ id: `expired:${food.id}`, severity: 'warning', kind: 'expired', title: `${food.name} has expired stock`, detail: `${expired.length} portion${expired.length === 1 ? '' : 's'} excluded from planning.`, foodId: food.id });
  }
  if (plan && !plan.targetMet && plan.lines.some((line) => line.status === 'planned')) alerts.push({ id: `plan:${plan.id}`, severity: 'warning', kind: 'insufficient_plan', title: 'Today’s plan is short', detail: `${round(plan.proteinGapG, 1)} g protein remains uncovered.`, foodId: null });
  const movements = db.select().from(kitchenStockMovements).orderBy(desc(kitchenStockMovements.createdAtUtc)).limit(30).all().map(movementDTO);
  const stockMacros = combineMacros(foods.map((food) => food.macrosRemaining));
  const reservedProteinG = round(foods.reduce((sum, food) => sum + macrosFor(food, food.reservedQuantity).proteinG, 0));
  return { dateLocal, settings, foods, plan, movements, stockMacros, consumedTodayMacros, reservedProteinG, forecast, alerts };
}

export function getKitchenStatus(db: DB, dateLocal: string): KitchenStatusDTO {
  const dashboard = getKitchenDashboard(db, dateLocal);
  return { alertCount: dashboard.alerts.length, criticalCount: dashboard.alerts.filter((alert) => alert.severity === 'critical').length, coverageDays: dashboard.forecast.fullTargetDays, runOutDate: dashboard.forecast.runOutDate, targetProteinG: dashboard.settings.dailyProteinTarget };
}
