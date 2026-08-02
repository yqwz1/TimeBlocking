import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { eq } from 'drizzle-orm';
import {
  WishlistBudgetInputSchema,
  WishlistItemInputSchema,
  WishlistItemPatchSchema,
  WishlistPurchaseInputSchema,
  WishlistSettingsInputSchema,
  WishlistVerdictSchema,
  type WishlistAdviceDTO,
  type WishlistItemDTO,
  type WishlistLinkPreviewDTO,
} from '@timeblock/shared';
import { DATA_DIR, nowUtcIso } from '../config.js';
import type { DB } from '../db/client.js';
import { goals, wishlistBudgets, wishlistItems } from '../db/schema.js';
import { getSettings } from '../settings.js';
import { ModelGateway } from '../assistant/modelGateway.js';
import {
  buildWishlistSummary,
  getWishlistCurrency,
  setWishlistCurrency,
  wishlistAdviceHash,
  wishlistBudgetFit,
  wishlistItemToDTO,
  type WishlistRow,
} from '../wishlist/service.js';

const IMAGE_DIR = path.join(DATA_DIR, 'wishlist-images');
const IMAGE_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/avif', '.avif'],
]);

function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase();
  if (value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) return true;
  const ipv4 = value.replace(/^::ffff:/, '').split('.').map(Number);
  if (ipv4.length !== 4 || ipv4.some((part) => !Number.isInteger(part))) return false;
  const first = ipv4[0]!;
  const second = ipv4[1]!;
  return first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || first === 0;
}

async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only public HTTP(S) URLs are supported');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw new Error('Private addresses are not allowed');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('Private addresses are not allowed');
  return url;
}

async function safeFetch(raw: string, maxBytes: number, accept: string): Promise<{ buffer: Buffer; contentType: string; finalUrl: string }> {
  let current = raw;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const url = await assertPublicUrl(current);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(url, {
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            Accept: accept,
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 TimeBlock-Wishlist/1.0',
          },
        });
        if ([429, 502, 503, 504].includes(response.status) && attempt === 0) continue;
        if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
          current = new URL(response.headers.get('location')!, url).toString();
          break;
        }
        if (!response.ok) throw new Error(`Store returned ${response.status}`);
        const length = Number(response.headers.get('content-length') ?? 0);
        if (length > maxBytes) throw new Error('Response is too large');
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > maxBytes) throw new Error('Response is too large');
        return { buffer, contentType: response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '', finalUrl: url.toString() };
      } catch (error) {
        if (attempt === 1) {
          if (error instanceof Error && error.name === 'AbortError') throw new Error('The store took too long to respond');
          throw error;
        }
      } finally {
        clearTimeout(timeout);
      }
    }
  }
  throw new Error('Too many redirects');
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim();
}

function htmlAttributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    attrs.set(match[1]!.toLowerCase(), decodeHtml(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return attrs;
}

function htmlMetadata(html: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = htmlAttributes(tag);
    const key = (attrs.get('property') ?? attrs.get('name') ?? attrs.get('itemprop'))?.toLowerCase();
    const content = attrs.get('content');
    if (key && content && !values.has(key)) values.set(key, content);
  }
  return values;
}

function schemaProducts(html: string): Record<string, unknown>[] {
  const products: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]!.trim()) as unknown;
      const visit = (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) return value.forEach(visit);
        const record = value as Record<string, unknown>;
        if (record['@type'] === 'Product' || (Array.isArray(record['@type']) && record['@type'].includes('Product'))) products.push(record);
        Object.values(record).forEach(visit);
      };
      visit(parsed);
    } catch {
      // Ignore malformed store metadata; Open Graph and manual entry remain available.
    }
  }
  return products;
}

function scalarValue(value: unknown, preferredKeys: string[] = []): string | number | null {
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = scalarValue(item, preferredKeys);
      if (found != null && String(found).trim()) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of [...preferredKeys, '@value', 'value', 'amount', 'url', 'src', 'content']) {
    const found = scalarValue(record[key], []);
    if (found != null && String(found).trim()) return found;
  }
  return null;
}

function schemaOffer(product: Record<string, unknown>): Record<string, unknown> | null {
  const candidates: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(visit);
    const record = value as Record<string, unknown>;
    if (record.price != null || record.lowPrice != null || record.highPrice != null || record.priceSpecification != null) candidates.push(record);
    if (record.offers) visit(record.offers);
    if (record.priceSpecification) visit(record.priceSpecification);
  };
  visit(product.offers);
  return candidates[0] ?? null;
}

function propertyValue(html: string, property: string): string | null {
  for (const match of html.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)) {
    const tag = match[0];
    const attrs = htmlAttributes(tag);
    const properties = `${attrs.get('itemprop') ?? ''} ${attrs.get('property') ?? ''}`.toLowerCase().split(/\s+/);
    if (!properties.includes(property.toLowerCase())) continue;
    const direct = attrs.get('content') ?? attrs.get('value') ?? attrs.get('src') ?? attrs.get('href');
    if (direct) return direct;
    const rest = html.slice((match.index ?? 0) + tag.length);
    const closing = rest.match(new RegExp(`^([\\s\\S]{0,1000}?)<\\/${match[1]}>`, 'i'))?.[1];
    if (closing) return decodeHtml(closing.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')) || null;
  }
  return null;
}

interface EmbeddedProduct {
  title: string | number | null;
  image: string | number | null;
  price: string | number | null;
  currency: string | number | null;
}

function assignedJson(script: string): unknown[] {
  const values: unknown[] = [];
  const assignment = /(?:window\.)?(?:__INITIAL_STATE__|__NEXT_DATA__|rawData|productData|goodsDetail\w*)\s*=\s*/gi;
  for (const match of script.matchAll(assignment)) {
    const start = (match.index ?? 0) + match[0].length;
    const opener = script[start];
    if (opener !== '{' && opener !== '[') continue;
    const closer = opener === '{' ? '}' : ']';
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < script.length; index += 1) {
      const char = script[index]!;
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === opener) depth += 1;
      else if (char === closer && --depth === 0) {
        try { values.push(JSON.parse(script.slice(start, index + 1))); } catch { /* Ignore JavaScript-only state. */ }
        break;
      }
    }
  }
  return values;
}

function embeddedProduct(html: string): EmbeddedProduct | null {
  const normalizedKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
  const findKey = (record: Record<string, unknown>, keys: string[]) => {
    const wanted = new Set(keys);
    const actual = Object.keys(record).find((key) => wanted.has(normalizedKey(key)));
    return actual ? record[actual] : undefined;
  };
  const titleKeys = ['productname', 'goodsname', 'goodstitle', 'itemtitle', 'producttitle'];
  const imageKeys = ['goodsimage', 'goodsimg', 'mainimage', 'mainimageurl', 'imageurl', 'primaryimage'];
  const priceKeys = ['saleprice', 'currentprice', 'retailprice', 'priceamount', 'finalprice'];
  const currencyKeys = ['pricecurrency', 'currencycode', 'currency'];
  let best: { score: number; value: EmbeddedProduct } | null = null;
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(visit);
    const record = value as Record<string, unknown>;
    const titleSource = findKey(record, titleKeys);
    const imageSource = findKey(record, imageKeys);
    const priceSource = findKey(record, priceKeys);
    const currencySource = findKey(record, currencyKeys)
      ?? (priceSource && typeof priceSource === 'object' ? findKey(priceSource as Record<string, unknown>, currencyKeys) : undefined);
    const candidate: EmbeddedProduct = {
      title: scalarValue(titleSource, ['text', 'name']),
      image: scalarValue(imageSource, ['url', 'src']),
      price: scalarValue(priceSource, ['amount', 'value', 'price']),
      currency: scalarValue(currencySource, ['code', 'value']),
    };
    const score = Number(candidate.title != null) * 2 + Number(candidate.image != null) + Number(candidate.price != null) * 2 + Number(candidate.currency != null);
    if (score >= 3 && (!best || score > best.score)) best = { score, value: candidate };
    Object.values(record).forEach(visit);
  };
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const script = decodeHtml(match[1]!.trim());
    try { visit(JSON.parse(script)); } catch { /* The script may contain a JSON assignment instead. */ }
    assignedJson(script).forEach(visit);
  }
  const selected = best as { score: number; value: EmbeddedProduct } | null;
  return selected ? selected.value : null;
}

function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

function priceToMinor(value: unknown, currency: string | null): number | null {
  if (!currency || (typeof value !== 'string' && typeof value !== 'number')) return null;
  const normalized = String(value).replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  if (!/\d/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 10 ** currencyDigits(currency)) : null;
}

function elementTextById(html: string, id: string): string | null {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<[^>]+id=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i'));
  if (!match) return null;
  return decodeHtml(match[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')) || null;
}

function amazonImage(html: string): string | null {
  const tag = html.match(/<img\b[^>]*\bid=["']landingImage["'][^>]*>/i)?.[0];
  if (!tag) return null;
  return /\bdata-old-hires=["']([^"']+)["']/i.exec(tag)?.[1]
    || /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1]
    || null;
}

function amazonPrice(html: string): string | null {
  const focused = /(?:priceToPay|corePrice_feature_div)[\s\S]{0,3000}?\ba-offscreen["'][^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1];
  const focusedText = focused ? decodeHtml(focused.replace(/<[^>]+>/g, ' ')) : '';
  if (/\d/.test(focusedText)) return focusedText;
  const payAt = html.search(/class=["'][^"']*\bpriceToPay\b[^"']*["']/i);
  const priceArea = payAt >= 0 ? html.slice(payAt, payAt + 2_000) : html;
  const whole = /\ba-price-whole["'][^>]*>\s*([\d.,]+)/i.exec(priceArea)?.[1];
  if (!whole) return null;
  const fraction = /\ba-price-fraction["'][^>]*>\s*(\d+)/i.exec(priceArea)?.[1] ?? '00';
  return `${whole.replace(/[.,]+$/, '')}.${fraction}`;
}

function isAmazonHost(hostname: string): boolean {
  return /^amazon\.(?:com|sa|ae|ca|de|fr|it|es|nl|se|pl|sg|com\.au|com\.br|com\.mx|co\.jp|co\.uk|co\.za|com\.be)$/i.test(hostname);
}

function isEbayHost(hostname: string): boolean {
  return /^ebay\.(?:com|ca|de|fr|it|es|nl|at|ch|ie|pl|com\.au|com\.sg|co\.uk)$/i.test(hostname);
}

function currencyForHost(hostname: string): string | null {
  if (hostname.endsWith('.sa') || hostname === 'amazon.sa') return 'SAR';
  if (hostname.endsWith('.ae') || hostname === 'amazon.ae') return 'AED';
  if (hostname.endsWith('.co.uk')) return 'GBP';
  if (/\.(?:de|fr|it|es|nl|at|ie|be)$/.test(hostname)) return 'EUR';
  if (hostname.endsWith('.com.au')) return 'AUD';
  if (hostname.endsWith('.ca')) return 'CAD';
  if (hostname.endsWith('.co.jp')) return 'JPY';
  if (hostname.endsWith('.com') && (isAmazonHost(hostname) || isEbayHost(hostname))) return 'USD';
  return null;
}

function currencyFromPrice(value: unknown): string | null {
  const text = String(value ?? '').toUpperCase();
  const code = /(?:^|[^A-Z])([A-Z]{3})(?=[^A-Z]|$)/.exec(text)?.[1];
  if (code && /^[A-Z]{3}$/.test(code)) return code;
  if (text.includes('€')) return 'EUR';
  if (text.includes('£')) return 'GBP';
  if (text.includes('ر.س') || text.includes('SAR')) return 'SAR';
  return null;
}

function firstMetadata(meta: Map<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = meta.get(key);
    if (value) return value;
  }
  return null;
}

export function normalizeWishlistProductUrl(raw: string): string {
  const url = new URL(raw);
  const hostname = url.hostname.replace(/^www\./, '');
  const trackingKeys = ['fbclid', 'gclid', 'msclkid', 'ref', 'ref_', 'tag', 'campid', 'customid', 'mkcid', 'mkevt', 'mkrid', 'toolid', 'src_identifier', 'src_module', 'refer_page_name', 'refer_page_id', '_x_sessn_id', '_x_vst_scene'];
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || trackingKeys.includes(key.toLowerCase())) url.searchParams.delete(key);
  }
  if (isAmazonHost(hostname)) {
    const asin = /\/(?:gp\/product|dp)\/([A-Z0-9]{10})(?:[/?]|$)/i.exec(url.pathname)?.[1];
    if (asin) {
      url.pathname = `/dp/${asin.toUpperCase()}`;
      url.search = '';
      url.hash = '';
    }
  } else if (isEbayHost(hostname)) {
    const itemId = /\/itm\/(?:[^/?]+\/)?(\d{9,15})(?:[/?]|$)/i.exec(url.pathname)?.[1];
    if (itemId) {
      url.pathname = `/itm/${itemId}`;
      url.search = '';
      url.hash = '';
    }
  }
  return url.toString();
}

export function parseWishlistProductHtml(html: string, finalUrl: string, baseCurrency: string): WishlistLinkPreviewDTO {
  const meta = htmlMetadata(html);
  const product = schemaProducts(html)[0] ?? {};
  const offer = schemaOffer(product);
  const embedded = embeddedProduct(html);
  const hostname = new URL(finalUrl).hostname.replace(/^www\./, '');
  const amazon = isAmazonHost(hostname);
  const rawPrice = scalarValue(offer?.price ?? offer?.lowPrice ?? offer?.highPrice ?? offer?.priceSpecification, ['price', 'lowPrice', 'highPrice', 'amount', 'value'])
    ?? embedded?.price
    ?? firstMetadata(meta, ['product:price:amount', 'og:price:amount', 'price', 'twitter:data1'])
    ?? propertyValue(html, 'price')
    ?? propertyValue(html, 'lowPrice')
    ?? (amazon ? amazonPrice(html) : null);
  const detectedCurrency = String(
    scalarValue(offer?.priceCurrency ?? offer?.priceSpecification, ['priceCurrency', 'currency'])
      ?? embedded?.currency
      ?? firstMetadata(meta, ['product:price:currency', 'og:price:currency', 'pricecurrency'])
      ?? propertyValue(html, 'priceCurrency')
      ?? currencyFromPrice(rawPrice)
      ?? currencyForHost(hostname)
      ?? '',
  ).toUpperCase() || null;
  const rawImage = scalarValue(product.image, ['url', 'contentUrl', 'src']);
  const imageCandidate = String(
    rawImage
      ?? embedded?.image
      ?? firstMetadata(meta, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src', 'product:image'])
      ?? propertyValue(html, 'image')
      ?? (amazon ? amazonImage(html) : null)
      ?? '',
  ) || null;
  let imageUrl: string | null = null;
  if (imageCandidate) {
    try { imageUrl = new URL(decodeHtml(imageCandidate), finalUrl).toString(); }
    catch { imageUrl = null; }
  }
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = String(
    scalarValue(product.name, ['text', 'value'])
      ?? embedded?.title
      ?? firstMetadata(meta, ['og:title', 'twitter:title', 'product:name'])
      ?? propertyValue(html, 'name')
      ?? (amazon ? elementTextById(html, 'productTitle') : null)
      ?? (titleMatch ? decodeHtml(titleMatch[1]!) : ''),
  ).replace(/\s+/g, ' ').trim() || null;
  const priceMinor = detectedCurrency === baseCurrency ? priceToMinor(rawPrice, detectedCurrency) : null;
  const warnings: string[] = [];
  if (!title) warnings.push('No title was found; enter it manually.');
  if (!imageUrl) warnings.push('No usable product image was found.');
  if (!rawPrice) warnings.push('No listed price was found.');
  else if (detectedCurrency && detectedCurrency !== baseCurrency) warnings.push(`The store price is ${detectedCurrency}; convert it to ${baseCurrency} manually.`);
  return { url: finalUrl, title, retailer: hostname, imageUrl, priceMinor, detectedCurrency, warnings };
}

interface AiImportedProduct {
  title: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string | null;
}

function validateAiImportedProduct(value: unknown): AiImportedProduct {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const text = (candidate: unknown, max: number) => typeof candidate === 'string' && candidate.trim() ? candidate.trim().slice(0, max) : null;
  const imageCandidate = text(record.imageUrl, 2_000);
  let imageUrl: string | null = null;
  if (imageCandidate) {
    try {
      const parsed = new URL(imageCandidate);
      if (['http:', 'https:'].includes(parsed.protocol)) imageUrl = parsed.toString();
    } catch { /* Invalid model URLs are discarded. */ }
  }
  const priceValue = record.price == null ? null : Number(record.price);
  const currency = text(record.currency, 3)?.toUpperCase() ?? null;
  return {
    title: text(record.title, 240),
    imageUrl,
    price: priceValue != null && Number.isFinite(priceValue) && priceValue >= 0 ? priceValue : null,
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
  };
}

function aiProductContext(html: string): string {
  const headSignals = (html.match(/<(?:title|meta)\b[^>]*>(?:[\s\S]*?<\/title>)?/gi) ?? []).join('\n').slice(0, 1_800);
  const visibleText = decodeHtml(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' '))
    .slice(0, 1_800);
  return `${headSignals}\nVISIBLE PRODUCT TEXT:\n${visibleText}`;
}

async function enrichPreviewWithAi(gateway: ModelGateway, html: string, preview: WishlistLinkPreviewDTO, baseCurrency: string): Promise<WishlistLinkPreviewDTO> {
  const missingCoreFields = Number(!preview.title) + Number(!preview.imageUrl) + Number(preview.priceMinor == null);
  if (missingCoreFields < 2 || !gateway.configured()) return preview;
  try {
    const extracted = await gateway.generateStructured({
      task: 'wishlist_import',
      promptVersion: 'wishlist-import-v1',
      model: 'gemini-3.5-flash-lite',
      cacheTtlMs: 30 * 24 * 60 * 60_000,
      retries: 0,
      prompt: [
        'Extract product metadata from this page excerpt. Return JSON only.',
        'Use only facts explicitly present in the excerpt. Never guess. Use null when absent.',
        'price is the current single-item price in major currency units, without shipping or list-price discounts.',
        `URL: ${preview.url}`,
        `Already extracted: ${JSON.stringify({ title: preview.title, imageUrl: preview.imageUrl, detectedCurrency: preview.detectedCurrency, priceMinor: preview.priceMinor })}`,
        aiProductContext(html),
      ].join('\n'),
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string', nullable: true },
          imageUrl: { type: 'string', nullable: true },
          price: { type: 'number', nullable: true },
          currency: { type: 'string', nullable: true },
        },
        required: ['title', 'imageUrl', 'price', 'currency'],
      },
      validate: validateAiImportedProduct,
    });
    const title = preview.title ?? extracted.title;
    const imageUrl = preview.imageUrl ?? extracted.imageUrl;
    const detectedCurrency = preview.detectedCurrency ?? extracted.currency;
    const priceMinor = preview.priceMinor ?? (extracted.price != null && detectedCurrency === baseCurrency ? priceToMinor(extracted.price, detectedCurrency) : null);
    const changed = title !== preview.title || imageUrl !== preview.imageUrl || priceMinor !== preview.priceMinor || detectedCurrency !== preview.detectedCurrency;
    const warnings: string[] = [];
    if (!title) warnings.push('No title was found; enter it manually.');
    if (!imageUrl) warnings.push('No usable product image was found.');
    if (priceMinor == null) {
      if (extracted.price != null && detectedCurrency && detectedCurrency !== baseCurrency) warnings.push(`The store price is ${detectedCurrency}; convert it to ${baseCurrency} manually.`);
      else warnings.push('No listed price was found.');
    }
    if (changed) warnings.push('AI filled missing product details; verify them before saving.');
    return { ...preview, title, imageUrl, priceMinor, detectedCurrency, warnings };
  } catch {
    return preview;
  }
}

async function previewLink(raw: string, baseCurrency: string, gateway: ModelGateway): Promise<WishlistLinkPreviewDTO> {
  const page = await safeFetch(normalizeWishlistProductUrl(raw), 5 * 1024 * 1024, 'text/html,application/xhtml+xml');
  if (!page.contentType.includes('html')) throw new Error('The link did not return an HTML page');
  const html = page.buffer.toString('utf8');
  const preview = await enrichPreviewWithAi(gateway, html, parseWishlistProductHtml(html, page.finalUrl, baseCurrency), baseCurrency);
  if (preview.imageUrl) {
    try { await assertPublicUrl(preview.imageUrl); }
    catch { preview.imageUrl = null; }
  }
  return preview;
}

async function removeStoredImage(row: WishlistRow): Promise<void> {
  if (!row.imageFileName) return;
  try { await fsp.unlink(path.join(IMAGE_DIR, row.imageFileName)); } catch { /* already gone */ }
}

async function storeImage(itemId: string, source: { buffer: Buffer; contentType: string }): Promise<string> {
  const extension = IMAGE_TYPES.get(source.contentType);
  if (!extension) throw new Error('Unsupported image type');
  if (source.buffer.length > 8 * 1024 * 1024) throw new Error('Image is larger than 8 MB');
  await fsp.mkdir(IMAGE_DIR, { recursive: true });
  const fileName = `${itemId}${extension}`;
  await fsp.writeFile(path.join(IMAGE_DIR, fileName), source.buffer);
  return fileName;
}

async function snapshotRemoteImage(db: DB, row: WishlistRow): Promise<void> {
  if (!row.imageUrl) return;
  try {
    const image = await safeFetch(row.imageUrl, 8 * 1024 * 1024, 'image/avif,image/webp,image/png,image/jpeg');
    const imageFileName = await storeImage(row.id, image);
    db.update(wishlistItems).set({ imageFileName }).where(eq(wishlistItems.id, row.id)).run();
  } catch {
    // Keep the editable remote URL as the fallback.
  }
}

function getRow(db: DB, id: string): WishlistRow | undefined {
  return db.select().from(wishlistItems).where(eq(wishlistItems.id, id)).get();
}

function monthForAdvice(db: DB, row: WishlistRow): string {
  return row.targetDate?.slice(0, 7) ?? DateTime.now().setZone(getSettings(db).timezone).toFormat('yyyy-MM');
}

function adviceValidator(value: unknown): Omit<WishlistAdviceDTO, 'analyzedAtUtc' | 'inputHash' | 'stale'> {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const verdict = WishlistVerdictSchema.parse(row.verdict);
  const score = Math.round(Math.max(0, Math.min(100, Number(row.score))));
  if (!Number.isFinite(score)) throw new Error('Invalid AI score');
  const list = (candidate: unknown) => Array.isArray(candidate) ? candidate.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 4) : [];
  return {
    verdict,
    score,
    summary: String(row.summary ?? '').trim().slice(0, 600),
    benefits: list(row.benefits),
    risks: list(row.risks),
    suggestedGoalIds: list(row.suggestedGoalIds),
    reviewDate: typeof row.reviewDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.reviewDate) ? row.reviewDate : null,
  };
}

export function registerWishlistRoutes(app: FastifyInstance, db: DB) {
  app.get('/wishlist/settings', async () => ({ currency: getWishlistCurrency(db) }));
  app.put<{ Body: unknown }>('/wishlist/settings', async (req, reply) => {
    const parsed = WishlistSettingsInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    setWishlistCurrency(db, parsed.data.currency);
    return { currency: parsed.data.currency };
  });

  app.get<{ Params: { month: string } }>('/wishlist/budgets/:month', async (req, reply) => {
    if (!/^\d{4}-\d{2}$/.test(req.params.month)) return reply.code(400).send({ error: 'month must be YYYY-MM' });
    const row = db.select().from(wishlistBudgets).where(eq(wishlistBudgets.month, req.params.month)).get();
    return { month: req.params.month, amountMinor: row?.amountMinor ?? 0, currency: getWishlistCurrency(db), updatedAtUtc: row?.updatedAtUtc ?? null };
  });
  app.put<{ Params: { month: string }; Body: unknown }>('/wishlist/budgets/:month', async (req, reply) => {
    if (!/^\d{4}-\d{2}$/.test(req.params.month)) return reply.code(400).send({ error: 'month must be YYYY-MM' });
    const parsed = WishlistBudgetInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const updatedAtUtc = nowUtcIso();
    db.insert(wishlistBudgets)
      .values({ month: req.params.month, amountMinor: parsed.data.amountMinor, updatedAtUtc })
      .onConflictDoUpdate({ target: wishlistBudgets.month, set: { amountMinor: parsed.data.amountMinor, updatedAtUtc } })
      .run();
    return { month: req.params.month, amountMinor: parsed.data.amountMinor, currency: getWishlistCurrency(db), updatedAtUtc };
  });

  app.get<{ Querystring: Record<string, string | undefined> }>('/wishlist/items', async (req): Promise<WishlistItemDTO[]> => {
    const q = req.query.q?.toLocaleLowerCase().trim();
    const minPrice = req.query.minPrice ? Number(req.query.minPrice) : null;
    const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : null;
    let items = db.select().from(wishlistItems).all().map((row) => wishlistItemToDTO(db, row));
    items = items.filter((item) => {
      const adviceVerdict = item.advice?.verdict ?? 'not_analyzed';
      return (!q || `${item.title} ${item.notes} ${item.retailer ?? ''}`.toLocaleLowerCase().includes(q))
        && (!req.query.status || item.status === req.query.status)
        && (!req.query.category || item.category === req.query.category)
        && (!req.query.priority || item.priority === Number(req.query.priority))
        && (!req.query.verdict || adviceVerdict === req.query.verdict)
        && (!req.query.goalId || item.goalIds.includes(req.query.goalId))
        && (!req.query.month || item.targetDate?.slice(0, 7) === req.query.month || item.purchasedAt?.slice(0, 7) === req.query.month)
        && (minPrice == null || (item.priceMinor != null && item.priceMinor >= minPrice))
        && (maxPrice == null || (item.priceMinor != null && item.priceMinor <= maxPrice));
    });
    const verdictRank = { buy_now: 3, wait: 2, skip: 1 } as const;
    const sort = req.query.sort ?? 'recommendation';
    items.sort((a, b) => {
      if (sort === 'price_asc') return (a.priceMinor ?? Number.MAX_SAFE_INTEGER) - (b.priceMinor ?? Number.MAX_SAFE_INTEGER);
      if (sort === 'price_desc') return (b.priceMinor ?? -1) - (a.priceMinor ?? -1);
      if (sort === 'priority') return b.priority - a.priority;
      if (sort === 'target_date') return (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999');
      if (sort === 'newest') return b.createdAtUtc.localeCompare(a.createdAtUtc);
      const advice = (verdictRank[b.advice?.verdict as keyof typeof verdictRank] ?? 0) - (verdictRank[a.advice?.verdict as keyof typeof verdictRank] ?? 0);
      return advice || b.priority - a.priority || (b.priceMinor ?? -1) - (a.priceMinor ?? -1);
    });
    return items;
  });

  app.post<{ Body: unknown }>('/wishlist/items', async (req, reply) => {
    const parsed = WishlistItemInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const id = randomUUID();
    const now = nowUtcIso();
    db.insert(wishlistItems).values({ ...parsed.data, id, goalIds: JSON.stringify(parsed.data.goalIds), createdAtUtc: now, updatedAtUtc: now }).run();
    let row = getRow(db, id)!;
    await snapshotRemoteImage(db, row);
    row = getRow(db, id)!;
    return reply.code(201).send(wishlistItemToDTO(db, row));
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/wishlist/items/:id', async (req, reply) => {
    const row = getRow(db, req.params.id);
    if (!row) return reply.code(404).send({ error: 'Wishlist item not found' });
    const patch = WishlistItemPatchSchema.safeParse(req.body);
    if (!patch.success) return reply.code(400).send({ error: patch.error.message });
    const current = wishlistItemToDTO(db, row);
    const merged = WishlistItemInputSchema.safeParse({ ...current, ...patch.data });
    if (!merged.success) return reply.code(400).send({ error: merged.error.message });
    db.update(wishlistItems).set({ ...patch.data, goalIds: patch.data.goalIds ? JSON.stringify(patch.data.goalIds) : undefined, updatedAtUtc: nowUtcIso() }).where(eq(wishlistItems.id, row.id)).run();
    const updated = getRow(db, row.id)!;
    if (patch.data.imageUrl && patch.data.imageUrl !== row.imageUrl) {
      await removeStoredImage(row);
      db.update(wishlistItems).set({ imageFileName: null }).where(eq(wishlistItems.id, row.id)).run();
      await snapshotRemoteImage(db, getRow(db, row.id)!);
    }
    return wishlistItemToDTO(db, getRow(db, row.id)!);
  });

  app.delete<{ Params: { id: string } }>('/wishlist/items/:id', async (req, reply) => {
    const row = getRow(db, req.params.id);
    if (!row) return reply.code(404).send({ error: 'Wishlist item not found' });
    await removeStoredImage(row);
    db.delete(wishlistItems).where(eq(wishlistItems.id, row.id)).run();
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/wishlist/items/:id/purchase', async (req, reply) => {
    const row = getRow(db, req.params.id);
    if (!row) return reply.code(404).send({ error: 'Wishlist item not found' });
    const parsed = WishlistPurchaseInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    db.update(wishlistItems).set({ status: 'purchased', actualPriceMinor: parsed.data.actualPriceMinor, purchasedAt: parsed.data.purchasedAt, updatedAtUtc: nowUtcIso() }).where(eq(wishlistItems.id, row.id)).run();
    return wishlistItemToDTO(db, getRow(db, row.id)!);
  });

  app.post<{ Body: { url?: string } }>('/wishlist/preview', async (req, reply) => {
    if (!req.body?.url) return reply.code(400).send({ error: 'A product URL is required' });
    try { return await previewLink(req.body.url, getWishlistCurrency(db), new ModelGateway(db)); }
    catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'Could not import this product' }); }
  });

  app.post<{ Body: { url?: string; html?: string } }>('/wishlist/preview/rendered', async (req, reply) => {
    if (!req.body?.url || !req.body?.html) return reply.code(400).send({ error: 'A product URL and rendered product context are required' });
    if (req.body.html.length > 25_000) return reply.code(413).send({ error: 'Rendered product context is too large' });
    try {
      const url = normalizeWishlistProductUrl(req.body.url);
      await assertPublicUrl(url);
      const currency = getWishlistCurrency(db);
      const preview = await enrichPreviewWithAi(new ModelGateway(db), req.body.html, parseWishlistProductHtml(req.body.html, url, currency), currency);
      if (preview.imageUrl) {
        try { await assertPublicUrl(preview.imageUrl); } catch { preview.imageUrl = null; }
      }
      return preview;
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : 'Could not inspect this rendered product' });
    }
  });

  app.post<{ Params: { id: string } }>('/wishlist/items/:id/image', async (req, reply) => {
    const row = getRow(db, req.params.id);
    if (!row) return reply.code(404).send({ error: 'Wishlist item not found' });
    const file = await req.file({ limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
    if (!file || !IMAGE_TYPES.has(file.mimetype.toLowerCase())) return reply.code(415).send({ error: 'Use a JPEG, PNG, WebP, or AVIF image' });
    const buffer = await file.toBuffer();
    await removeStoredImage(row);
    const imageFileName = await storeImage(row.id, { buffer, contentType: file.mimetype.toLowerCase() });
    db.update(wishlistItems).set({ imageFileName, updatedAtUtc: nowUtcIso() }).where(eq(wishlistItems.id, row.id)).run();
    return wishlistItemToDTO(db, getRow(db, row.id)!);
  });

  app.get<{ Params: { id: string } }>('/wishlist/items/:id/image', async (req, reply) => {
    const row = getRow(db, req.params.id);
    if (!row?.imageFileName) return reply.code(404).send({ error: 'Image not found' });
    const diskPath = path.join(IMAGE_DIR, path.basename(row.imageFileName));
    if (!fs.existsSync(diskPath)) return reply.code(404).send({ error: 'Image file is missing' });
    const extension = path.extname(diskPath).toLowerCase();
    const mime = [...IMAGE_TYPES.entries()].find(([, ext]) => ext === extension)?.[0] ?? 'application/octet-stream';
    reply.header('Content-Type', mime).header('Cache-Control', 'private, max-age=86400');
    return reply.send(fs.createReadStream(diskPath));
  });

  app.delete<{ Params: { id: string } }>('/wishlist/items/:id/image', async (req, reply) => {
    const row = getRow(db, req.params.id);
    if (!row) return reply.code(404).send({ error: 'Wishlist item not found' });
    await removeStoredImage(row);
    db.update(wishlistItems).set({ imageFileName: null, updatedAtUtc: nowUtcIso() }).where(eq(wishlistItems.id, row.id)).run();
    return wishlistItemToDTO(db, getRow(db, row.id)!);
  });

  app.get<{ Querystring: { month?: string } }>('/wishlist/summary', async (req, reply) => {
    const month = req.query.month ?? DateTime.now().setZone(getSettings(db).timezone).toFormat('yyyy-MM');
    if (!/^\d{4}-\d{2}$/.test(month)) return reply.code(400).send({ error: 'month must be YYYY-MM' });
    return buildWishlistSummary(db, month);
  });

  app.post<{ Params: { id: string } }>('/wishlist/items/:id/advice', async (req, reply) => {
    const row = getRow(db, req.params.id);
    if (!row) return reply.code(404).send({ error: 'Wishlist item not found' });
    if (!['considering', 'planned'].includes(row.status)) return reply.code(409).send({ error: 'Only active wishlist items can be analyzed' });
    const gateway = new ModelGateway(db);
    if (!gateway.configured()) return reply.code(503).send({ error: 'AI is not configured. Budget guidance is still available.' });
    const month = monthForAdvice(db, row);
    const summary = buildWishlistSummary(db, month);
    const fit = wishlistBudgetFit(row, summary);
    const activeGoals = db.select().from(goals).where(eq(goals.status, 'active')).all().map((goal) => ({ id: goal.id, title: goal.title, relevance: goal.relevance, deadline: goal.customDeadline }));
    const inputHash = wishlistAdviceHash(db, row);
    const prompt = [
      'You are a conservative purchase advisor. Return structured JSON only.',
      'Assess whether the user should buy now, wait, or skip. Respect the budget facts and never invent product features.',
      `Currency: ${summary.currency}`,
      `Item: ${JSON.stringify({ title: row.title, notes: row.notes, retailer: row.retailer, category: row.category, priority: row.priority, priceMinor: row.priceMinor, targetDate: row.targetDate, confirmedGoalIds: JSON.parse(row.goalIds) })}`,
      `Budget: ${JSON.stringify({ month, budgetMinor: summary.budgetMinor, actualMinor: summary.actualMinor, plannedMinor: summary.plannedMinor, remainingMinor: summary.remainingMinor, fit })}`,
      `Active goals: ${JSON.stringify(activeGoals)}`,
      'Score 0-100. Suggest only goal IDs from the supplied list. Benefits and risks should each have at most 4 concise items. reviewDate must be YYYY-MM-DD or an empty string.',
    ].join('\n');
    try {
      let advice = await gateway.generateStructured({
        task: 'wishlist_advice',
        promptVersion: 'wishlist-v1',
        model: getSettings(db).aiModel,
        prompt,
        cacheTtlMs: 7 * 24 * 60 * 60_000,
        retries: 1,
        schema: {
          type: 'object',
          properties: {
            verdict: { type: 'string', enum: ['buy_now', 'wait', 'skip'] },
            score: { type: 'number' },
            summary: { type: 'string' },
            benefits: { type: 'array', items: { type: 'string' } },
            risks: { type: 'array', items: { type: 'string' } },
            suggestedGoalIds: { type: 'array', items: { type: 'string' } },
            reviewDate: { type: 'string' },
          },
          required: ['verdict', 'score', 'summary', 'benefits', 'risks', 'suggestedGoalIds', 'reviewDate'],
          additionalProperties: false,
        },
        validate: adviceValidator,
      });
      const allowedGoalIds = new Set(activeGoals.map((goal) => goal.id));
      advice = { ...advice, suggestedGoalIds: advice.suggestedGoalIds.filter((id) => allowedGoalIds.has(id)) };
      if (fit === 'over_budget' && advice.verdict === 'buy_now') advice = { ...advice, verdict: 'wait', score: Math.min(advice.score, 49), risks: ['This purchase exceeds the available monthly budget.', ...advice.risks].slice(0, 4) };
      const analyzedAtUtc = nowUtcIso();
      db.update(wishlistItems).set({ advice: JSON.stringify(advice), adviceInputHash: inputHash, adviceAnalyzedAtUtc: analyzedAtUtc, updatedAtUtc: analyzedAtUtc }).where(eq(wishlistItems.id, row.id)).run();
      return wishlistItemToDTO(db, getRow(db, row.id)!);
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : 'AI advice failed' });
    }
  });
}
