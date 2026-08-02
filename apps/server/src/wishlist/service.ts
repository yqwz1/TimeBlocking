import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import { eq } from 'drizzle-orm';
import type {
  WishlistAdviceDTO,
  WishlistBudgetFit,
  WishlistItemDTO,
  WishlistSummaryDTO,
  WishlistVerdict,
} from '@timeblock/shared';
import type { DB } from '../db/client.js';
import { goals, settings, wishlistBudgets, wishlistItems } from '../db/schema.js';
import { getSettings } from '../settings.js';

export type WishlistRow = typeof wishlistItems.$inferSelect;

function jsonArray(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function getWishlistCurrency(db: DB): string {
  const value = db.select().from(settings).where(eq(settings.key, 'wishlist.currency')).get()?.value?.toUpperCase();
  return value && /^[A-Z]{3}$/.test(value) ? value : 'SAR';
}

export function setWishlistCurrency(db: DB, currency: string): void {
  db.insert(settings)
    .values({ key: 'wishlist.currency', value: currency })
    .onConflictDoUpdate({ target: settings.key, set: { value: currency } })
    .run();
}

function adviceCore(row: WishlistRow): Omit<WishlistAdviceDTO, 'analyzedAtUtc' | 'inputHash' | 'stale'> | null {
  if (!row.advice) return null;
  try {
    const value = JSON.parse(row.advice) as Record<string, unknown>;
    if (!['buy_now', 'wait', 'skip'].includes(String(value.verdict))) return null;
    return {
      verdict: value.verdict as WishlistVerdict,
      score: Math.max(0, Math.min(100, Number(value.score) || 0)),
      summary: String(value.summary ?? ''),
      benefits: Array.isArray(value.benefits) ? value.benefits.map(String).slice(0, 4) : [],
      risks: Array.isArray(value.risks) ? value.risks.map(String).slice(0, 4) : [],
      suggestedGoalIds: Array.isArray(value.suggestedGoalIds) ? value.suggestedGoalIds.map(String).slice(0, 20) : [],
      reviewDate: typeof value.reviewDate === 'string' ? value.reviewDate : null,
    };
  } catch {
    return null;
  }
}

export function wishlistAdviceHash(db: DB, row: WishlistRow): string {
  const timezone = getSettings(db).timezone;
  const month = row.targetDate?.slice(0, 7) ?? DateTime.now().setZone(timezone).toFormat('yyyy-MM');
  const budget = db.select().from(wishlistBudgets).where(eq(wishlistBudgets.month, month)).get()?.amountMinor ?? 0;
  const activeGoals = db
    .select()
    .from(goals)
    .where(eq(goals.status, 'active'))
    .all()
    .map((goal) => ({ id: goal.id, title: goal.title, relevance: goal.relevance, deadline: goal.customDeadline, currentValue: goal.currentValue }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256')
    .update(JSON.stringify({
      title: row.title,
      notes: row.notes,
      category: row.category,
      priority: row.priority,
      priceMinor: row.priceMinor,
      status: row.status,
      targetDate: row.targetDate,
      goalIds: jsonArray(row.goalIds).sort(),
      month,
      budget,
      currency: getWishlistCurrency(db),
      activeGoals,
    }))
    .digest('hex');
}

export function wishlistItemToDTO(db: DB, row: WishlistRow): WishlistItemDTO {
  const core = adviceCore(row);
  const currentHash = wishlistAdviceHash(db, row);
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    productUrl: row.productUrl,
    imageUrl: row.imageFileName ? `/api/wishlist/items/${row.id}/image` : row.imageUrl,
    uploadedImage: !!row.imageFileName,
    retailer: row.retailer,
    category: row.category,
    priority: row.priority,
    status: row.status as WishlistItemDTO['status'],
    priceMinor: row.priceMinor,
    targetDate: row.targetDate,
    goalIds: jsonArray(row.goalIds),
    purchasedAt: row.purchasedAt,
    actualPriceMinor: row.actualPriceMinor,
    advice: core && row.adviceAnalyzedAtUtc && row.adviceInputHash
      ? { ...core, analyzedAtUtc: row.adviceAnalyzedAtUtc, inputHash: row.adviceInputHash, stale: row.adviceInputHash !== currentHash }
      : null,
    createdAtUtc: row.createdAtUtc,
    updatedAtUtc: row.updatedAtUtc,
  };
}

function monthWindow(month: string): string[] {
  const center = DateTime.fromFormat(month, 'yyyy-MM');
  return Array.from({ length: 6 }, (_, index) => center.minus({ months: 3 }).plus({ months: index }).toFormat('yyyy-MM'));
}

export function buildWishlistSummary(db: DB, month: string): WishlistSummaryDTO {
  const rows = db.select().from(wishlistItems).all();
  const budgets = db.select().from(wishlistBudgets).all();
  const budgetMap = new Map(budgets.map((budget) => [budget.month, budget.amountMinor]));
  const budgetMinor = budgetMap.get(month) ?? 0;
  const actualMinor = rows
    .filter((row) => row.status === 'purchased' && row.purchasedAt?.slice(0, 7) === month)
    .reduce((sum, row) => sum + (row.actualPriceMinor ?? row.priceMinor ?? 0), 0);
  const plannedMinor = rows
    .filter((row) => row.status === 'planned' && row.targetDate?.slice(0, 7) === month)
    .reduce((sum, row) => sum + (row.priceMinor ?? 0), 0);
  const active = rows.filter((row) => row.status === 'considering' || row.status === 'planned');
  const activeValueMinor = active.reduce((sum, row) => sum + (row.priceMinor ?? 0), 0);
  const categoryMap = new Map<string, { valueMinor: number; count: number }>();
  for (const row of active) {
    const value = categoryMap.get(row.category) ?? { valueMinor: 0, count: 0 };
    value.valueMinor += row.priceMinor ?? 0;
    value.count += 1;
    categoryMap.set(row.category, value);
  }
  const verdictMap = new Map<WishlistVerdict | 'not_analyzed', number>();
  for (const row of active) {
    const verdict = adviceCore(row)?.verdict ?? 'not_analyzed';
    verdictMap.set(verdict, (verdictMap.get(verdict) ?? 0) + 1);
  }
  return {
    month,
    currency: getWishlistCurrency(db),
    budgetMinor,
    actualMinor,
    plannedMinor,
    committedMinor: actualMinor + plannedMinor,
    remainingMinor: budgetMinor - actualMinor - plannedMinor,
    activeValueMinor,
    missingPriceCount: active.filter((row) => row.priceMinor == null).length,
    byCategory: [...categoryMap.entries()]
      .map(([category, value]) => ({ category, ...value }))
      .sort((a, b) => b.valueMinor - a.valueMinor),
    verdictCounts: [...verdictMap.entries()].map(([verdict, count]) => ({ verdict, count })),
    monthly: monthWindow(month).map((candidate) => ({
      month: candidate,
      budgetMinor: budgetMap.get(candidate) ?? 0,
      actualMinor: rows
        .filter((row) => row.status === 'purchased' && row.purchasedAt?.slice(0, 7) === candidate)
        .reduce((sum, row) => sum + (row.actualPriceMinor ?? row.priceMinor ?? 0), 0),
      plannedMinor: rows
        .filter((row) => row.status === 'planned' && row.targetDate?.slice(0, 7) === candidate)
        .reduce((sum, row) => sum + (row.priceMinor ?? 0), 0),
    })),
  };
}

export function wishlistBudgetFit(item: Pick<WishlistRow, 'id' | 'priceMinor' | 'status' | 'targetDate'>, summary: WishlistSummaryDTO): WishlistBudgetFit {
  if (item.priceMinor == null || summary.budgetMinor <= 0) return 'needs_data';
  const included = item.status === 'planned' && item.targetDate?.slice(0, 7) === summary.month ? item.priceMinor : 0;
  const availableBeforeItem = summary.budgetMinor - summary.actualMinor - summary.plannedMinor + included;
  if (item.priceMinor > availableBeforeItem) return 'over_budget';
  if (availableBeforeItem - item.priceMinor < summary.budgetMinor * 0.2) return 'tight';
  return 'fits';
}
