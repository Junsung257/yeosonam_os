const SENSITIVE_KEYS = new Set([
  'text',
  'message',
  'caption',
  'comment',
  'comments',
  'body',
  'username',
  'name',
  'email',
  'phone',
  'profile_pic',
  'avatar',
  'raw_text',
  'raw_payload',
]);

const ALLOWED_KEYS = new Set([
  'id',
  'media_id',
  'thread_id',
  'parent_id',
  'comment_id',
  'message_id',
  'timestamp',
  'created_time',
  'from',
  'to',
  'media',
  'post',
  'type',
  'verb',
  'field',
]);

function summarizeValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 80)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 5).map((item) => summarizeValue(item, depth + 1));
  if (typeof value !== 'object' || depth > 2) return '[omitted]';

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    const normalizedKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      out[key] = '[redacted]';
      continue;
    }
    if (ALLOWED_KEYS.has(normalizedKey) || typeof item !== 'object') {
      out[key] = summarizeValue(item, depth + 1);
    }
  }
  return out;
}

export function sanitizeWebhookPayload(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const sanitized = summarizeValue(value ?? {});
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : {};
}
