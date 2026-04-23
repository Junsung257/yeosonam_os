/**
 * POST /api/admin/booking-tasks/run-now
 *   어드민이 룰 러너를 수동으로 즉시 실행 (테스트/디버깅용)
 *   Vercel Cron 을 기다리지 않고 즉시 검증 가능
 */

import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { runAllRules } from '@/lib/booking-tasks/runner';
import { ALL_RULES } from '@/lib/booking-tasks/rules';

export const maxDuration = 60;

export async function POST(_request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const result = await runAllRules(ALL_RULES, { isForce: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'runner 실행 실패' },
      { status: 500 },
    );
  }
}
