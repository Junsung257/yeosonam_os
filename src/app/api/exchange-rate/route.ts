/**
 * Phase 2-F: 환율 조회 API
 * GET /api/exchange-rate          → 오늘 환율
 * GET /api/exchange-rate?date=YYYY-MM-DD → 특정 날짜 환율
 *
 * 우선순위: 1) fx_rate_snapshots DB → 2) open.er-api 실시간 → 3) 폴백 1,400
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const FALLBACK_RATE = 1400;
const FX_API_URL = 'https://open.er-api.com/v6/latest/USD';

async function fetchLiveRate(): Promise<number | null> {
  try {
    const res = await fetch(FX_API_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json() as { result?: string; rates?: Record<string, number> };
    const rate = json.rates?.KRW;
    return typeof rate === 'number' && rate > 0 ? Math.round(rate * 100) / 100 : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const dateParam = searchParams.get('date');

  // YYYY-MM-DD 검증
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const targetDate =
    dateParam && dateRegex.test(dateParam)
      ? dateParam
      : new Date().toISOString().split('T')[0];

  // 1. DB 스냅샷 조회
  if (isSupabaseConfigured) {
    try {
      const { data } = await supabaseAdmin
        .from('fx_rate_snapshots')
        .select('usd_to_krw, source, snapshot_date')
        .eq('snapshot_date', targetDate)
        .limit(1);

      if (data?.[0]) {
        return NextResponse.json({
          date: data[0].snapshot_date,
          usd_to_krw: data[0].usd_to_krw,
          source: data[0].source,
        });
      }
    } catch {
      // DB 실패 시 다음 단계로 fallthrough
    }
  }

  // 2. 오늘 날짜 요청인 경우에만 실시간 조회 (과거 날짜는 API가 최신 환율만 반환)
  const today = new Date().toISOString().split('T')[0];
  if (targetDate === today) {
    const liveRate = await fetchLiveRate();
    if (liveRate) {
      // 조회한 환율을 DB에 저장 (백그라운드, 실패해도 무관)
      if (isSupabaseConfigured) {
        supabaseAdmin
          .from('fx_rate_snapshots')
          .upsert(
            { snapshot_date: today, usd_to_krw: liveRate, source: 'open-exchange' },
            { onConflict: 'snapshot_date' },
          )
          .then(() => {})
          .catch(() => {});
      }
      return NextResponse.json({ date: today, usd_to_krw: liveRate, source: 'live' });
    }
  }

  // 3. 폴백
  return NextResponse.json({
    date: targetDate,
    usd_to_krw: FALLBACK_RATE,
    source: 'fallback',
  });
}
