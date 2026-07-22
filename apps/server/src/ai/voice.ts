import { VoiceInterpretationSchema, type VoiceInterpretationDTO } from '@timeblock/shared';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { generateAudioJson } from './client.js';

const RawTaskSchema = z.object({
  content: z.string(),
  description: z.string(),
  projectName: z.string().nullable(),
  priority: z.number().int().min(1).max(4).nullable(),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  durationMin: z.number().int().nullable(),
  difficulty: z.enum(['easy', 'medium', 'hard']).nullable(),
  labels: z.array(z.string()),
});

const RawNoteSchema = z.object({ title: z.string(), body: z.string() });

export const RawVoiceInterpretationSchema = z.object({
  transcript: z.string(),
  language: z.string(),
  intent: z.enum(['task', 'note', 'unknown']),
  task: RawTaskSchema.nullable(),
  note: RawNoteSchema.nullable(),
  warnings: z.array(z.string()),
});
export type RawVoiceInterpretation = z.infer<typeof RawVoiceInterpretationSchema>;

export interface VoiceInterpretationContext {
  timezone: string;
  now: DateTime;
  projects: { id: string; name: string }[];
  labels: string[];
}

export class VoiceNoSpeechError extends Error {
  constructor() {
    super('No speech was detected.');
  }
}

function exactName<T extends { name: string }>(value: string | null, choices: T[]): T | null {
  if (!value) return null;
  const key = value.trim().toLocaleLowerCase();
  return choices.find((choice) => choice.name.toLocaleLowerCase() === key) ?? null;
}

function exactLabel(value: string, labels: string[]): string | null {
  const key = value.trim().toLocaleLowerCase();
  return labels.find((label) => label.toLocaleLowerCase() === key) ?? null;
}

/** Turns schema-shaped model output into application-safe ids and UTC dates. */
export function normalizeVoiceInterpretation(rawInput: unknown, context: VoiceInterpretationContext): VoiceInterpretationDTO {
  const raw = RawVoiceInterpretationSchema.parse(rawInput);
  const transcript = raw.transcript.trim();
  if (!transcript) throw new VoiceNoSpeechError();

  const warnings = raw.warnings.map((warning) => warning.trim()).filter(Boolean);
  let task: VoiceInterpretationDTO['task'] = null;
  let note: VoiceInterpretationDTO['note'] = null;
  let intent = raw.intent;

  if (raw.intent === 'task' && raw.task) {
    const content = raw.task.content.trim();
    if (!content) {
      intent = 'unknown';
      warnings.push('A task title could not be determined.');
    } else {
      const matchedProject = exactName(raw.task.projectName, context.projects);
      if (raw.task.projectName && !matchedProject) warnings.push(`Project “${raw.task.projectName.trim()}” was not found and was left unset.`);

      const matchedLabels = [...new Set(raw.task.labels.map((label) => exactLabel(label, context.labels)).filter((label): label is string => !!label))];
      if (matchedLabels.length < raw.task.labels.length) warnings.push('One or more unrecognized labels were left unset.');

      let dueDate: string | null = null;
      let dueDatetimeUtc: string | null = null;
      if (raw.task.dueDate) {
        const parsedDate = DateTime.fromISO(raw.task.dueDate, { zone: context.timezone });
        if (parsedDate.isValid && /^\d{4}-\d{2}-\d{2}$/.test(raw.task.dueDate)) {
          dueDate = raw.task.dueDate;
          if (raw.task.dueTime) {
            const localDue = DateTime.fromISO(`${raw.task.dueDate}T${raw.task.dueTime}`, { zone: context.timezone });
            if (localDue.isValid && /^\d{2}:\d{2}$/.test(raw.task.dueTime)) {
              dueDatetimeUtc = localDue.toUTC().toISO({ suppressMilliseconds: true });
            } else {
              warnings.push('The spoken due time was unclear and was left unset.');
            }
          }
        } else {
          warnings.push('The spoken due date was unclear and was left unset.');
        }
      } else if (raw.task.dueTime) {
        warnings.push('A due time was heard without a clear date and was left unset.');
      }

      const durationMin = raw.task.durationMin != null && raw.task.durationMin >= 5 && raw.task.durationMin <= 480 ? raw.task.durationMin : null;
      if (raw.task.durationMin != null && durationMin == null) warnings.push('The task duration must be between 5 minutes and 8 hours and was left unset.');

      task = {
        content,
        description: raw.task.description.trim(),
        projectId: matchedProject?.id ?? null,
        priority: raw.task.priority,
        dueDate,
        dueDatetimeUtc,
        durationMin,
        difficulty: raw.task.difficulty,
        labels: matchedLabels,
      };
    }
  }

  if (raw.intent === 'note' && raw.note) {
    const title = raw.note.title.trim();
    const body = raw.note.body.trim().replace(/^#\s+[^\n]+\n+/, '');
    if (!title || !body) {
      intent = 'unknown';
      warnings.push('A complete note could not be determined.');
    } else {
      note = { title, body };
    }
  }

  if ((raw.intent === 'task' && !raw.task) || (raw.intent === 'note' && !raw.note)) {
    intent = 'unknown';
    warnings.push('The recording could not be converted into a complete draft.');
  }

  return VoiceInterpretationSchema.parse({
    transcript,
    language: raw.language.trim() || 'unknown',
    intent,
    task: intent === 'task' ? task : null,
    note: intent === 'note' ? note : null,
    warnings: [...new Set(warnings)],
  });
}

export async function interpretVoiceAudio(
  model: string,
  audio: Buffer,
  mimeType: string,
  browserTranscript: string,
  context: VoiceInterpretationContext,
): Promise<VoiceInterpretationDTO> {
  const prompt = [
    'Transcribe this short personal productivity command and turn it into exactly one editable task or one note draft.',
    'The speaker may use Arabic, English, or both. Preserve their language and meaning; never translate unless they explicitly ask.',
    `Current local time: ${context.now.setZone(context.timezone).toISO()} (${context.timezone}).`,
    `Existing projects (use an exact name or null): ${context.projects.map((project) => project.name).join(', ') || '(none)'}.`,
    `Existing labels (use exact names only): ${context.labels.join(', ') || '(none)'}.`,
    'Intent rules: an action to do is a task; information, an idea, journal text, or something to remember is a note. Use unknown when genuinely ambiguous.',
    'Task rules: content is a short actionable title; description holds useful remaining details. Priority is 4 urgent, 3 high, 2 medium, 1 low, or null. Duration is minutes.',
    'Date rules: resolve relative dates using the supplied local time. A weekday means its next occurrence. A time without a date means today if still future, otherwise tomorrow. Return dueDate as YYYY-MM-DD and dueTime as HH:mm, or null.',
    'Note rules: produce a concise title and cleaned, readable Markdown body. Remove filler words but preserve every material fact. Do not include a top-level heading in body.',
    'If no intelligible speech exists, return an empty transcript, unknown intent, null drafts, and a warning.',
    browserTranscript.trim() ? `Provisional browser transcript (only a hint; correct it from the audio): ${browserTranscript.trim().slice(0, 4000)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await generateAudioJson<unknown>(model, prompt, audio, mimeType, {
        type: 'object',
        properties: {
          transcript: { type: 'string' },
          language: { type: 'string' },
          intent: { type: 'string', enum: ['task', 'note', 'unknown'] },
          task: {
            type: 'object',
            nullable: true,
            properties: {
              content: { type: 'string' },
              description: { type: 'string' },
              projectName: { type: 'string', nullable: true },
              priority: { type: 'integer', nullable: true },
              dueDate: { type: 'string', nullable: true },
              dueTime: { type: 'string', nullable: true },
              durationMin: { type: 'integer', nullable: true },
              difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], nullable: true },
              labels: { type: 'array', items: { type: 'string' } },
            },
            required: ['content', 'description', 'projectName', 'priority', 'dueDate', 'dueTime', 'durationMin', 'difficulty', 'labels'],
            additionalProperties: false,
          },
          note: {
            type: 'object',
            nullable: true,
            properties: { title: { type: 'string' }, body: { type: 'string' } },
            required: ['title', 'body'],
            additionalProperties: false,
          },
          warnings: { type: 'array', items: { type: 'string' } },
        },
        required: ['transcript', 'language', 'intent', 'task', 'note', 'warnings'],
        additionalProperties: false,
  });
  return normalizeVoiceInterpretation(response, context);
}
