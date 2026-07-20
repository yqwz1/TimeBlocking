import { GoogleGenAI } from '@google/genai';
import { env } from '../config.js';

export function aiConfigured(): boolean {
  return !!env.geminiKey;
}

let cached: GoogleGenAI | null = null;

/** Shared Gemini client, lazily constructed once a key is available. */
export function getGenAIClient(): GoogleGenAI {
  if (!env.geminiKey) throw new Error('AI is not configured (no GEMINI_API_KEY)');
  if (!cached) cached = new GoogleGenAI({ apiKey: env.geminiKey });
  return cached;
}
