import type { TodayPlanDTO } from '@timeblock/shared';
import { ModelGateway } from '../assistant/modelGateway.js';

/** Advisory-only: never mutates schedule state, purely narrates the day. */
export async function generateBrief(gateway: ModelGateway, today: TodayPlanDTO, model: string): Promise<string> {
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
  return (await gateway.generateText({ task: 'draft', promptVersion: 'daily-brief-v2', model, prompt })).value;
}
