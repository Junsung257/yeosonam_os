import { NextResponse } from 'next/server';
import { resweepUnmatchedActivities } from '@/lib/unmatched-resweep';

/**
 * unmatched_activities 일일 안전망 sweep — ERR-unmatched-stale-after-alias@2026-04-29
 *
 * PATCH/POST /api/attractions hook 이 attribute id 기반 좁은 sweep 을 즉시 수행하지만,
 * 다음 케이스를 안전망으로 보강:
 *   - 사장님이 Supabase 대시보드에서 직접 attractions 편집 (API 통과 안 함)
 *   - alias 적립 시점 부하 회피로 hook 실패 (best-effort)
 *   - 신규 등록 시점에 매칭 실패한 unmatched 가 attractions 보강 후 stale
 *
 * 하루 1회 실행 (vercel.json crons 등록 권장):
 *   { "path": "/api/cron/resweep-unmatched", "schedule": "0 1 * * *" }
 *
 * 응답:
 *   { ok, scanned, matched, unmatched, errors, durationMs }
 */
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const result = await resweepUnmatchedActivities(); // attractionIds 없으면 전체 sweep
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[cron resweep-unmatched]', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'sweep 실패' },
      { status: 500 },
    );
  }
}
