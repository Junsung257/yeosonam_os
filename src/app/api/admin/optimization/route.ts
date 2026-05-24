/**
 * ══════════════════════════════════════════════════════════
 * POST /api/admin/optimization — 입찰 최적화 루프 수동/자동 실행
 * ══════════════════════════════════════════════════════════
 *
 * Vercel Cron Jobs 설정 (vercel.json):
 *   {
 *     "crons": [
 *       {
 *         "path": "/api/admin/optimization",
 *         "schedule": "0 6 * * *"
 *       }
 *     ]
 *   }
 *   → 매일 오전 6시 KST 자동 실행
 *
 * 보안: CRON_SECRET 헤더로 인증
 *   Authorization: Bearer {CRON_SECRET}
 */

import { NextResponse } from 'next/server';
import { loadKeywords } from '@/lib/keyword-brain';
import { runDailyOptimization, isOverDailyLimit, emergencyBudgetPause } from '@/lib/optimization-loop';

export async function POST(request: Request) {
  try {
    // ── 인증 ──────────────────────────────────────────
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: '인증 실패' },
        { status: 401 },
      );
    }

    // ── 키워드 로드 ──────────────────────────────────
    const keywords = loadKeywords();
    if (keywords.length === 0) {
      return NextResponse.json({
        status: 'skipped',
        reason: '로드된 키워드 없음',
      });
    }

    // ── 예산 확인 ──────────────────────────────────────
    const totalSpend = keywords.reduce((sum, k) => sum + k.spend, 0);
    if (isOverDailyLimit(totalSpend)) {
      await emergencyBudgetPause(keywords);
      return NextResponse.json({
        status: 'budget_pause',
        totalSpend,
        message: '일일 예산 초과 — 저성과 키워드 긴급 정지',
      });
    }

    // ── 최적화 루프 실행 ───────────────────────────────
    const result = await runDailyOptimization(keywords);

    return NextResponse.json({
      status: 'completed',
      ...result,
    });
  } catch (err) {
    console.error('[api/optimization] 오류:', err);
    return NextResponse.json(
      {
        status: 'error',
        error: err instanceof Error ? err.message : '알 수 없는 오류',
      },
      { status: 500 },
    );
  }
}

/**
 * GET — 상태 확인용
 */
export async function GET() {
  return NextResponse.json({
    service: 'keyword-optimization-loop',
    version: 'phase-1',
    description: '매일 06:00 KST 자동 실행. Search Terms 수집 → 네거티브 키워드 추가 → 입찰 최적화',
    cronSchedule: '0 6 * * *',
  });
}
