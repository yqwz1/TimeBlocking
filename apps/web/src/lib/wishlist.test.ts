import { describe, expect, it } from 'vitest';
import type { WishlistItemDTO, WishlistSummaryDTO } from '@timeblock/shared';
import { currencyDigits, formatMoney, itemBudgetFit, majorToMinor, minorToMajor } from './wishlist.js';

const summary: WishlistSummaryDTO = { month: '2026-08', currency: 'SAR', budgetMinor: 100_000, actualMinor: 20_000, plannedMinor: 20_000, committedMinor: 40_000, remainingMinor: 60_000, activeValueMinor: 0, missingPriceCount: 0, byCategory: [], verdictCounts: [], monthly: [] };
const item = (priceMinor: number | null): WishlistItemDTO => ({ id: '1', title: 'Wish', notes: '', productUrl: null, imageUrl: null, uploadedImage: false, retailer: null, category: 'Other', priority: 1, status: 'considering', priceMinor, targetDate: null, goalIds: [], purchasedAt: null, actualPriceMinor: null, advice: null, createdAtUtc: '', updatedAtUtc: '' });

describe('wishlist money helpers', () => {
  it('round-trips major and minor currency units', () => {
    expect(currencyDigits('SAR')).toBe(2);
    expect(majorToMinor('123.45', 'SAR')).toBe(12_345);
    expect(minorToMajor(12_345, 'SAR')).toBe('123.45');
    expect(formatMoney(12_345, 'SAR')).toContain('123.45');
  });

  it('respects zero-decimal currencies', () => {
    expect(currencyDigits('JPY')).toBe(0);
    expect(majorToMinor('500', 'JPY')).toBe(500);
  });

  it('matches budget-fit thresholds used by the server', () => {
    expect(itemBudgetFit(item(null), summary)).toBe('needs_data');
    expect(itemBudgetFit(item(70_000), summary)).toBe('over_budget');
    expect(itemBudgetFit(item(45_000), summary)).toBe('tight');
    expect(itemBudgetFit(item(20_000), summary)).toBe('fits');
  });
});
