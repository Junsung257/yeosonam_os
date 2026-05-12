import { NextResponse } from 'next/server';
import { ackAlert } from '@/lib/admin-alerts';
import { withAdminGuard } from '@/lib/admin-guard';

export const runtime = 'nodejs';

const postHandler = async (_req: Request, ctx: { params: { id: string } }) => {
  const { id } = ctx.params;
  const n = parseInt(id, 10);
  if (!Number.isFinite(n)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  await ackAlert(n);
  return NextResponse.json({ ok: true });
}

export const POST = withAdminGuard(postHandler);
