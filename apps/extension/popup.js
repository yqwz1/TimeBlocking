import { recentLabel } from './lib.js';

const elements = Object.fromEntries([
  'signal', 'connection-label', 'connection-detail', 'retry', 'page-title', 'page-host',
  'selection-preview', 'save-selection', 'save-page', 'quick-thought', 'char-count',
  'save-thought', 'copy-toggle', 'copy-state', 'queue-count', 'recent-list', 'toast',
  'open-options', 'open-brain',
].map((id) => [id, document.getElementById(id)]));

let state = null;
let activeTab = null;
let selection = '';
let toastTimer = null;

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function showToast(message, success = false) {
  elements.toast.textContent = message;
  elements.toast.className = `toast visible${success ? ' success' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { elements.toast.className = 'toast'; }, 2500);
}

function relativeTime(value) {
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta) || delta < 30_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

function renderState() {
  const connection = document.querySelector('.connection');
  const online = state?.connection?.ok;
  connection.className = `connection ${online ? 'online' : 'offline'}`;
  elements['connection-label'].textContent = online ? 'Second Brain is ready' : 'App is offline — captures will queue';
  elements['connection-detail'].textContent = state?.connection?.serverUrl || 'http://127.0.0.1:4141';
  elements.retry.hidden = online;

  elements['copy-toggle'].checked = state?.settings?.captureOnCopy !== false;
  elements['copy-state'].textContent = elements['copy-toggle'].checked ? 'ON' : 'OFF';
  elements['queue-count'].textContent = state?.pendingCount ? `${state.pendingCount} WAITING` : 'ALL FILED';

  const recent = state?.recent || [];
  if (!recent.length) {
    elements['recent-list'].innerHTML = '<p class="empty">Nothing captured yet.</p>';
    return;
  }
  elements['recent-list'].replaceChildren(...recent.slice(0, 4).map((capture) => {
    const row = document.createElement('div');
    row.className = 'recent-item';
    const kind = document.createElement('span');
    kind.className = 'recent-kind';
    kind.textContent = recentLabel(capture);
    const copy = document.createElement('div');
    copy.className = 'recent-copy';
    const title = document.createElement('strong');
    title.textContent = capture.title || 'Untitled capture';
    const time = document.createElement('span');
    time.textContent = relativeTime(capture.capturedAt);
    copy.append(title, time);
    const status = document.createElement('span');
    status.className = `recent-status ${capture.status === 'queued' ? 'queued' : ''}`;
    status.title = capture.status;
    row.append(kind, copy, status);
    return row;
  }));
}

async function getCurrentPage() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  elements['page-title'].textContent = activeTab?.title || 'This page cannot be captured';
  try {
    elements['page-host'].textContent = new URL(activeTab?.url || '').hostname || 'Brave internal page';
  } catch {
    elements['page-host'].textContent = 'Brave internal page';
  }
  const isWebPage = Boolean(activeTab?.id && activeTab?.url?.startsWith('http'));
  elements['save-page'].disabled = !isWebPage;
  if (!isWebPage) return;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => {
        const active = document.activeElement;
        if ((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && !(active instanceof HTMLInputElement && active.type === 'password')) {
          const start = active.selectionStart;
          const end = active.selectionEnd;
          if (start != null && end != null && end > start) return active.value.slice(start, end);
        }
        return window.getSelection()?.toString() || '';
      },
    });
    selection = String(result?.result || '').trim();
  } catch {
    selection = '';
  }
  if (selection) {
    elements['selection-preview'].textContent = `“${selection.slice(0, 180)}${selection.length > 180 ? '…' : ''}”`;
    elements['selection-preview'].hidden = false;
    elements['save-selection'].disabled = false;
  }
}

async function refreshState() {
  state = await send({ type: 'GET_STATE' });
  renderState();
}

async function capture(kind, text) {
  const result = await send({
    type: 'CAPTURE',
    capture: {
      kind,
      text,
      pageTitle: activeTab?.title || '',
      pageUrl: activeTab?.url?.startsWith('http') ? activeTab.url : '',
      capturedAt: new Date().toISOString(),
    },
  });
  if (result.ok) showToast('Filed in your Second Brain', true);
  else if (result.queued) showToast('App offline — safely queued');
  else if (result.ignored) showToast(result.reason || 'Capture skipped');
  else showToast(result.error || 'Could not capture');
  await refreshState();
  return result;
}

elements['save-selection'].addEventListener('click', () => capture('selection', selection));
elements['save-page'].addEventListener('click', () => capture('page', ''));
elements['save-thought'].addEventListener('click', async () => {
  const text = elements['quick-thought'].value.trim();
  if (!text) return;
  const result = await capture('thought', text);
  if (result.ok || result.queued) {
    elements['quick-thought'].value = '';
    elements['quick-thought'].dispatchEvent(new Event('input'));
  }
});
elements['quick-thought'].addEventListener('input', () => {
  const count = elements['quick-thought'].value.length;
  elements['char-count'].textContent = `${count.toLocaleString()} / 50,000`;
  elements['save-thought'].disabled = count === 0;
});
elements['quick-thought'].addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') elements['save-thought'].click();
});
elements['copy-toggle'].addEventListener('change', async () => {
  const enabled = elements['copy-toggle'].checked;
  await chrome.storage.sync.set({ captureOnCopy: enabled });
  state.settings.captureOnCopy = enabled;
  renderState();
  showToast(enabled ? 'Copy capture is on' : 'Copy capture paused', true);
});
elements.retry.addEventListener('click', async () => {
  await send({ type: 'RETRY_PENDING' });
  await refreshState();
});
elements['open-options'].addEventListener('click', () => chrome.runtime.openOptionsPage());
elements['open-brain'].addEventListener('click', () => {
  const url = `${state?.settings?.serverUrl || 'http://127.0.0.1:4141'}/notes`;
  chrome.tabs.create({ url });
});

await Promise.all([getCurrentPage(), refreshState()]);
