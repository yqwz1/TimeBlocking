import { describe, expect, it } from 'vitest';
import { normalizeAiModel } from './settings.js';
import { DEFAULT_SETTINGS, SettingsSchema } from '@timeblock/shared';

describe('normalizeAiModel', () => {
  it.each(['gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-2.0-flash-lite', 'gemini-2.0-flash-lite-001'])(
    'moves retired model %s to Gemini 3.5 Flash Lite',
    (model) => expect(normalizeAiModel(model)).toBe('gemini-3.5-flash-lite'),
  );

  it('preserves custom model settings', () => {
    expect(normalizeAiModel('gemini-3.6-flash')).toBe('gemini-3.6-flash');
  });
});

describe('email notification settings', () => {
  it('accepts the defaults and rejects invalid local times and reminder leads', () => {
    expect(SettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, emailMorningAgendaTime: '24:00' }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, emailDailyRecapTime: '7:30' }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, emailTaskReminderMinutesBefore: 0 }).success).toBe(false);
  });
});
