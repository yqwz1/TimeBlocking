import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCaptureNote, buildWishlistItem, isHostExcluded, normalizeFolder, normalizeServerUrl } from './lib.js';

test('buildCaptureNote creates a dated, indexed Markdown note', () => {
  const note = buildCaptureNote({
    id: '20260722121500-abc12',
    kind: 'copy',
    text: 'A useful idea',
    pageTitle: 'Useful page',
    pageUrl: 'https://example.com/guide',
    capturedAt: '2026-07-22T12:15:00.000Z',
  }, { inboxFolder: 'Inbox/Web' });

  assert.equal(note.path, 'Inbox/Web/2026-07-22/20260722121500-abc12-a-useful-idea.md');
  assert.match(note.content, /type: web-capture/);
  assert.match(note.content, /\[Useful page\]\(https:\/\/example.com\/guide\)/);
  assert.match(note.content, /A useful idea/);
});

test('saved pages are marked as bookmarks', () => {
  const note = buildCaptureNote({
    kind: 'page',
    pageTitle: 'Read later',
    pageUrl: 'https://example.com/read-later',
    capturedAt: '2026-07-22T12:15:00.000Z',
  }, {});

  assert.match(note.content, /bookmark: true/);
});

test('local server URLs are accepted and remote URLs are rejected', () => {
  assert.equal(normalizeServerUrl('http://localhost:9999/path'), 'http://localhost:9999');
  assert.equal(normalizeServerUrl('https://example.com'), 'http://127.0.0.1:4141');
});

test('folder and excluded host handling stays inside the vault', () => {
  assert.equal(normalizeFolder('../Inbox\\Web/../../Ideas'), 'Inbox/Web/Ideas');
  assert.equal(isHostExcluded('https://private.example.com/a', ['example.com']), true);
  assert.equal(isHostExcluded('https://example.org/a', ['example.com']), false);
});

test('browser-extracted products become valid wishlist items', () => {
  assert.deepEqual(buildWishlistItem({
    title: '  Marketplace   headphones ',
    url: 'https://www.ebay.com/itm/123456789012',
    imageUrl: '/images/headphones.jpg',
    price: 29.95,
    currency: 'USD',
  }, 'USD'), {
    title: 'Marketplace headphones',
    notes: '',
    productUrl: 'https://www.ebay.com/itm/123456789012',
    imageUrl: 'https://www.ebay.com/images/headphones.jpg',
    retailer: 'ebay.com',
    category: 'Other',
    priority: 1,
    status: 'considering',
    priceMinor: 2_995,
    targetDate: null,
    goalIds: [],
  });
});
