import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { isSupabaseConfigured } from '@/lib/supabase';
import { fitLandOperatorReliability } from '@/lib/scoring/reliability-fit';
import { logError } from '@/lib/sentry-logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ skipped: true, reason: 'Supabase 미설정' });
  }
  if (!isCronAuthorized(req)) {
    return cronUnauthorizedResponse();
  }
  const startedAt = Date.now();
  try {
    const result = await fitLandOperatorReliability();
    return NextResponse.json({ ok: true, ms: Date.now() - startedAt, ...result });
  } catch (e) {
    logError('[cron/land-operator-reliability] fitting failed', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed' },
      { status: 500 },
    );
  }
}
