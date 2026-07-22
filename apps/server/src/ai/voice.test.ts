import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { buildVoiceNotePath, sanitizeVoiceNoteTitle } from '@timeblock/shared';
import { normalizeVoiceInterpretation, VoiceNoSpeechError, type VoiceInterpretationContext } from './voice.js';

const context: VoiceInterpretationContext = {
  timezone: 'Asia/Riyadh',
  now: DateTime.fromISO('2026-07-22T12:00:00', { zone: 'Asia/Riyadh' }),
  projects: [
    { id: 'p-work', name: 'Work' },
    { id: 'p-uni', name: 'University' },
  ],
  labels: ['deep', 'calls'],
};

function rawTask(overrides: Record<string, unknown> = {}) {
  return {
    transcript: 'Add submit report tomorrow at three, urgent, forty five minutes',
    language: 'en',
    intent: 'task',
    task: {
      content: 'Submit report',
      description: 'Send the final report to Omar.',
      projectName: 'work',
      priority: 4,
      dueDate: '2026-07-23',
      dueTime: '15:00',
      durationMin: 45,
      difficulty: 'hard',
      labels: ['Deep'],
      ...overrides,
    },
    note: null,
    warnings: [],
  };
}

describe('voice interpretation normalization', () => {
  it('maps real project and label names and converts local due time to UTC', () => {
    const result = normalizeVoiceInterpretation(rawTask(), context);
    expect(result.intent).toBe('task');
    expect(result.task).toMatchObject({
      content: 'Submit report',
      projectId: 'p-work',
      labels: ['deep'],
      dueDate: '2026-07-23',
      dueDatetimeUtc: '2026-07-23T12:00:00Z',
      durationMin: 45,
      priority: 4,
      difficulty: 'hard',
    });
  });

  it('drops invented project and label values with review warnings', () => {
    const result = normalizeVoiceInterpretation(rawTask({ projectName: 'Moon Base', labels: ['invented'], durationMin: 999 }), context);
    expect(result.task?.projectId).toBeNull();
    expect(result.task?.labels).toEqual([]);
    expect(result.task?.durationMin).toBeNull();
    expect(result.warnings.join(' ')).toContain('Moon Base');
    expect(result.warnings.join(' ')).toContain('unrecognized labels');
    expect(result.warnings.join(' ')).toContain('8 hours');
  });

  it('cleans a duplicate generated heading from a note body', () => {
    const result = normalizeVoiceInterpretation(
      {
        transcript: 'Note that the prototype needs a calmer onboarding flow',
        language: 'en',
        intent: 'note',
        task: null,
        note: { title: 'Prototype onboarding', body: '# Prototype onboarding\n\nThe prototype needs a calmer onboarding flow.' },
        warnings: [],
      },
      context,
    );
    expect(result.note).toEqual({ title: 'Prototype onboarding', body: 'The prototype needs a calmer onboarding flow.' });
  });

  it('rejects silent model output', () => {
    expect(() =>
      normalizeVoiceInterpretation({ transcript: '  ', language: 'unknown', intent: 'unknown', task: null, note: null, warnings: [] }, context),
    ).toThrow(VoiceNoSpeechError);
  });

  it('rejects malformed structured output before it reaches the client', () => {
    expect(() => normalizeVoiceInterpretation(rawTask({ priority: 9 }), context)).toThrow();
  });
});

describe('voice note filenames', () => {
  it('sanitizes cross-platform filename characters and reserved names', () => {
    expect(sanitizeVoiceNoteTitle('  Project: launch / notes?  ')).toBe('Project-launch-notes');
    expect(sanitizeVoiceNoteTitle('CON')).toBe('note-CON');
    expect(sanitizeVoiceNoteTitle('***')).toBe('voice-note');
  });

  it('adds a stable collision suffix', () => {
    const timestamp = '2026-07-22-154500';
    const first = buildVoiceNotePath(timestamp, 'Launch notes');
    const second = buildVoiceNotePath(timestamp, 'Launch notes', [first]);
    expect(first).toBe('Voice Notes/2026-07-22-154500-Launch-notes.md');
    expect(second).toBe('Voice Notes/2026-07-22-154500-Launch-notes-2.md');
  });
});
