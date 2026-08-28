import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { resolveAdminActorLabel, withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { reviewMediaAsset } from '@/lib/media-generation';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function postHandler(
  request: NextRequest,
  context?: { params?: Promise<{ id: string }> },
) {
  const { id } = await (context?.params ?? Promise.resolve({ id: '' }));
  if (!UUID_RE.test(id)) {
    return apiResponse({ error: 'invalid media asset id' }, { status: 400 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'invalid json' }, { status: 400 });
  }
  const decision = body.decision === 'approved' || body.decision === 'rejected'
    ? body.decision
    : null;
  if (!decision) return apiResponse({ error: 'decision 형식 오류' }, { status: 400 });
  const note = typeof body.note === 'string' ? body.note : null;
  const actor = await resolveAdminActorLabel(request);
  try {
    const asset = await reviewMediaAsset({ id, decision, actor, note });
    return apiResponse({ asset });
  } catch (error) {
    return apiResponse(
      { error: sanitizeDbError(error, '미디어 검수 저장 실패') },
      { status: 500 },
    );
  }
}

export const POST = withAdminGuard(postHandler);
