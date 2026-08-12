import { z } from 'zod';

const finiteQuantity = z.number().finite().positive().max(1_000_000);
const optionalMacro = z.number().finite().nonnegative().max(1_000_000).nullable().default(null);

export const KitchenQuantityUnitSchema = z.enum(['g', 'ml', 'unit', 'scoop']);
export type KitchenQuantityUnit = z.infer<typeof KitchenQuantityUnitSchema>;

export const KitchenPreparationStateSchema = z.enum(['raw', 'cooked', 'as_packaged']);
export type KitchenPreparationState = z.infer<typeof KitchenPreparationStateSchema>;

export const KitchenPortionModeSchema = z.enum(['whole', 'splittable']);
export type KitchenPortionMode = z.infer<typeof KitchenPortionModeSchema>;

export const KitchenFoodInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(80).default('Protein'),
  unit: KitchenQuantityUnitSchema,
  preparationState: KitchenPreparationStateSchema.default('as_packaged'),
  nutritionBasisAmount: finiteQuantity.default(100),
  proteinPerBasis: finiteQuantity,
  caloriesPerBasis: optionalMacro,
  carbsPerBasis: optionalMacro,
  fatPerBasis: optionalMacro,
  portionMode: KitchenPortionModeSchema.default('whole'),
  planningIncrement: finiteQuantity.nullable().default(null),
  dailyMaxQuantity: finiteQuantity.nullable().default(null),
  dailyMaxPortions: z.number().int().positive().max(100).nullable().default(null),
  lowStockThreshold: z.number().finite().nonnegative().max(1_000_000).nullable().default(null),
  plannerEligible: z.boolean().default(true),
}).superRefine((value, ctx) => {
  if (value.portionMode === 'splittable' && value.planningIncrement == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['planningIncrement'], message: 'Splittable foods require a planning increment' });
  }
  if (value.plannerEligible && value.portionMode === 'splittable' && value.dailyMaxQuantity == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dailyMaxQuantity'], message: 'Splittable foods used in plans require a daily planning limit' });
  }
  if (value.planningIncrement != null && value.dailyMaxQuantity != null && value.dailyMaxQuantity < value.planningIncrement) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dailyMaxQuantity'], message: 'Daily planning limit must be at least one planning increment' });
  }
});
export type KitchenFoodInput = z.infer<typeof KitchenFoodInputSchema>;

export const KitchenFoodPatchSchema = KitchenFoodInputSchema.innerType().partial();
export type KitchenFoodPatch = z.infer<typeof KitchenFoodPatchSchema>;

export const KitchenStockAddSchema = z.object({
  portions: z.array(z.object({
    amount: finiteQuantity,
    label: z.string().trim().max(120).nullable().default(null),
    expiresOn: z.string().date().nullable().default(null),
  })).min(1).max(200),
});
export type KitchenStockAddInput = z.infer<typeof KitchenStockAddSchema>;

export const KitchenStockAdjustmentReasonSchema = z.enum(['eaten', 'correction', 'discarded', 'restored']);
export type KitchenStockAdjustmentReason = z.infer<typeof KitchenStockAdjustmentReasonSchema>;

export const KitchenStockAdjustmentSchema = z.object({
  deltaQuantity: z.number().finite().min(-1_000_000).max(1_000_000).refine((value) => value !== 0, 'Adjustment cannot be zero'),
  reason: KitchenStockAdjustmentReasonSchema,
  dateLocal: z.string().date().optional(),
  note: z.string().trim().max(500).default(''),
});
export type KitchenStockAdjustmentInput = z.infer<typeof KitchenStockAdjustmentSchema>;

export const KitchenSettingsInputSchema = z.object({
  dailyProteinTarget: z.number().finite().positive().max(1_000),
  dailyCaloriesTarget: z.number().finite().positive().max(20_000).default(2_500),
  dailyCarbsTarget: z.number().finite().nonnegative().max(2_000).default(325),
  warningCoverageDays: z.number().int().min(1).max(90),
  forecastDays: z.number().int().min(7).max(90),
});
export type KitchenSettingsInput = z.infer<typeof KitchenSettingsInputSchema>;

export const KitchenPlanGenerateSchema = z.object({
  dateLocal: z.string().date().optional(),
  pinnedStockIds: z.array(z.string().min(1)).max(200).default([]),
  excludedFoodIds: z.array(z.string().min(1)).max(200).default([]),
  excludedStockIds: z.array(z.string().min(1)).max(500).default([]),
});
export type KitchenPlanGenerateInput = z.infer<typeof KitchenPlanGenerateSchema>;

export const KitchenPlanLineAddSchema = z.object({
  dateLocal: z.string().date().optional(),
  stockPortionId: z.string().min(1),
  quantity: finiteQuantity,
});
export type KitchenPlanLineAddInput = z.infer<typeof KitchenPlanLineAddSchema>;

export const KitchenPlanConsumeSchema = z.object({
  actualQuantity: finiteQuantity.optional(),
});
export type KitchenPlanConsumeInput = z.infer<typeof KitchenPlanConsumeSchema>;

export interface KitchenMacroTotals {
  proteinG: number;
  caloriesKcal: number | null;
  carbsG: number | null;
  fatG: number | null;
  incompleteFields: Array<'calories' | 'carbs' | 'fat'>;
}

export interface KitchenSettingsDTO extends KitchenSettingsInput {
  updatedAtUtc: string | null;
}

export interface KitchenStockPortionDTO {
  id: string;
  foodId: string;
  label: string | null;
  originalQuantity: number;
  remainingQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  expiresOn: string | null;
  status: 'available' | 'empty' | 'discarded';
  macrosRemaining: KitchenMacroTotals;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface KitchenFoodDTO extends KitchenFoodInput {
  id: string;
  archived: boolean;
  portions: KitchenStockPortionDTO[];
  stockQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  macrosRemaining: KitchenMacroTotals;
  lowStock: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface KitchenStockMovementDTO {
  id: string;
  foodId: string;
  stockPortionId: string;
  planLineId: string | null;
  deltaQuantity: number;
  reason: 'stocked' | KitchenStockAdjustmentReason;
  dateLocal: string;
  note: string;
  macros: KitchenMacroTotals;
  reversedAtUtc: string | null;
  createdAtUtc: string;
}

export interface KitchenPlanLineDTO {
  id: string;
  planId: string;
  foodId: string;
  foodName: string;
  stockPortionId: string;
  stockLabel: string | null;
  unit: KitchenQuantityUnit;
  plannedQuantity: number;
  actualQuantity: number | null;
  status: 'planned' | 'consumed' | 'cancelled';
  macros: KitchenMacroTotals;
  expiresOn: string | null;
  createdAtUtc: string;
  consumedAtUtc: string | null;
}

export interface KitchenPlanDTO {
  id: string;
  dateLocal: string;
  targetProteinG: number;
  status: 'draft' | 'completed' | 'cancelled';
  lines: KitchenPlanLineDTO[];
  plannedMacros: KitchenMacroTotals;
  consumedMacros: KitchenMacroTotals;
  proteinGapG: number;
  targetMet: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface KitchenFoodForecastDTO {
  foodId: string;
  foodName: string;
  projectedDepletionDate: string | null;
  remainingAfterForecast: number;
}

export interface KitchenForecastDTO {
  horizonDays: number;
  fullTargetDays: number;
  firstMissDate: string | null;
  runOutDate: string | null;
  coversHorizon: boolean;
  perFood: KitchenFoodForecastDTO[];
}

export interface KitchenAlertDTO {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  kind: 'coverage' | 'low_food' | 'expired' | 'insufficient_plan';
  title: string;
  detail: string;
  foodId: string | null;
}

export interface KitchenDashboardDTO {
  dateLocal: string;
  settings: KitchenSettingsDTO;
  foods: KitchenFoodDTO[];
  plan: KitchenPlanDTO | null;
  movements: KitchenStockMovementDTO[];
  stockMacros: KitchenMacroTotals;
  consumedTodayMacros: KitchenMacroTotals;
  reservedProteinG: number;
  forecast: KitchenForecastDTO;
  alerts: KitchenAlertDTO[];
}

export interface KitchenStatusDTO {
  alertCount: number;
  criticalCount: number;
  coverageDays: number;
  runOutDate: string | null;
  targetProteinG: number;
}

export type KitchenDealQuality = 'discount' | 'good' | 'excellent';

export interface KitchenDealDTO {
  id: string;
  sourceOfferId: string;
  category: string;
  description: string;
  store: string;
  location: string;
  priceSar: number;
  previousPriceSar: number;
  discountPct: number;
  quality: KitchenDealQuality;
  validFrom: string | null;
  validTo: string | null;
  imageUrl: string | null;
  sourceUrl: string;
}

export interface KitchenDealsDTO {
  source: 'D4D Online';
  location: string;
  regionCode: string;
  dateLocal: string;
  refreshedAtUtc: string | null;
  stale: boolean;
  lastError: string | null;
  deals: KitchenDealDTO[];
}
