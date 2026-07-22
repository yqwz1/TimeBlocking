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
