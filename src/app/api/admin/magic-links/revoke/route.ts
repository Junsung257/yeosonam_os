/**
 * POST /api/admin/magic-links/revoke — 발급된 토큰 강제 폐기.
 *
 * Body: { tokenId: string, reason?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard, resolveAdminActorLabel } from '@/lib/admin-guard';
import { revokeMagicToken } from '@/lib/magic-link';

export const POST = withAdminGuard(async (req: NextRequest) => {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const tokenId = typeof body.tokenId === 'string' ? body.tokenId : null;
  if (!tokenId) return NextResponse.json({ error: 'token_id_required' }, { status: 400 });

  const reason = typeof body.reason === 'string' && body.reason.trim()
    ? body.reason.trim().slice(0, 200)
    : 'admin_revoke';

  const actor = await resolveAdminActorLabel(req);
  await revokeMagicToken(tokenId, reason, actor);
  return NextResponse.json({ ok: true });
});
