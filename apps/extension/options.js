import { DEFAULT_SETTINGS, normalizeSettings } from './lib.js';

const form = document.getElementById('settings-form');
const serverUrl = document.getElementById('server-url');
const inboxFolder = document.getElementById('inbox-folder');
const captureOnCopy = document.getElementById('capture-on-copy');
const excludedHosts = document.getElementById('excluded-hosts');
const maxChars = document.getElementById('max-chars');
const maxCharsValue = document.getElementById('max-chars-value');
const result = document.getElementById('connection-result');
const toast = document.getElementById('toast');
let toastTimer = null;

function showToast(message) {
  toast.textContent = message;
  toast.className = 'toast visible';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 2200);
}

function showRangeValue() {
  maxCharsValue.value = `${Number(maxChars.value).toLocaleString()} chars`;
  maxCharsValue.textContent = maxCharsValue.value;
}

function readForm() {
  return normalizeSettings({
    serverUrl: serverUrl.value,
    inboxFolder: inboxFolder.value,
    captureOnCopy: captureOnCopy.checked,
    excludedHosts: excludedHosts.value.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean),
    maxCaptureChars: Number(maxChars.value),
  });
}

const settings = normalizeSettings(await chrome.storage.sync.get(DEFAULT_SETTINGS));
serverUrl.value = settings.serverUrl;
inboxFolder.value = settings.inboxFolder;
captureOnCopy.checked = settings.captureOnCopy;
excludedHosts.value = settings.excludedHosts.join('\n');
maxChars.value = String(settings.maxCaptureChars);
showRangeValue();

maxChars.addEventListener('input', showRangeValue);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const next = readForm();
  await chrome.storage.sync.set(next);
  serverUrl.value = next.serverUrl;
  inboxFolder.value = next.inboxFolder;
  showToast('Capture settings saved');
});

document.getElementById('test-connection').addEventListener('click', async () => {
  const next = readForm();
  await chrome.storage.sync.set(next);
  result.className = 'test-result';
  result.textContent = `Calling ${next.serverUrl}…`;
  const response = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' });
  if (response.ok) {
    result.className = 'test-result success';
    result.textContent = '● Connected — your Second Brain is ready.';
  } else {
    result.className = 'test-result error';
    result.textContent = '● No response. Start TimeBlock, then test again.';
  }
});
