let captureOnCopy = true;
let lastCaptureKey = '';
let lastCaptureAt = 0;

chrome.storage.sync.get({ captureOnCopy: true }).then((settings) => {
  captureOnCopy = settings.captureOnCopy !== false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.captureOnCopy) captureOnCopy = changes.captureOnCopy.newValue !== false;
});

function selectedText() {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    if (active instanceof HTMLInputElement && active.type === 'password') return '';
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (start != null && end != null && end > start) return active.value.slice(start, end);
  }
  return window.getSelection()?.toString() || '';
}

document.addEventListener('copy', () => {
  if (!captureOnCopy) return;
  const text = selectedText().trim();
  if (text.length < 2) return;

  // Browsers and some editors can dispatch copy twice for one gesture.
  const key = `${location.href}\n${text}`;
  const now = Date.now();
  if (key === lastCaptureKey && now - lastCaptureAt < 1200) return;
  lastCaptureKey = key;
  lastCaptureAt = now;

  void chrome.runtime.sendMessage({
    type: 'CAPTURE',
    capture: {
      kind: 'copy',
      text,
      pageTitle: document.title,
      pageUrl: location.href,
      capturedAt: new Date().toISOString(),
    },
  }).catch(() => {
    // The copy action must never be interrupted if the extension reloads.
  });
}, true);
