/**
 * Phase 3-H: 사기 탐지 크론
 * GET /api/cron/fraud-detect
 *
 * - 최근 1시간 bookings 조회
 * - detectFraudSignals 적용
 * - 위험 신호 있으면 Slack critical 알림
 *
 * Vercel Cron: 0 * * * * (매시간)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { sendSlackAlert } from '@/lib/slack-alert';
import { detectFraudSignals, maxSeverity, type BookingAttempt } from '@/lib/fraud-detect';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface BookingRow {
  id: string;
  lead_customer_id: string | null;
  total_price: number | null;
  created_at: string;
  ip_address: string | null;
  customers: {
    id: string;
    created_at: string;
  } | null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // 최근 1시간 예약 목록 조회 (ip_address, customer 가입일 포함)
    const { data: bookings, error: fetchErr } = await supabaseAdmin
      .from('bookings')
      .select('id, lead_customer_id, total_price, created_at, ip_address, customers!lead_customer_id(id, created_at)')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true });

    if (fetchErr) throw fetchErr;
    if (!bookings || bookings.length === 0) {
      return NextResponse.json({ ok: true, checked: 0, flagged: 0 });
    }

    const rows = bookings as unknown as BookingRow[];
    const now = Date.now();
    const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;

    // BookingAttempt 변환
    const attempts: BookingAttempt[] = rows.map(b => {
      const customerCreatedAt = (b.customers as { created_at?: string } | null)?.created_at;
      const isNew = customerCreatedAt
        ? now - new Date(customerCreatedAt).getTime() < TWENTY_FOUR_H
        : false;

      return {
        ip: b.ip_address ?? '0.0.0.0',
        amount: b.total_price ?? 0,
        createdAt: b.created_at,
        customerId: b.lead_customer_id ?? b.id,
        isNewCustomer: isNew,
      };
    });

    // 각 예약에 대해 이전 예약들을 context로 사기 탐지 실행
    const flaggedItems: Array<{
      bookingId: string;
      signals: ReturnType<typeof detectFraudSignals>;
      severity: string;
    }> = [];

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      const priorAttempts = attempts.slice(0, i); // 현재 시도 이전 목록
      const signals = detectFraudSignals(attempt, priorAttempts);

      if (signals.length > 0) {
        flaggedItems.push({
          bookingId: rows[i].id,
          signals,
          severity: maxSeverity(signals) ?? 'low',
        });
      }
    }

    if (flaggedItems.length === 0) {
      return NextResponse.json({
        ok: true,
        checked: attempts.length,
        flagged: 0,
        message: '이상 없음',
      });
    }

    // Slack 알림 (high/medium 건들을 묶어서 한 번에)
    const highItems = flaggedItems.filter(f => f.severity === 'high');
    const mediumItems = flaggedItems.filter(f => f.severity === 'medium');

    // ── Phase 9 AA-1 자동 액션 분기 (2026-05-13 박제) ──
    // HIGH severity 자동 격리: bookings.internal_memo 자동 마킹 (사장님이 어드민에서 차단 결정)
    // CRITICAL 은 별도 처리 (현재 maxSeverity 가 'high' 까지만 반환 — fraud-detect.ts 의 enum 따라)
    let autoActions = 0;
    if (highItems.length > 0) {
      const autoActionRows = highItems.map(item => ({
        booking_id: item.bookingId,
        memo: `🚨 자동 사기 격리 [${new Date().toISOString().slice(0,16)}] — ${item.signals.map(s => s.description).join(' / ')}`,
      }));
      for (const a of autoActionRows) {
        await supabaseAdmin.from('bookings')
          .update({
            internal_memo: a.memo,
            updated_at: new Date().toISOString(),
          })
          .eq('id', a.booking_id)
          .then(({ error }: { error: { message: string } | null }) => {
            if (!error) autoActions++;
            else console.warn('[fraud-detect] booking auto-mark 실패:', error.message);
          });
      }
      console.log(`[fraud-detect] AA-1 자동 격리: ${autoActions}/${highItems.length}건`);
    }

    const lines: string[] = [
      `🚨 *사기 탐지 경보*: ${flaggedItems.length}건 위험 신호 감지 (최근 1시간)`,
      '',
    ];

    if (highItems.length > 0) {
      lines.push(`*HIGH (${highItems.length}건)*`);
      for (const item of highItems.slice(0, 5)) {
        const desc = item.signals.map(s => s.description).join(' / ');
        lines.push(`• \`${item.bookingId.slice(0, 8)}\` — ${desc}`);
      }
      if (highItems.length > 5) lines.push(`  ...외 ${highItems.length - 5}건`);
      lines.push('');
    }

    if (mediumItems.length > 0) {
      lines.push(`*MEDIUM (${mediumItems.length}건)*`);
      for (const item of mediumItems.slice(0, 3)) {
        const desc = item.signals.map(s => s.description).join(' / ');
        lines.push(`• \`${item.bookingId.slice(0, 8)}\` — ${desc}`);
      }
      if (mediumItems.length > 3) lines.push(`  ...외 ${mediumItems.length - 3}건`);
    }

    await sendSlackAlert(lines.join('\n'), {
      checked: attempts.length,
      flagged: flaggedItems.length,
      high: highItems.length,
      medium: mediumItems.length,
    });

    return NextResponse.json({
      ok: true,
      checked: attempts.length,
      flagged: flaggedItems.length,
      high: highItems.length,
      medium: mediumItems.length,
      auto_actions: autoActions,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '처리 실패';
    await sendSlackAlert('[사기 탐지 크론] 오류', { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
