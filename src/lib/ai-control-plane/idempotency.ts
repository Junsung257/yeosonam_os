import { createHash } from 'node:crypto';

export function hashPrompt(systemPrompt: string, userPrompt: string): string {
  return createHash('sha256').update(`${systemPrompt}\n\u0000${userPrompt}`).digest('hex');
}

export function hashResponse(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

export function assertDeterministicIdempotencyKey(value: string): string {
  const key = value.trim();
  if (!key || key.length > 240 || /\s/.test(key)) throw new Error('invalid_ai_idempotency_key');
  return key;
}
