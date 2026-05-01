import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { fitLandOperatorReliability } from '@/lib/scoring/reliability-fit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ skipped: true, reason: 'Supabase 미설정' });
  }
  const auth = req.headers.get('authorization') ?? '';
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (expected && auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const startedAt = Date.now();
  try {
    const result = await fitLandOperatorReliability();
    return NextResponse.json({ ok: true, ms: Date.now() - startedAt, ...result });
  } catch (e) {
    console.error('[cron/land-operator-reliability] failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed' },
      { status: 500 },
    );
  }
}
