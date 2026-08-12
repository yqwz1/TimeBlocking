import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDb, type DB } from '../db/client.js';
import { registerKitchenRoutes } from '../routes/kitchen.js';
import { fetchD4DProteinDeals, normalizeD4DOffer, type D4DResult } from './deals.js';

describe('Kitchen D4D deals', () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

  it('keeps real discounts, rejects expired rows, and flags strong discounts deterministically', () => {
    const good = normalizeD4DOffer({
      idoffer_special: 'offer-1', price: '20', was_price: '30', text_footer_ar: 'متجر',
      valid_from: '2026-08-10 00:00:00', valid_to: '2026-08-20 23:59:59', image_url: 'flyer/a.jpg', description: '<b>Chicken</b> 1 kg',
    }, 'Chicken', '2026-08-12');
    expect(good).toMatchObject({ priceSar: 20, previousPriceSar: 30, discountPct: 33, quality: 'good', store: 'متجر', location: 'Mecca', validTo: '2026-08-20' });
    expect(good?.imageUrl).toBe('https://cdn.d4donline.com/flyer/a.jpg');
    expect(normalizeD4DOffer({ price: 20, was_price: 20 }, 'Chicken', '2026-08-12')).toBeNull();
    expect(normalizeD4DOffer({ price: 10, was_price: 20, valid_to: '2026-08-11' }, 'Chicken', '2026-08-12')).toBeNull();
  });

  it('reuses the D4D session cookie and deduplicates overlapping keyword results', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const offer = { idoffer_special: 'same-offer', price: 10, was_price: 20, text_footer_ar: 'Store', valid_to: '2026-08-30' };
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes('/products/search')) return new Response(JSON.stringify({ items: [offer] }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response('<input id="csrf" value="token-123"><input id="country" value="SAMC">', { status: 200, headers: { 'set-cookie': 'session=abc; Path=/; HttpOnly' } });
    });
    const result = await fetchD4DProteinDeals('2026-08-12', fetcher as typeof fetch);
    expect(result.deals).toHaveLength(1);
    expect(result.deals[0]).toMatchObject({ discountPct: 50, quality: 'excellent' });
    expect(requests.find((request) => request.url.includes('/products/search'))?.init?.headers).toMatchObject({ cookie: 'session=abc' });
  });

  it('refreshes automatically once per local day, persists the snapshot, and supports manual refresh', async () => {
    const db: DB = createDb(':memory:');
    let calls = 0;
    const fetcher = vi.fn(async (): Promise<D4DResult> => {
      calls += 1;
      return { regionCode: 'SAMC', deals: [{ id: 'deal-1', sourceOfferId: 'offer-1', category: 'Chicken', description: 'Chicken breast', store: 'Carrefour', location: 'Mecca', priceSar: 19.95, previousPriceSar: 29.95, discountPct: 33, quality: 'good', validFrom: null, validTo: '2099-12-31', imageUrl: null, sourceUrl: 'https://d4donline.com' }] };
    });
    const app = Fastify();
    apps.push(app);
    registerKitchenRoutes(app, db, fetcher);
    await app.ready();

    const first = await app.inject({ method: 'GET', url: '/kitchen/deals' });
    const second = await app.inject({ method: 'GET', url: '/kitchen/deals' });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(calls).toBe(1);
    expect(first.json()).toMatchObject({ location: 'Mecca', stale: false, deals: [{ store: 'Carrefour', quality: 'good' }] });

    const manual = await app.inject({ method: 'POST', url: '/kitchen/deals/refresh' });
    expect(manual.statusCode).toBe(200);
    expect(calls).toBe(2);
  });
});
