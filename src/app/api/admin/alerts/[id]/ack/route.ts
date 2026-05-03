import { NextResponse } from 'next/server';
import { ackAlert } from '@/lib/admin-alerts';

export const runtime = 'nodejs';

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  const { id } = ctx.params;
  const n = parseInt(id, 10);
  if (!Number.isFinite(n)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  await ackAlert(n);
  return NextResponse.json({ ok: true });
}
