/**
 * GET /api/cron/visual-baseline-monitor
 *
 * Vercel Cron 이 주기적으로 호출.
 * Playwright 는 Vercel serverless 에서 실행 불가 → 대신 "큐 상태 감시 + 알림" 역할:
 *   - baseline_requested_at > baseline_created_at + 24h 경과한 상품 찾기
 *   - 즉, GitHub Action 이 24시간째 처리 못한 건
 *   - 있으면 Slack / 알림톡 발송 (getNotificationAdapter)
 *
 * vercel.json cron 설정:
 *   { "path": "/api/cron/visual-baseline-monitor", "schedule": "0 9 * * *" }
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  // Vercel Cron 인증 (Authorization: Bearer ${CRON_SECRET})
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // 24시간 이상 처리 안 된 baseline 큐 조회
    type StaleRow = {
      id: string;
      title: string | null;
      short_code: string | null;
      status: string | null;
      baseline_requested_at: string | null;
      baseline_created_at: string | null;
    };
    const { data: stale, error } = await supabaseAdmin
      .from('travel_packages')
      .select('id, title, short_code, status, baseline_requested_at, baseline_created_at')
      .not('baseline_requested_at', 'is', null)
      .lt('baseline_requested_at', twentyFourHoursAgo)
      .in('status', ['approved', 'active'])
      .or('baseline_created_at.is.null,baseline_created_at.lt.baseline_requested_at');

    if (error) throw error;

    const staleRows = (stale || []) as StaleRow[];
    const staleCount = staleRows.filter((p: StaleRow) =>
      !p.baseline_created_at ||
      (p.baseline_requested_at && new Date(p.baseline_created_at) < new Date(p.baseline_requested_at))
    ).length;

    const result = {
      checked_at: new Date().toISOString(),
      stale_baselines: staleCount,
      items: staleRows.slice(0, 10).map((p: StaleRow) => ({
        id: p.id,
        title: p.title,
        short_code: p.short_code,
        requested_at: p.baseline_requested_at,
        last_created_at: p.baseline_created_at,
      })),
    };

    // 알림 발송 (옵션)
    if (staleCount > 0 && process.env.SLACK_WEBHOOK_URL) {
      try {
        await fetch(process.env.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `⚠️ Visual Baseline ${staleCount}건 24h+ 처리 대기\n` +
                  staleRows.slice(0, 5).map((p: StaleRow) => `- ${p.short_code} | ${p.title}`).join('\n') +
                  `\n\nGitHub Actions 상태 확인 필요.`,
          }),
        });
      } catch (e) {
        console.warn('Slack webhook failed:', e);
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'monitor failed' },
      { status: 500 },
    );
  }
}
