import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { rateLimitMutation } from '@/lib/rate-limiter';
import {
  persistRevenueFunnelEvent,
  validateRevenueFunnelEventInput,
} from '@/lib/revenue-funnel-events';

const MAX_BODY_BYTES = 16_384;

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const limited = await rateLimitMutation(request);
  if (limited) return limited;

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return apiResponse(
      { ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: '요청이 너무 큽니다.', requestId } },
      { status: 413, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiResponse(
      { ok: false, error: { code: 'INVALID_JSON', message: '요청 형식이 올바르지 않습니다.', requestId } },
      { status: 400, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
    );
  }
  if (JSON.stringify(body).length > MAX_BODY_BYTES) {
    return apiResponse(
      { ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: '요청이 너무 큽니다.', requestId } },
      { status: 413, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
    );
  }

  const validated = validateRevenueFunnelEventInput(body);
  if (!validated.ok) {
    return apiResponse(
      {
        ok: false,
        error: {
          code: validated.code,
          message: validated.message,
          requestId,
        },
      },
      { status: 400, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
    );
  }

  const result = await persistRevenueFunnelEvent(validated.value);
  if (!result.ok) {
    console.error('[revenue-events] persistence failed', { requestId, error: result.error });
    return apiResponse(
      {
        ok: false,
        error: {
          code: 'EVENT_SAVE_FAILED',
          message: '전환 이벤트를 저장하지 못했습니다.',
          requestId,
        },
      },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
    );
  }

  return apiResponse(
    { ok: true, accepted: true, requestId },
    { status: 202, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
  );
}
