import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { completeCodexMediaJob, isMediaCodexWorkerAuthorized } from '@/lib/media-generation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 10 * 1024 * 1024;

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
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiResponse({ error: 'invalid multipart body' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const workerRunId = String(form.get('worker_run_id') ?? '').trim();
  const visualQaPassed = form.get('visual_qa_passed') === 'true';
  const file = form.get('image');
  if (!/^[a-zA-Z0-9:_-]{8,120}$/.test(workerRunId)) {
    return apiResponse({ error: 'invalid worker_run_id' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!(file instanceof File) || !ALLOWED_TYPES.has(file.type) || file.size < 1 || file.size > MAX_BYTES) {
    return apiResponse({ error: 'PNG/JPEG/WebP image up to 10MB is required' }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!visualQaPassed) {
    return apiResponse({ error: 'explicit worker visual QA pass is required' }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const result = await completeCodexMediaJob({
      id,
      workerRunId,
      workerVisualQaPassed: visualQaPassed,
      imageBytes: Buffer.from(await file.arrayBuffer()),
    });
    return apiResponse(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'media job completion failed';
    const status = /not found/i.test(message) ? 404 : /lease|generating/i.test(message) ? 409 : /image|QA/i.test(message) ? 422 : 500;
    return apiResponse({ error: message.slice(0, 180) }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
