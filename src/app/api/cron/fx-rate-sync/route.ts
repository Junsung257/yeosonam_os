/**
 * Phase 2-F: 환율 스냅샷 수집 크론
 * 매일 1회 실행 — open.er-api.com (무료, 키 불필요) 에서 USD→KRW 환율 조회 후
 * fx_rate_snapshots 테이블에 upsert.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { sendSlackAlert } from '@/lib/slack-alert';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const FX_API_URL = 'https://open.er-api.com/v6/latest/USD';

export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ skipped: true, reason: 'Supabase 미설정' });
  }

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    // 1. 외부 API 호출
    const res = await fetch(FX_API_URL, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`open.er-api HTTP ${res.status}`);
    }

    const raw = await res.json() as {
      result: string;
      rates?: Record<string, number>;
      time_last_update_utc?: string;
    };

    if (raw.result !== 'success' || !raw.rates?.KRW) {
      throw new Error(`API 응답 이상: result=${raw.result}, KRW=${raw.rates?.KRW}`);
    }

    const usdToKrw = Math.round(raw.rates.KRW * 100) / 100; // 소수점 2자리

    // 2. fx_rate_snapshots upsert (같은 날짜 재실행 안전)
    const { error } = await supabaseAdmin
      .from('fx_rate_snapshots')
      .upsert(
        {
          snapshot_date: today,
          usd_to_krw: usdToKrw,
          source: 'open-exchange',
          raw: raw as unknown as Record<string, unknown>,
        },
        { onConflict: 'snapshot_date' },
      );

    if (error) throw error;

    await sendSlackAlert(`[fx-rate-sync] ${today} USD→KRW ${usdToKrw.toLocaleString('ko-KR')} 저장 완료`);

    return NextResponse.json({
      ok: true,
      date: today,
      usd_to_krw: usdToKrw,
      source: 'open-exchange',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sendSlackAlert(`[fx-rate-sync] 실패: ${message}`, { date: today });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
