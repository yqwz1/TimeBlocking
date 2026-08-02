import { describe, expect, it } from 'vitest';
import { getYouTubeCanonicalUrl, getYouTubeEmbedUrl, getYouTubeVideoId } from '@timeblock/shared';
import { buildInboxCaptureContent } from './inbox.js';

describe('YouTube note capture', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('extracts the video id from %s', (url, expected) => {
    expect(getYouTubeVideoId(url)).toBe(expected);
  });

  it('rejects lookalike hosts and malformed video ids', () => {
    expect(getYouTubeVideoId('https://youtube.com.example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(getYouTubeVideoId('https://youtube.com/watch?v=too-short')).toBeNull();
  });

  it('builds a portable inbox note with a privacy-enhanced player target', () => {
    const id = 'dQw4w9WgXcQ';
    const canonical = getYouTubeCanonicalUrl(id);
    const content = buildInboxCaptureContent({
      kind: 'youtube',
      title: 'A useful video',
      body: `@[youtube](${canonical})\n\n## Notes\n`,
      capturedAt: '2026-07-29T00:00:00.000Z',
      source: canonical,
      bookmark: true,
      tags: ['youtube', 'video'],
    });

    expect(content).toContain('capture: youtube');
    expect(content).toContain('bookmark: true');
    expect(content).toContain(`@[youtube](${canonical})`);
    expect(getYouTubeEmbedUrl(id)).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0');
  });
});
