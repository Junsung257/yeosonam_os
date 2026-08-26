import { randomUUID } from 'node:crypto';
import pino, { type DestinationStream, type Logger } from 'pino';
import type { NextRequest } from 'next/server';
import { redactKoreanPII } from '@/lib/pii-redactor';

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2_000;

const SENSITIVE_KEY = /(?:authorization|cookie|set-cookie|password|passwd|secret|token|api[_-]?key|service[_-]?role|private[_-]?key|credential|session)/i;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bysn_[A-Za-z0-9_-]{10,}\b/g,
  /\bsk-[A-Za-z0-9_-]{10,}\b/g,
  /\b(?:sk|pk)_[A-Za-z0-9_-]{10,}\b/g,
  /:\/\/[^\s/:@]+:[^\s/@]+@/g,
];

export type StructuredLogContext = Record<string, unknown>;

function sanitizeString(value: string): string {
  let sanitized = redactKoreanPII(value).redacted;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    sanitized = sanitized.replace(pattern, REDACTED);
  }
  if (sanitized.length > MAX_STRING_LENGTH) {
    return `${sanitized.slice(0, MAX_STRING_LENGTH)}...[truncated]`;
  }
  return sanitized;
}

function sanitizeUnknown(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol' || typeof value === 'function') return String(value);
  if (depth >= MAX_DEPTH) return '[MAX_DEPTH]';

  if (value instanceof Error) {
    return {
      type: value.name,
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
    };
  }

  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map(item => sanitizeUnknown(item, depth + 1, seen));
  }
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[CIRCULAR]';

  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key)
      ? REDACTED
      : sanitizeUnknown(item, depth + 1, seen);
  }
  seen.delete(value);
  return output;
}

export function sanitizeLogContext(value: unknown): unknown {
  return sanitizeUnknown(value, 0, new WeakSet<object>());
}

export function createStructuredLogger(options: {
  destination?: DestinationStream;
  level?: string;
  bindings?: StructuredLogContext;
} = {}): Logger {
  const loggerOptions: pino.LoggerOptions = {
    level: options.level ?? process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
    base: {
      service: 'yeosonam-os',
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
      ...(sanitizeLogContext(options.bindings ?? {}) as StructuredLogContext),
    },
    formatters: {
      level: label => ({ level: label }),
      log: object => sanitizeLogContext(object) as StructuredLogContext,
    },
    redact: {
      paths: [
        'authorization',
        'cookie',
        'password',
        'secret',
        'token',
        'apiKey',
        'api_key',
        'req.headers.authorization',
        'req.headers.cookie',
        'request.headers.authorization',
        'request.headers.cookie',
      ],
      censor: REDACTED,
    },
  };

  return options.destination
    ? pino(loggerOptions, options.destination)
    : pino(loggerOptions);
}

export const serverLogger = createStructuredLogger();

export interface ApiRequestLogContext {
  logger: Logger;
  requestId: string;
}

function resolveRequestId(request: NextRequest): string {
  const supplied = request.headers.get('x-request-id')?.trim();
  return supplied && REQUEST_ID.test(supplied) ? supplied : randomUUID();
}

export async function observeApiRequest(
  request: NextRequest,
  handler: (context: ApiRequestLogContext) => Promise<Response>,
  bindings: StructuredLogContext = {},
): Promise<Response> {
  const startedAt = performance.now();
  const requestId = resolveRequestId(request);
  const requestLogger = serverLogger.child(sanitizeLogContext({
    request_id: requestId,
    route: request.nextUrl.pathname,
    method: request.method,
    ...bindings,
  }) as StructuredLogContext);

  try {
    const response = await handler({ logger: requestLogger, requestId });
    response.headers.set('x-request-id', requestId);
    requestLogger.info({
      event: 'api.request.completed',
      status_code: response.status,
      duration_ms: Math.round(performance.now() - startedAt),
    });
    return response;
  } catch (error) {
    requestLogger.error({
      event: 'api.request.failed',
      duration_ms: Math.round(performance.now() - startedAt),
      err: error,
    });
    throw error;
  }
}
