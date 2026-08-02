export const DEFAULT_SETTINGS = Object.freeze({
  serverUrl: 'http://127.0.0.1:4141',
  inboxFolder: 'Inbox/Web',
  captureOnCopy: true,
  excludedHosts: [],
  maxCaptureChars: 50_000,
});

export function normalizeServerUrl(value) {
  const fallback = DEFAULT_SETTINGS.serverUrl;
  try {
    const url = new URL(String(value || fallback).trim());
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}

export function normalizeFolder(value) {
  const cleaned = String(value || DEFAULT_SETTINGS.inboxFolder)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => part.replace(/[<>:"|?*\u0000-\u001f]/g, '-').trim())
    .filter(Boolean)
    .join('/');
  return cleaned || DEFAULT_SETTINGS.inboxFolder;
}

export function normalizeSettings(raw = {}) {
  return {
    serverUrl: normalizeServerUrl(raw.serverUrl),
    inboxFolder: normalizeFolder(raw.inboxFolder),
    captureOnCopy: raw.captureOnCopy !== false,
    excludedHosts: Array.isArray(raw.excludedHosts)
      ? raw.excludedHosts.map((host) => String(host).trim().toLowerCase()).filter(Boolean)
      : [],
    maxCaptureChars: Number.isFinite(raw.maxCaptureChars)
      ? Math.min(200_000, Math.max(100, Number(raw.maxCaptureChars)))
      : DEFAULT_SETTINGS.maxCaptureChars,
  };
}

export function isHostExcluded(pageUrl, excludedHosts) {
  try {
    const hostname = new URL(pageUrl).hostname.toLowerCase();
    return excludedHosts.some((entry) => hostname === entry || hostname.endsWith(`.${entry}`));
  } catch {
    return false;
  }
}

export function slugify(value) {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 52);
  return slug || 'capture';
}

function yamlString(value) {
  return JSON.stringify(String(value ?? '').replace(/\u2028|\u2029/g, ' '));
}

function safeMarkdownUrl(value) {
  return String(value || '').replace(/[()\\]/g, (char) => `\\${char}`);
}

export function makeCaptureId(date = new Date(), random = Math.random()) {
  const stamp = date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const suffix = Math.floor(random * 0xffffff).toString(36).padStart(5, '0').slice(0, 5);
  return `${stamp}-${suffix}`;
}

export function buildCaptureNote(capture, settings) {
  const normalized = normalizeSettings(settings);
  const date = new Date(capture.capturedAt || Date.now());
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const iso = validDate.toISOString();
  const dateFolder = iso.slice(0, 10);
  const id = capture.id || makeCaptureId(validDate);
  const kind = ['copy', 'selection', 'page', 'link', 'thought'].includes(capture.kind) ? capture.kind : 'thought';
  const sourceTitle = String(capture.pageTitle || '').trim();
  const pageUrl = String(capture.pageUrl || '').trim();
  const rawText = String(capture.text || '').trim();
  const text = rawText.slice(0, normalized.maxCaptureChars);
  const title = String(capture.title || '').trim()
    || (kind === 'page' || kind === 'link' ? sourceTitle : text.split(/\r?\n/, 1)[0])
    || 'Web capture';
  const displayTitle = title.slice(0, 120);
  const path = capture.path || `${normalized.inboxFolder}/${dateFolder}/${id}-${slugify(displayTitle)}.md`;
  const tag = kind === 'copy' || kind === 'selection' ? 'clipped' : kind;
  const sourceLine = pageUrl
    ? `> Source: [${sourceTitle || pageUrl}](${safeMarkdownUrl(pageUrl)})`
    : '';
  const body = kind === 'page' && !text
    ? `Saved for later from ${sourceTitle || pageUrl || 'the web'}.`
    : text;
  const truncated = rawText.length > text.length ? '\n\n> Capture truncated by the extension size limit.' : '';

  const content = [
    '---',
    'type: web-capture',
    `capture: ${kind}`,
    `source: ${yamlString(pageUrl)}`,
    `sourceTitle: ${yamlString(sourceTitle)}`,
    `capturedAt: ${yamlString(iso)}`,
    (kind === 'page' || kind === 'link') ? 'bookmark: true' : null,
    'tags:',
    '  - web-capture',
    `  - ${tag}`,
    '---',
    '',
    `# ${displayTitle.replace(/^#+\s*/, '')}`,
    '',
    sourceLine,
    sourceLine ? '' : null,
    body,
    truncated,
    '',
  ].filter((line) => line !== null).join('\n');

  return { ...capture, id, kind, capturedAt: iso, title: displayTitle, path, content };
}

export function recentLabel(capture) {
  if (capture.kind === 'page') return 'PAGE';
  if (capture.kind === 'link') return 'LINK';
  if (capture.kind === 'thought') return 'NOTE';
  return 'CLIP';
}

export function buildWishlistItem(product, wishlistCurrency = 'SAR') {
  const title = String(product?.title || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  if (!title) throw new Error('No product title was found on this page');
  const productUrl = String(product?.url || '').trim();
  const parsedUrl = new URL(productUrl);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('This is not a public product page');
  const imageCandidate = String(product?.imageUrl || '').trim();
  let imageUrl = null;
  try {
    const parsedImage = new URL(imageCandidate, parsedUrl);
    if (['http:', 'https:'].includes(parsedImage.protocol)) imageUrl = parsedImage.toString();
  } catch { /* An image is optional. */ }
  const detectedCurrency = String(product?.currency || '').toUpperCase();
  const currency = String(wishlistCurrency || 'SAR').toUpperCase();
  const amount = Number(product?.price);
  let priceMinor = null;
  if (detectedCurrency === currency && Number.isFinite(amount) && amount >= 0) {
    let digits = 2;
    try { digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { /* Keep two decimals. */ }
    priceMinor = Math.round(amount * 10 ** digits);
  }
  const notes = detectedCurrency && detectedCurrency !== currency && Number.isFinite(amount)
    ? `Listed price: ${detectedCurrency} ${amount}. Convert to ${currency} before planning this purchase.`
    : '';
  return {
    title,
    notes,
    productUrl: parsedUrl.toString(),
    imageUrl,
    retailer: parsedUrl.hostname.replace(/^www\./, '').slice(0, 120),
    category: 'Other',
    priority: 1,
    status: 'considering',
    priceMinor,
    targetDate: null,
    goalIds: [],
  };
}
