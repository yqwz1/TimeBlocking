import type { WishlistBudgetFit, WishlistItemDTO, WishlistSummaryDTO } from '@timeblock/shared';

export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function majorToMinor(value: string | number, currency: string): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 10 ** currencyDigits(currency)) : null;
}

export function minorToMajor(value: number | null, currency: string): string {
  return value == null ? '' : String(value / 10 ** currencyDigits(currency));
}

export function formatMoney(valueMinor: number, currency: string, compact = false): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : currencyDigits(currency),
    }).format(valueMinor / 10 ** currencyDigits(currency));
  } catch {
    return `${(valueMinor / 100).toFixed(2)} ${currency}`;
  }
}

export function itemBudgetFit(item: WishlistItemDTO, summary: WishlistSummaryDTO): WishlistBudgetFit {
  if (item.priceMinor == null || summary.budgetMinor <= 0) return 'needs_data';
  const included = item.status === 'planned' && item.targetDate?.slice(0, 7) === summary.month ? item.priceMinor : 0;
  const availableBeforeItem = summary.budgetMinor - summary.actualMinor - summary.plannedMinor + included;
  if (item.priceMinor > availableBeforeItem) return 'over_budget';
  return availableBeforeItem - item.priceMinor < summary.budgetMinor * 0.2 ? 'tight' : 'fits';
}

export const WISHLIST_CATEGORIES = ['Games', 'Products', 'Electronics', 'Books', 'Home', 'Fashion', 'Health', 'Subscriptions', 'Experiences', 'Gifts', 'Other'];
