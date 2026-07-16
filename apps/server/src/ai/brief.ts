import { GoogleGenAI } from '@google/genai';
import type { TodayPlanDTO } from '@timeblock/shared';
import { env } from '../config.js';

export function aiConfigured(): boolean {
  return !!env.geminiKey;
}

/** Advisory-only: never mutates schedule state, purely narrates the day. */
export async function generateBrief(today: TodayPlanDTO, model: string): Promise<string> {
  if (!env.geminiKey) throw new Error('AI is not configured (no GEMINI_API_KEY)');
  const client = new GoogleGenAI({ apiKey: env.geminiKey });
  const prompt = [
    'You are a terse, encouraging personal daily-planning assistant.',
    "Given today's plan as JSON, write a short brief (4-6 sentences, plain text, no headers or markdown):",
    '- what matters most today',
    '- whether the day looks overloaded and what to consider dropping/moving if so',
    '- one concrete focus suggestion',
    "Don't just restate the raw block list back.",
    '',
    JSON.stringify(today),
  ].join('\n');
  const response = await client.models.generateContent({ model, contents: prompt });
  return (response.text ?? '').trim();
}
