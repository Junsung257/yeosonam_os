import { ackAlert } from '@/lib/admin-alerts';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const runtime = 'nodejs';

const postHandler = async (_req: Request, ctx: { params: { id: string } }) => {
  const { id } = ctx.params;
  const n = parseInt(id, 10);
  if (!Number.isFinite(n)) return apiResponse({ error: 'invalid id' }, { status: 400 });
  try {
    await ackAlert(n);
    return apiResponse({ ok: true });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err, 'Failed to acknowledge alert') }, { status: 500 });
  }
}

export const POST = withAdminGuard(postHandler);
