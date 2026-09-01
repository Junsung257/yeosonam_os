import { type NextRequest } from 'next/server';

import { apiResponse } from '@/lib/api-response';
import { createAgentTaskIdempotently } from '@/lib/agent/tasking';
import { isResearchNodeAuthorized } from '@/lib/research/research-node-auth';
import { rateLimit } from '@/lib/rate-limiter';
import {
  buildResearchSignalTaskEnvelope,
  parseResearchSignalEnvelopeV1,
} from '@/lib/research/research-signal';
import { isSupabaseAdminConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  if (!isResearchNodeAuthorized(request)) {
    return apiResponse({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }
  const limited = await rateLimit(request, {
    limit: 60,
    window: 60,
    prefix: 'rl-research-intake',
    failClosed: true,
  });
  if (limited) {
    limited.headers.set('Cache-Control', 'no-store');
    return limited;
  }
  if (!isSupabaseAdminConfigured) {
    return apiResponse({ error: 'Research intake unavailable' }, { status: 503, headers: NO_STORE });
  }
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return apiResponse({ error: 'Content-Type must be application/json' }, { status: 415, headers: NO_STORE });
  }

  const declaredBytes = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES) {
    return apiResponse({ error: 'Payload too large' }, { status: 413, headers: NO_STORE });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return apiResponse({ error: 'Invalid request body' }, { status: 400, headers: NO_STORE });
  }
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return apiResponse({ error: 'Payload too large' }, { status: 413, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return apiResponse({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
  }

  const parsed = parseResearchSignalEnvelopeV1(body);
  if (!parsed.success) {
    return apiResponse(
      { error: 'Invalid research signal', issues: parsed.issues },
      { status: 422, headers: NO_STORE },
    );
  }

  try {
    const task = await createAgentTaskIdempotently(buildResearchSignalTaskEnvelope(parsed.data));
    console.log(JSON.stringify({
      level: 'info',
      message: 'research signal accepted',
      route: '/api/internal/research/signals',
      taskId: task.id,
      duplicate: task.duplicate,
      platform: parsed.data.sourcePlatform,
      contentHashPrefix: parsed.data.contentHash.slice(0, 20),
      durationMs: Date.now() - startedAt,
    }));
    return apiResponse(
      {
        task_id: task.id,
        status: task.status,
        duplicate: task.duplicate,
        review_status: 'review_required',
      },
      { status: task.duplicate ? 200 : 202, headers: NO_STORE },
    );
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'research signal intake failed',
      route: '/api/internal/research/signals',
      error: error instanceof Error ? error.message.slice(0, 180) : 'unknown',
      durationMs: Date.now() - startedAt,
    }));
    return apiResponse({ error: 'Research intake failed' }, { status: 500, headers: NO_STORE });
  }
}
