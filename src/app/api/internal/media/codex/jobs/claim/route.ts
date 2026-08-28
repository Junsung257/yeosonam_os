import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import {
  claimNextCodexMediaJob,
  isMediaCodexEnabled,
  isMediaCodexWorkerAuthorized,
  readCodexDailyUsage,
} from '@/lib/media-generation';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isMediaCodexWorkerAuthorized(request)) {
    return apiResponse({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!isMediaCodexEnabled()) {
    return apiResponse(
      { error: 'Codex subscription media generation is disabled' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  let body: { worker_run_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'invalid json' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const workerRunId = typeof body.worker_run_id === 'string' ? body.worker_run_id.trim() : '';
  if (!/^[a-zA-Z0-9:_-]{8,120}$/.test(workerRunId)) {
    return apiResponse({ error: 'invalid worker_run_id' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const job = await claimNextCodexMediaJob(workerRunId);
    const usage = await readCodexDailyUsage();
    return apiResponse({ job, usage }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'media job claim failed';
    return apiResponse({ error: message.slice(0, 180) }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
