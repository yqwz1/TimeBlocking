import { describe, expect, it } from 'vitest';
import { normalizeAiModel } from './settings.js';

describe('normalizeAiModel', () => {
  it.each(['gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-2.0-flash-lite', 'gemini-2.0-flash-lite-001'])(
    'moves retired model %s to Gemini 3.5 Flash Lite',
    (model) => expect(normalizeAiModel(model)).toBe('gemini-3.5-flash-lite'),
  );

  it('preserves custom model settings', () => {
    expect(normalizeAiModel('gemini-3.6-flash')).toBe('gemini-3.6-flash');
  });
});
