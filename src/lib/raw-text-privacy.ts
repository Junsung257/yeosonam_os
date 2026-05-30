import { createHash } from 'crypto';
import { redactKoreanPII } from '@/lib/pii-redactor';

export function rawTextHash(rawText: string | null | undefined): string | null {
  const value = String(rawText ?? '').trim();
  if (!value) return null;
  return createHash('sha256').update(value).digest('hex');
}

export function safeRawTextExcerpt(rawText: string | null | undefined, maxLength = 500): string | null {
  const value = String(rawText ?? '').trim();
  if (!value) return null;
  return redactKoreanPII(value).redacted.slice(0, maxLength);
}
