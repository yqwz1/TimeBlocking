import {
  DEFAULT_SETTINGS,
  buildCaptureNote,
  buildWishlistItem,
  isHostExcluded,
  makeCaptureId,
  normalizeSettings,
} from './lib.js';

const STORAGE_KEYS = {
  recent: 'recentCaptures',
  pending: 'pendingCaptures',
};
const MAX_RECENT = 8;
const MAX_PENDING = 100;
const RETRY_ALARM = 'retry-second-brain-captures';

async function getSettings() {
  const raw = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return normalizeSettings(raw);
}

async function getLocalList(key) {
  const stored = await chrome.storage.local.get(key);
  return Array.isArray(stored[key]) ? stored[key] : [];
}

async function setBadge(state) {
  if (state === 'saved') {
    await chrome.action.setBadgeBackgroundColor({ color: '#2E6B4D' });
    await chrome.action.setBadgeText({ text: '✓' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1800);
    return;
  }
  if (state === 'queued') {
    const pending = await getLocalList(STORAGE_KEYS.pending);
    await chrome.action.setBadgeBackgroundColor({ color: '#C65A37' });
    await chrome.action.setBadgeText({ text: pending.length > 9 ? '9+' : String(pending.length) });
    return;
  }
  await chrome.action.setBadgeText({ text: '' });
}

async function addRecent(capture, status) {
  const recent = await getLocalList(STORAGE_KEYS.recent);
  const record = {
    id: capture.id,
    kind: capture.kind,
    title: capture.title,
    path: capture.path,
    pageUrl: capture.pageUrl || '',
    capturedAt: capture.capturedAt,
    status,
  };
  const next = [record, ...recent.filter((item) => item.id !== capture.id)].slice(0, MAX_RECENT);
  await chrome.storage.local.set({ [STORAGE_KEYS.recent]: next });
}

async function postCapture(capture, settings) {
  const response = await fetch(`${settings.serverUrl}/api/notes/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: capture.path, content: capture.content }),
  });
  // A retry can encounter the note created by an earlier request whose response
  // was lost. Capture paths contain random IDs, so this conflict means success.
  if (response.status === 409) return { ok: true, alreadySaved: true };
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Second Brain returned ${response.status}`);
  }
  return { ok: true };
}

async function enqueue(capture) {
  const pending = await getLocalList(STORAGE_KEYS.pending);
  const next = [...pending.filter((item) => item.id !== capture.id), capture].slice(-MAX_PENDING);
  await chrome.storage.local.set({ [STORAGE_KEYS.pending]: next });
  await addRecent(capture, 'queued');
  await setBadge('queued');
}

async function saveCapture(rawCapture, { allowQueue = true } = {}) {
  const settings = await getSettings();
  // Already-built captures came from the offline queue. Settings only gate new
  // material; pausing later must not strand clips that were accepted earlier.
  if (!rawCapture.content) {
    if (rawCapture.kind === 'copy' && !settings.captureOnCopy) return { ok: false, ignored: true, reason: 'copy capture is paused' };
    if (rawCapture.pageUrl && isHostExcluded(rawCapture.pageUrl, settings.excludedHosts)) {
      return { ok: false, ignored: true, reason: 'site is excluded' };
    }
  }

  const capture = rawCapture.content
    ? rawCapture
    : buildCaptureNote({ ...rawCapture, id: rawCapture.id || makeCaptureId() }, settings);
  try {
    await postCapture(capture, settings);
    await addRecent(capture, 'saved');
    await setBadge('saved');
    return { ok: true, capture: { id: capture.id, title: capture.title, path: capture.path } };
  } catch (error) {
    if (allowQueue) {
      await enqueue(capture);
      return { ok: false, queued: true, error: error instanceof Error ? error.message : String(error) };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error), capture };
  }
}

async function retryPending() {
  const pending = await getLocalList(STORAGE_KEYS.pending);
  if (!pending.length) {
    await setBadge('clear');
    return { saved: 0, remaining: 0 };
  }

  const remaining = [];
  let saved = 0;
  // Keep order stable so offline clips reappear in the order they were made.
  for (const capture of pending) {
    const result = await saveCapture(capture, { allowQueue: false });
    if (result.ok) saved += 1;
    else remaining.push(capture);
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.pending]: remaining });
  await setBadge(remaining.length ? 'queued' : 'clear');
  return { saved, remaining: remaining.length };
}

async function testConnection() {
  const settings = await getSettings();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${settings.serverUrl}/api/health`, { signal: controller.signal });
    return { ok: response.ok, serverUrl: settings.serverUrl };
  } catch (error) {
    return { ok: false, serverUrl: settings.serverUrl, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function addWishlistProduct(product) {
  const settings = await getSettings();
  const settingsResponse = await fetch(`${settings.serverUrl}/api/wishlist/settings`);
  if (!settingsResponse.ok) throw new Error('Could not read wishlist settings');
  const wishlistSettings = await settingsResponse.json();
  let enriched = product;
  const missingCoreFields = Number(!product?.title) + Number(!product?.imageUrl) + Number(!(Number.isFinite(Number(product?.price)) && product?.currency));
  let renderedPreview = null;
  if (missingCoreFields >= 2 && product?.context) {
    const previewResponse = await fetch(`${settings.serverUrl}/api/wishlist/preview/rendered`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: product.url, html: product.context }),
    });
    if (previewResponse.ok) {
      renderedPreview = await previewResponse.json();
      enriched = {
        ...product,
        title: product.title || renderedPreview.title,
        imageUrl: product.imageUrl || renderedPreview.imageUrl,
        currency: product.currency || renderedPreview.detectedCurrency,
      };
    }
  }
  const item = buildWishlistItem(enriched, wishlistSettings.currency);
  if (renderedPreview?.priceMinor != null) item.priceMinor = renderedPreview.priceMinor;
  if (!item.notes && renderedPreview?.warnings?.length) item.notes = renderedPreview.warnings.join(' ');
  const response = await fetch(`${settings.serverUrl}/api/wishlist/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Wishlist returned ${response.status}`);
  }
  return { ok: true, item: await response.json() };
}

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'brainclip-selection', title: 'Clip selection to Second Brain', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'brainclip-page', title: 'Bookmark page in Second Brain', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'brainclip-link', title: 'Save link to Second Brain', contexts: ['link'] });
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  createMenus();
  await chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
  await retryPending();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
  await retryPending();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) void retryPending();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const base = {
    pageTitle: tab?.title || '',
    pageUrl: info.pageUrl || tab?.url || '',
    capturedAt: new Date().toISOString(),
  };
  if (info.menuItemId === 'brainclip-selection') {
    void saveCapture({ ...base, kind: 'selection', text: info.selectionText || '' });
  } else if (info.menuItemId === 'brainclip-link') {
    void saveCapture({ ...base, kind: 'link', text: info.linkUrl || '', pageUrl: info.linkUrl || base.pageUrl, title: tab?.title || 'Saved link' });
  } else if (info.menuItemId === 'brainclip-page') {
    void saveCapture({ ...base, kind: 'page', text: '' });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'save-page') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith('http')) return;
  await saveCapture({ kind: 'page', text: '', pageTitle: tab.title || '', pageUrl: tab.url, capturedAt: new Date().toISOString() });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    if (message?.type === 'CAPTURE') return saveCapture(message.capture || {});
    if (message?.type === 'TEST_CONNECTION') return testConnection();
    if (message?.type === 'RETRY_PENDING') return retryPending();
    if (message?.type === 'ADD_WISHLIST_PRODUCT') return addWishlistProduct(message.product || {});
    if (message?.type === 'GET_STATE') {
      const [settings, recent, pending, connection] = await Promise.all([
        getSettings(),
        getLocalList(STORAGE_KEYS.recent),
        getLocalList(STORAGE_KEYS.pending),
        testConnection(),
      ]);
      return { settings, recent, pendingCount: pending.length, connection };
    }
    return { ok: false, error: 'unknown message' };
  };
  run().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});
