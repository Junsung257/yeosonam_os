import { createHash } from 'node:crypto';

export function hashAnalyticsSearchQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');
  if (!normalized) return null;
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
