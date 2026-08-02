import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type DB } from '../db/client.js';

const ai = vi.hoisted(() => ({
  configured: true,
  calls: [] as Array<{ task?: string }>,
  result: { verdict: 'buy_now', score: 88, summary: 'Aligned.', benefits: ['Useful'], risks: [], suggestedGoalIds: [], reviewDate: '' },
  importResult: { title: 'AI extracted lamp', imageUrl: 'https://1.1.1.1/lamp.jpg', price: 12.99, currency: 'SAR' },
}));
vi.mock('../assistant/modelGateway.js', () => ({
  ModelGateway: class {
    configured() { return ai.configured; }
    async generateStructured(request: { task?: string }) { ai.calls.push(request); return request.task === 'wishlist_import' ? ai.importResult : ai.result; }
  },
}));

import { normalizeWishlistProductUrl, parseWishlistProductHtml, registerWishlistRoutes } from './wishlist.js';

describe('wishlist routes', () => {
  let db: DB;
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    ai.configured = true;
    ai.calls = [];
    db = createDb(':memory:');
    app = Fastify();
    await app.register(multipart);
    registerWishlistRoutes(app, db);
    await app.ready();
  });
  afterEach(async () => { vi.unstubAllGlobals(); await app.close(); });

  it('validates, creates, filters, updates, and purchases items', async () => {
    const invalid = await app.inject({ method: 'POST', url: '/wishlist/items', payload: { title: 'Console', status: 'planned' } });
    expect(invalid.statusCode).toBe(400);
    const created = await app.inject({ method: 'POST', url: '/wishlist/items', payload: { title: 'Console', category: 'Games', priority: 4, status: 'planned', targetDate: '2026-08-20', priceMinor: 200_000 } });
    expect(created.statusCode).toBe(201);
    const item = created.json();
    const filtered = await app.inject({ method: 'GET', url: '/wishlist/items?category=Games&sort=price_desc' });
    expect(filtered.json()).toHaveLength(1);
    const updated = await app.inject({ method: 'PATCH', url: `/wishlist/items/${item.id}`, payload: { notes: 'Wait for a sale' } });
    expect(updated.json().notes).toBe('Wait for a sale');
    const purchased = await app.inject({ method: 'POST', url: `/wishlist/items/${item.id}/purchase`, payload: { actualPriceMinor: 190_000, purchasedAt: '2026-08-10' } });
    expect(purchased.json()).toMatchObject({ status: 'purchased', actualPriceMinor: 190_000 });
    const summary = await app.inject({ method: 'GET', url: '/wishlist/summary?month=2026-08' });
    expect(summary.json().actualMinor).toBe(190_000);
  });

  it('stores monthly budgets and wishlist currency', async () => {
    expect((await app.inject({ method: 'GET', url: '/wishlist/settings' })).json().currency).toBe('SAR');
    await app.inject({ method: 'PUT', url: '/wishlist/settings', payload: { currency: 'USD' } });
    const budget = await app.inject({ method: 'PUT', url: '/wishlist/budgets/2026-08', payload: { amountMinor: 120_000 } });
    expect(budget.json()).toMatchObject({ currency: 'USD', amountMinor: 120_000 });
  });

  it('rejects private product preview targets', async () => {
    const response = await app.inject({ method: 'POST', url: '/wishlist/preview', payload: { url: 'http://127.0.0.1/product' } });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toMatch(/Private/);
  });

  it('uses the tiny AI fallback only when deterministic import misses core fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html><body>Opaque storefront payload</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })));
    const response = await app.inject({ method: 'POST', url: '/wishlist/preview', payload: { url: 'https://93.184.216.34/product/opaque' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      title: 'AI extracted lamp',
      imageUrl: 'https://1.1.1.1/lamp.jpg',
      priceMinor: 1_299,
      detectedCurrency: 'SAR',
    });
    expect(response.json().warnings).toContain('AI filled missing product details; verify them before saving.');
    expect(ai.calls.map((call) => call.task)).toEqual(['wishlist_import']);

    ai.calls = [];
    const rendered = await app.inject({
      method: 'POST',
      url: '/wishlist/preview/rendered',
      payload: { url: 'https://93.184.216.34/product/blocked', html: '<title>Rendered marketplace page</title><main>Product details are loaded here.</main>' },
    });
    expect(rendered.statusCode).toBe(200);
    expect(rendered.json()).toMatchObject({ title: 'Rendered marketplace page', imageUrl: 'https://1.1.1.1/lamp.jpg', priceMinor: 1_299 });
    expect(ai.calls.map((call) => call.task)).toEqual(['wishlist_import']);

    ai.calls = [];
    const complete = `<meta property="og:title" content="Complete product"><meta property="og:image" content="https://1.1.1.1/item.jpg"><meta property="product:price:amount" content="10"><meta property="product:price:currency" content="SAR">`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(complete, { status: 200, headers: { 'content-type': 'text/html' } })));
    const deterministic = await app.inject({ method: 'POST', url: '/wishlist/preview', payload: { url: 'https://93.184.216.34/product/complete' } });
    expect(deterministic.statusCode).toBe(200);
    expect(deterministic.json().priceMinor).toBe(1_000);
    expect(ai.calls).toEqual([]);
  });

  it('extracts Amazon Saudi product details from its page markup', () => {
    expect(normalizeWishlistProductUrl('https://www.amazon.sa/-/en/gp/product/0140449264?smid=A2XPWB6MYN7ZDK&psc=1'))
      .toBe('https://www.amazon.sa/dp/0140449264');
    const html = `
      <html><head><title>Long Amazon browser title</title></head><body>
        <span id="productTitle"> The Count of Monte Cristo </span>
        <div id="corePrice_feature_div">
          <span class="a-price priceToPay"><span class="a-offscreen">SAR 69.00</span></span>
        </div>
        <img src="https://images-na.ssl-images-amazon.com/fallback.jpg"
             data-old-hires="https://m.media-amazon.com/images/I/book.jpg"
             id="landingImage" />
      </body></html>`;
    expect(parseWishlistProductHtml(html, 'https://www.amazon.sa/-/en/gp/product/0140449264', 'SAR')).toMatchObject({
      title: 'The Count of Monte Cristo',
      retailer: 'amazon.sa',
      imageUrl: 'https://m.media-amazon.com/images/I/book.jpg',
      priceMinor: 6_900,
      detectedCurrency: 'SAR',
      warnings: [],
    });
    expect(parseWishlistProductHtml('<title>Unavailable item</title>', 'https://www.amazon.sa/dp/example', 'SAR').priceMinor).toBeNull();
  });

  it('extracts nested Schema.org and aggregate offers used by eBay and other marketplaces', () => {
    expect(normalizeWishlistProductUrl('https://www.ebay.com/itm/Example-Product/123456789012?mkcid=1&campid=42'))
      .toBe('https://www.ebay.com/itm/123456789012');
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'WebPage',
      mainEntity: {
        '@type': 'Product',
        name: 'Marketplace headphones',
        image: { contentUrl: 'https://i.ebayimg.com/images/headphones.jpg' },
        offers: { '@type': 'AggregateOffer', lowPrice: '29.95', highPrice: '49.95', priceCurrency: 'USD' },
      },
    })}</script>`;
    expect(parseWishlistProductHtml(html, 'https://www.ebay.com/itm/123456789012', 'USD')).toMatchObject({
      title: 'Marketplace headphones',
      imageUrl: 'https://i.ebayimg.com/images/headphones.jpg',
      priceMinor: 2_995,
      detectedCurrency: 'USD',
      retailer: 'ebay.com',
      warnings: [],
    });
  });

  it('extracts embedded product state used by Temu and SHEIN-style storefronts', () => {
    const temu = `<script type="application/json">${JSON.stringify({ product: {
      goodsName: 'Portable desk lamp',
      goodsImage: { url: 'https://img.kwcdn.com/lamp.jpg' },
      salePrice: { amount: '12.49', currency: 'USD' },
    } })}</script>`;
    expect(parseWishlistProductHtml(temu, 'https://www.temu.com/portable-desk-lamp-g-601099.html', 'USD')).toMatchObject({
      title: 'Portable desk lamp', imageUrl: 'https://img.kwcdn.com/lamp.jpg', priceMinor: 1_249, detectedCurrency: 'USD', retailer: 'temu.com', warnings: [],
    });

    const shein = `<script>window.__INITIAL_STATE__ = ${JSON.stringify({ goods: {
      goods_name: 'Relaxed fit shirt',
      goods_img: 'https://img.ltwebstatic.com/shirt.jpg',
      retail_price: { amount: '85.00', currency_code: 'SAR' },
    } })};</script>`;
    expect(parseWishlistProductHtml(shein, 'https://ar.shein.com/Relaxed-Shirt-p-123.html', 'SAR')).toMatchObject({
      title: 'Relaxed fit shirt', imageUrl: 'https://img.ltwebstatic.com/shirt.jpg', priceMinor: 8_500, detectedCurrency: 'SAR', retailer: 'ar.shein.com', warnings: [],
    });
  });

  it('falls back to Microdata and RDFa product fields for standards-based stores', () => {
    const html = `
      <div itemscope itemtype="https://schema.org/Product">
        <span itemprop="name">Mechanical keyboard</span>
        <img itemprop="image" src="/images/keyboard.jpg" />
        <meta itemprop="priceCurrency" content="EUR" />
        <span itemprop="price" content="79.90">€79.90</span>
      </div>`;
    expect(parseWishlistProductHtml(html, 'https://shop.example/products/keyboard', 'EUR')).toMatchObject({
      title: 'Mechanical keyboard', imageUrl: 'https://shop.example/images/keyboard.jpg', priceMinor: 7_990, detectedCurrency: 'EUR', warnings: [],
    });
  });

  it('keeps AI from recommending an over-budget purchase', async () => {
    await app.inject({ method: 'PUT', url: '/wishlist/budgets/2026-08', payload: { amountMinor: 10_000 } });
    const created = await app.inject({ method: 'POST', url: '/wishlist/items', payload: { title: 'Expensive item', category: 'Products', status: 'planned', targetDate: '2026-08-20', priceMinor: 50_000 } });
    const response = await app.inject({ method: 'POST', url: `/wishlist/items/${created.json().id}/advice` });
    expect(response.statusCode).toBe(200);
    expect(response.json().advice.verdict).toBe('wait');
    expect(response.json().advice.score).toBeLessThanOrEqual(49);
    expect(response.json().advice.stale).toBe(false);
    await app.inject({ method: 'PUT', url: '/wishlist/budgets/2026-08', payload: { amountMinor: 100_000 } });
    const refreshed = await app.inject({ method: 'GET', url: `/wishlist/items?q=Expensive` });
    expect(refreshed.json()[0].advice.stale).toBe(true);
  });

  it('leaves deterministic guidance available when AI is not configured', async () => {
    ai.configured = false;
    const created = await app.inject({ method: 'POST', url: '/wishlist/items', payload: { title: 'Item' } });
    const response = await app.inject({ method: 'POST', url: `/wishlist/items/${created.json().id}/advice` });
    expect(response.statusCode).toBe(503);
  });
});
