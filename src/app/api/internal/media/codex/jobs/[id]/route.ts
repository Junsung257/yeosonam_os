import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { getCodexMediaJobStatus, isMediaCodexWorkerAuthorized } from '@/lib/media-generation';

export const dynamic = 'force-dynamic';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
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
  const job = await getCodexMediaJobStatus(id);
  if (!job) return apiResponse({ error: 'media job not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return apiResponse({ job }, { headers: { 'Cache-Control': 'no-store' } });
}
