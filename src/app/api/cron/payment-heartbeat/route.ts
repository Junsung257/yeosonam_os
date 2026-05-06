/**
 * GET /api/cron/payment-heartbeat
 *
 * 🎯 목적: Slack 은행 인제스트가 살아있는지 확인 + 24h 미처리 레코드 에스컬레이션
 *
 * 감시 대상:
 *   [1] 영업시간(09:00~20:00 KST)에 N시간 연속 slack 수신 없음
 *       → 웹훅 파이프라인 장애 가능성 → 관리자에게 알림
 *   [2] 24시간 이상 match_status in ('unmatched','review','error') 로 방치된 거래
 *       → 주인 없는 돈이 쌓이고 있음 → 매일 1회 요약 알림
 *   [3] slack_raw_events.parse_status='dead' 가 새로 발생
 *       → 파서가 포기한 원문 — 어드민 수동 검토 필요
 *
 * Vercel Cron: 매 30분 (*\/30 * * * *)
 *
 * 알림 채널:
 *   - dispatchPushAsync() — 관리자 웹/모바일 푸시
 *   - 슬랙 메시지 (SLACK_ALERT_WEBHOOK_URL 설정 시)
 *
 * Heartbeat 임계값:
 *   - 평일 영업시간 기준 2시간 무음 → 경고
 *   - 주말/야간은 스킵 (오탐 방지)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { sendSlackAlert } from '@/lib/slack-alert';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SILENCE_WARN_HOURS = 2; // 영업시간 내 이 시간 무음이면 경고
const STALE_HOURS = 24;

function getKSTHour(): number {
  return (new Date().getUTCHours() + 9) % 24;
}

function isKSTWeekend(): boolean {
  // Date.getUTCDay() 기준으로 KST 요일 계산
  const utcDay = new Date().getUTCDay();
  const kstHour = new Date().getUTCHours() + 9;
  const kstDay = kstHour >= 24 ? (utcDay + 1) % 7 : utcDay;
  return kstDay === 0 || kstDay === 6;
}

function isBusinessHours(): boolean {
  const h = getKSTHour();
  return h >= 9 && h < 20 && !isKSTWeekend();
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const alerts: string[] = [];
  const summary = {
    kst_hour: getKSTHour(),
    business_hours: isBusinessHours(),
    last_slack_event_at: null as string | null,
    silence_hours: 0,
    stale_count: 0,
    stale_total_amount: 0,
    dead_count: 0,
    alerts_sent: 0,
  };

  try {
    // ── [1] 마지막 Slack 수신 시각 ──────────────────────────────────────────
    const { data: lastRow } = await supabaseAdmin
      .from('slack_raw_events')
      .select('received_at')
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastAt = (lastRow as any)?.received_at as string | undefined;
    summary.last_slack_event_at = lastAt ?? null;
    const silenceHours = lastAt ? (Date.now() - new Date(lastAt).getTime()) / 3600_000 : 999;
    summary.silence_hours = Number(silenceHours.toFixed(2));

    if (summary.business_hours && silenceHours >= SILENCE_WARN_HOURS) {
      const lastStr = lastAt ? new Date(lastAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '기록 없음';
      alerts.push(
        `🔕 *Slack 입출금 수신 무음 ${silenceHours.toFixed(1)}시간 지속*\n` +
        `• 마지막 수신: ${lastStr}\n` +
        `• 확인사항: Clobe.ai 봇 상태, Slack 웹훅 설정, Supabase 연결\n` +
        `• 백업: /api/cron/slack-gap-fill 이 15분마다 자동 복구 중`,
      );
    }

    // ── [2] 24h 이상 미처리 거래 ───────────────────────────────────────────
    const { data: stale } = await supabaseAdmin.rpc('get_stale_bank_transactions', { hours: STALE_HOURS });
    const staleRows = (stale || []) as Array<{ id: string; amount: number; counterparty_name: string; hours_stale: number; match_status: string }>;

    summary.stale_count = staleRows.length;
    summary.stale_total_amount = staleRows.reduce((s: number, r: Record<string, unknown>) => s + (Number(r.amount) || 0), 0);

    // 매일 1회만 알림 (매 실행마다 보내면 스팸) — KST 09:30~10:00 범위에서만
    const h = getKSTHour();
    const m = new Date().getUTCMinutes();
    const isMorningDigest = h === 9 && m >= 30 && m < 60;

    if (staleRows.length > 0 && isMorningDigest) {
      const top5 = staleRows.slice(0, 5)
        .map(r => `  • ${r.counterparty_name} ${r.amount.toLocaleString()}원 (${Math.round(r.hours_stale)}h, ${r.match_status})`)
        .join('\n');
      alerts.push(
        `⏰ *24시간 이상 미처리 거래 ${staleRows.length}건 (총 ${summary.stale_total_amount.toLocaleString()}원)*\n${top5}` +
        (staleRows.length > 5 ? `\n  ... 외 ${staleRows.length - 5}건` : '') +
        `\n\n어드민 → 입금 관리에서 확인`,
      );
    }

    // ── [3] dead 레코드 (파서가 포기한 원문) ────────────────────────────────
    const { data: dead } = await supabaseAdmin
      .from('slack_raw_events')
      .select('id', { count: 'exact', head: false })
      .eq('parse_status', 'dead');
    summary.dead_count = dead?.length ?? 0;

    if (summary.dead_count > 0 && isMorningDigest) {
      alerts.push(
        `💀 *파싱 완전 실패 원문 ${summary.dead_count}건*\n` +
        `• 파서가 최대 재시도 횟수를 초과해 포기한 원문입니다\n` +
        `• 어드민 → 입금 관리 → 시스템 로그에서 원문 확인 필요`,
      );
    }

    // ── [4] 알림 발송 ──────────────────────────────────────────────────────
    for (const msg of alerts) {
      await sendSlackAlert(msg);
      summary.alerts_sent++;
    }

    // 중요 경고는 관리자 push로도 (영업시간 무음만)
    if (alerts.length > 0 && summary.business_hours && silenceHours >= SILENCE_WARN_HOURS) {
      try {
        const { dispatchPushAsync } = await import('@/lib/push-dispatcher');
        dispatchPushAsync({
          title: 'Slack 입출금 수신 중단',
          body: `${silenceHours.toFixed(1)}시간 무음 — 점검 필요`,
          deepLink: '/m/admin/payments',
          kind: 'system_alert',
          tag: 'slack-silence',
        });
      } catch {
        /* push 실패는 무시 */
      }
    }

    return NextResponse.json({ ok: true, ...summary, alerts });
  } catch (e: any) {
    console.error('[payment-heartbeat] 최상위 예외:', e?.message ?? String(e));
    return NextResponse.json({ error: e?.message ?? 'heartbeat 실패' }, { status: 500 });
  }
}
