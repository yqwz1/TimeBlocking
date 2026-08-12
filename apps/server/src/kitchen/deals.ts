import { createHash } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { KitchenDealDTO, KitchenDealsDTO, KitchenDealQuality } from '@timeblock/shared';
import type { DB } from '../db/client.js';
import { kitchenDeals, kitchenDealSync } from '../db/schema.js';

export const D4D_PRODUCTS_PAGE = 'https://d4donline.com/ar/saudi-arabia/mecca/products';
const D4D_SEARCH_URL = 'https://d4donline.com/products/search';
const D4D_CDN = 'https://cdn.d4donline.com';
const LOCATION = 'Mecca';
const REGION_FALLBACK = 'SAMC';
const SYNC_ID = 'd4d-mecca-protein';
const MAX_DEALS_PER_CATEGORY = 12;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';

const KEYWORDS: ReadonlyArray<readonly [string, string]> = [
  ['Tuna', 'تونة'], ['Eggs', 'بيض'], ['Milk', 'حليب'], ['Protein', 'بروتين'],
  ['Protein milk', 'حليب بروتين'], ['Yogurt', 'زبادي'], ['Greek yogurt', 'زبادي يوناني'],
  ['Cheese', 'جبن'], ['Ground meat', 'لحم مفروم'], ['Meat', 'لحم'], ['Chicken', 'دجاج'],
  ['Chicken breast', 'صدور دجاج'], ['Fish', 'سمك'], ['Shrimp', 'روبيان'], ['Turkey', 'ديك رومي'],
  ['Fava beans', 'فول'], ['Chickpeas', 'حمص'], ['Lentils', 'عدس'],
];

type FetchLike = typeof fetch;
type RawOffer = Record<string, unknown>;

export interface D4DResult {
  regionCode: string;
  deals: KitchenDealDTO[];
}

function number(value: unknown) {
  const parsed = Number(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function dateOnly(value: unknown) {
  const valueText = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(valueText) ? valueText : null;
}

function cleanDescription(value: unknown) {
  return text(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
}

function quality(discountPct: number): KitchenDealQuality {
  if (discountPct >= 35) return 'excellent';
  if (discountPct >= 20) return 'good';
  return 'discount';
}

function cookiesFrom(headers: Headers) {
  const values = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? (headers.get('set-cookie') ? [headers.get('set-cookie')!] : []);
  return values.map((cookie) => cookie.split(';', 1)[0]).filter(Boolean).join('; ');
}

function htmlInput(html: string, id: string) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<input[^>]+id=["']${escaped}["'][^>]+value=["']([^"']*)["']`, 'i'))
    ?? html.match(new RegExp(`id=["']${escaped}["'][^>]+value=["']([^"']*)["']`, 'i'));
  return match?.[1]?.replaceAll('&amp;', '&') ?? '';
}

function stableId(sourceOfferId: string, imageUrl: string, store: string, price: number) {
  return createHash('sha256').update(`${sourceOfferId}|${imageUrl}|${store}|${price}`).digest('hex').slice(0, 32);
}

export function normalizeD4DOffer(raw: RawOffer, category: string, todayLocal: string): KitchenDealDTO | null {
  const priceSar = number(raw.price);
  const previousPriceSar = number(raw.was_price);
  const validTo = dateOnly(raw.valid_to);
  if (priceSar <= 0 || previousPriceSar <= priceSar || (validTo != null && validTo < todayLocal)) return null;

  const store = text(raw.text_footer_ar) || text(raw.text_footer) || 'Unknown store';
  const rawImage = text(raw.image_url);
  const imageUrl = rawImage ? (rawImage.startsWith('http') ? rawImage : `${D4D_CDN}/${rawImage.replace(/^\/+/, '')}`) : null;
  const sourceOfferId = text(raw.idoffer_special) || `${rawImage}|${priceSar}|${previousPriceSar}`;
  const discountPct = Math.round(((previousPriceSar - priceSar) / previousPriceSar) * 100);
  return {
    id: stableId(sourceOfferId, imageUrl ?? '', store, priceSar), sourceOfferId, category,
    description: cleanDescription(raw.description), store, location: LOCATION, priceSar, previousPriceSar,
    discountPct, quality: quality(discountPct), validFrom: dateOnly(raw.valid_from), validTo, imageUrl,
    sourceUrl: D4D_PRODUCTS_PAGE,
  };
}

export async function fetchD4DProteinDeals(todayLocal: string, fetchImpl: FetchLike = fetch): Promise<D4DResult> {
  const landing = await fetchImpl(D4D_PRODUCTS_PAGE, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' }, signal: AbortSignal.timeout(30_000) });
  if (!landing.ok) throw new Error(`D4D session failed (${landing.status})`);
  const html = await landing.text();
  const csrf = htmlInput(html, 'csrf');
  if (!csrf) throw new Error('D4D session did not include a CSRF token');
  const regionCode = htmlInput(html, 'country') || REGION_FALLBACK;
  const cookie = cookiesFrom(landing.headers);

  const searches = await Promise.allSettled(KEYWORDS.map(async ([category, keyword]) => {
    const body = new URLSearchParams({ '_csrf-frontend': csrf, search: keyword, country: regionCode, offset: '0', limit: '80' });
    const response = await fetchImpl(D4D_SEARCH_URL, {
      method: 'POST', body,
      headers: { 'user-agent': USER_AGENT, accept: 'application/json, text/javascript, */*; q=0.01', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest', referer: D4D_PRODUCTS_PAGE, ...(cookie ? { cookie } : {}) },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${category} search failed (${response.status})`);
    const payload = await response.json() as { items?: unknown };
    return { category, items: Array.isArray(payload.items) ? payload.items as RawOffer[] : [] };
  }));

  const successful = searches.filter((result): result is PromiseFulfilledResult<{ category: string; items: RawOffer[] }> => result.status === 'fulfilled');
  if (successful.length === 0) throw new Error('Every D4D protein search failed');
  const seen = new Set<string>();
  const deals: KitchenDealDTO[] = [];
  for (const { value } of successful) {
    const categoryDeals = value.items
      .map((raw) => normalizeD4DOffer(raw, value.category, todayLocal))
      .filter((deal): deal is KitchenDealDTO => deal != null)
      .sort((a, b) => b.discountPct - a.discountPct || a.priceSar - b.priceSar);
    let categoryCount = 0;
    for (const deal of categoryDeals) {
      if (seen.has(deal.id)) continue;
      seen.add(deal.id);
      deals.push(deal);
      categoryCount += 1;
      if (categoryCount >= MAX_DEALS_PER_CATEGORY) break;
    }
  }
  deals.sort((a, b) => b.discountPct - a.discountPct || a.priceSar - b.priceSar);
  return { regionCode, deals };
}

function cachedDeals(db: DB, todayLocal: string): KitchenDealsDTO {
  const sync = db.select().from(kitchenDealSync).where(eq(kitchenDealSync.id, SYNC_ID)).get();
  const rows = db.select().from(kitchenDeals).orderBy(desc(kitchenDeals.discountPct)).all();
  return {
    source: 'D4D Online', location: sync?.location ?? LOCATION, regionCode: sync?.regionCode ?? REGION_FALLBACK,
    dateLocal: todayLocal, refreshedAtUtc: sync?.refreshedAtUtc ?? null,
    stale: sync?.refreshedDateLocal !== todayLocal, lastError: sync?.lastError ?? null,
    deals: rows
      .filter((deal) => deal.validTo == null || deal.validTo >= todayLocal)
      .map(({ fetchedAtUtc: _fetchedAtUtc, ...deal }) => deal as KitchenDealDTO),
  };
}

const refreshes = new WeakMap<object, Promise<KitchenDealsDTO>>();

export function refreshKitchenDeals(db: DB, todayLocal: string, fetcher: (today: string) => Promise<D4DResult> = fetchD4DProteinDeals) {
  const active = refreshes.get(db as object);
  if (active) return active;
  const refresh = (async () => {
    const attemptedAt = new Date().toISOString();
    try {
      const result = await fetcher(todayLocal);
      const fetchedAtUtc = new Date().toISOString();
      db.transaction((tx) => {
        tx.delete(kitchenDeals).run();
        if (result.deals.length) tx.insert(kitchenDeals).values(result.deals.map((deal) => ({ ...deal, fetchedAtUtc }))).run();
        tx.insert(kitchenDealSync).values({ id: SYNC_ID, location: LOCATION, regionCode: result.regionCode, refreshedDateLocal: todayLocal, refreshedAtUtc: fetchedAtUtc, lastAttemptAtUtc: attemptedAt, lastError: null })
          .onConflictDoUpdate({ target: kitchenDealSync.id, set: { location: LOCATION, regionCode: result.regionCode, refreshedDateLocal: todayLocal, refreshedAtUtc: fetchedAtUtc, lastAttemptAtUtc: attemptedAt, lastError: null } }).run();
      });
      return cachedDeals(db, todayLocal);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'D4D refresh failed';
      db.insert(kitchenDealSync).values({ id: SYNC_ID, location: LOCATION, regionCode: REGION_FALLBACK, refreshedDateLocal: null, refreshedAtUtc: null, lastAttemptAtUtc: attemptedAt, lastError: message })
        .onConflictDoUpdate({ target: kitchenDealSync.id, set: { lastAttemptAtUtc: attemptedAt, lastError: message } }).run();
      throw error;
    }
  })().finally(() => refreshes.delete(db as object));
  refreshes.set(db as object, refresh);
  return refresh;
}

export async function getKitchenDeals(db: DB, todayLocal: string, fetcher?: (today: string) => Promise<D4DResult>) {
  const cached = cachedDeals(db, todayLocal);
  if (!cached.stale) return cached;
  try { return await refreshKitchenDeals(db, todayLocal, fetcher); }
  catch { return cachedDeals(db, todayLocal); }
}
