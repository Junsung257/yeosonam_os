/**
 * USD → KRW 환율 조회 유틸리티
 * 우선순위: 1) 외부 API → 2) Supabase 캐시 (24h TTL) → 3) 폴백 1,400
 */
import { createClient } from '@supabase/supabase-js';

const FALLBACK_RATE = 1400;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24시간

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** 외부 API에서 환율 조회 (exchangerate-api.com 무료 플랜) */
async function fetchRateFromApi(): Promise<number | null> {
  try {
    const apiKey = process.env.EXCHANGE_RATE_API_KEY;
    const url = apiKey
      ? `https://v6.exchangerate-api.com/v6/${apiKey}/pair/USD/KRW`
      : 'https://open.er-api.com/v6/latest/USD'; // 무료 플랜 (API 키 불필요)

    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const json = await res.json();

    // open.er-api 응답: { rates: { KRW: 1380.5 } }
    // v6.exchangerate-api 응답: { conversion_rate: 1380.5 }
    const rate = json.conversion_rate ?? json.rates?.KRW ?? null;
    return typeof rate === 'number' && rate > 0 ? Math.round(rate) : null;
  } catch {
    return null;
  }
}

/** Supabase app_settings 캐시에서 환율 조회 */
async function fetchRateFromCache(): Promise<number | null> {
  try {
    const sb = getSupabase();
    if (!sb) return null;

    const { data } = await sb
      .from('app_settings')
      .select('value')
      .eq('key', 'exchange_rate_cache')
      .single();

    if (!data?.value) return null;
    const { rate, cached_at } = data.value as { rate: number; cached_at: string };
    if (!rate || !cached_at) return null;

    const age = Date.now() - new Date(cached_at).getTime();
    if (age > CACHE_TTL_MS) return null; // 만료
    return rate;
  } catch {
    return null;
  }
}

/** Supabase app_settings 캐시에 환율 저장 */
async function saveRateToCache(rate: number): Promise<void> {
  try {
    const sb = getSupabase();
    if (!sb) return;
    await sb.from('app_settings').upsert({
      key: 'exchange_rate_cache',
      value: { rate, cached_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });
  } catch {
    // 캐시 저장 실패는 무시
  }
}

/**
 * 현재 USD/KRW 환율 반환
 * 실패 시 폴백 1,400 사용
 */
export async function getUsdToKrwRate(): Promise<number> {
  // 1. 캐시 확인
  const cached = await fetchRateFromCache();
  if (cached) return cached;

  // 2. 외부 API 호출
  const fresh = await fetchRateFromApi();
  if (fresh) {
    await saveRateToCache(fresh);
    return fresh;
  }

  // 3. 폴백
  return FALLBACK_RATE;
}

/**
 * USD 금액을 KRW로 변환 (정수 반환)
 */
export async function usdToKrw(usdAmount: number): Promise<number> {
  const rate = await getUsdToKrwRate();
  return Math.round(usdAmount * rate);
}

/**
 * 클라이언트에서 사용할 환율 조회 API 엔드포인트용 (서버 사이드에서만 호출)
 */
export async function getRateInfo(): Promise<{ rate: number; source: string }> {
  const cached = await fetchRateFromCache();
  if (cached) return { rate: cached, source: 'cache' };

  const fresh = await fetchRateFromApi();
  if (fresh) {
    await saveRateToCache(fresh);
    return { rate: fresh, source: 'api' };
  }

  return { rate: FALLBACK_RATE, source: 'fallback' };
}
