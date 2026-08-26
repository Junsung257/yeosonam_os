import { redactKoreanPII } from '@/lib/pii-redactor';

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 4_000;
const SENSITIVE_KEY = /^(?:authorization|cookie|set-cookie|password|passwd|secret|token|api[_-]?key|service[_-]?role|private[_-]?key|credential|email|e-mail|phone|mobile|passport|resident[_-]?id|account[_-]?(?:number|no)|ip[_-]?address)$/i;
const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bysn_[A-Za-z0-9_-]{10,}\b/g,
  /\bsk-[A-Za-z0-9_-]{10,}\b/g,
  /:\/\/[^\s/:@]+:[^\s/@]+@/g,
];

function scrubString(input: string): string {
  let output = redactKoreanPII(input).redacted;
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, REDACTED);
  return output.length > MAX_STRING_LENGTH
    ? `${output.slice(0, MAX_STRING_LENGTH)}...[truncated]`
    : output;
}

function scrubValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map(item => scrubValue(item, depth + 1, seen));
  }
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[CIRCULAR]';

  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key)
      ? REDACTED
      : scrubValue(item, depth + 1, seen);
  }
  seen.delete(value);
  return output;
}

/** Scrub telemetry payloads without recording raw Korean PII or credentials. */
export function scrubSentryEvent<T>(event: T): T {
  return scrubValue(event, 0, new WeakSet<object>()) as T;
}
