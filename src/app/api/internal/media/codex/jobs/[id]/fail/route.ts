import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { failCodexMediaJob, isMediaCodexWorkerAuthorized } from '@/lib/media-generation';

export const dynamic = 'force-dynamic';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!isMediaCodexWorkerAuthorized(request)) {
    return apiResponse({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return apiResponse({ error: 'invalid media job id' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  let body: { worker_run_id?: unknown; error_code?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'invalid json' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const workerRunId = typeof body.worker_run_id === 'string' ? body.worker_run_id.trim() : '';
  const errorCode = typeof body.error_code === 'string' ? body.error_code.trim() : '';
  if (!/^[a-zA-Z0-9:_-]{8,120}$/.test(workerRunId) || !/^[a-zA-Z0-9_-]{3,80}$/.test(errorCode)) {
    return apiResponse({ error: 'invalid worker failure payload' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const result = await failCodexMediaJob({ id, workerRunId, errorCode });
    return apiResponse(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'media job failure update failed';
    const status = /not found/i.test(message) ? 404 : /lease|generating/i.test(message) ? 409 : 500;
    return apiResponse({ error: message.slice(0, 180) }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
