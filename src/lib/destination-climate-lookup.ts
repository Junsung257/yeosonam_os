import { supabaseAdmin } from '@/lib/supabase';

/**
 * destination 텍스트 정규화 — 모바일 상세 climate 조인용 폴백.
 *
 * 박제 사유 (2026-05-16):
 *   - `page.tsx` 가 `eq('destination', pkg.destination)` 로 완전일치 조인 → "계림/양삭",
 *     "일본 (시모노세키, 후쿠오카)" 처럼 사람 손글씨로 들어온 destination 이 시드와 어긋나
 *     날씨·시차·짐싸기 카드 3종이 통째 사라지는 사고가 반복.
 *   - 시드는 alias 까지 다 박을 수 없으니, lookup 측에서 안전한 폴백 키를 시도한다.
 *
 * 폴백 순서:
 *   1) 입력 그대로 (가장 정확)
 *   2) 공백·구분자 정규화 (`,`/`·`/`ㆍ` → `/`, 다중 공백 trim)
 *   3) 첫 토큰만 (`/` 또는 `,` 또는 공백 직전)
 *   4) 괄호·꺽쇠 제거 후 토큰 1개
 *
 * 시드에 없으면 null. 호출자는 climate 카드들을 조용히 숨김.
 */

export type DestinationClimateRow = {
  destination: string;
  primary_city: string;
  country: string | null;
  lat: number;
  lon: number;
  timezone: string;
  utc_offset_minutes: number;
  monthly_normals: unknown;
  fitness_scores: unknown;
  seasonal_signals: unknown;
};

const CLIMATE_COLS =
  'destination, primary_city, country, lat, lon, timezone, utc_offset_minutes, monthly_normals, fitness_scores, seasonal_signals';

/** destination 정규화 후 가능한 lookup 키 목록을 우선순위대로 반환 (중복 제거). */
export function destinationLookupKeys(raw: string): string[] {
  const keys: string[] = [];
  const push = (s: string | null | undefined) => {
    if (!s) return;
    const t = s.trim();
    if (t && !keys.includes(t)) keys.push(t);
  };

  push(raw);

  // 1차 정규화: 구분자 통일
  const unified = raw
    .replace(/[ㆍ·,]/g, '/')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
  push(unified);

  // 괄호·꺽쇠·대괄호 제거
  const noBracket = unified.replace(/[()<>\[\]【】「」『』]/g, ' ').replace(/\s+/g, ' ').trim();
  push(noBracket);

  // 첫 토큰만 — "/", " " 기준
  const firstSlash = unified.split('/')[0]?.trim();
  push(firstSlash);
  const firstWord = (noBracket.split(/\s+/)[0] ?? '').trim();
  push(firstWord);

  return keys.filter(Boolean);
}

/**
 * 정규화 lookup. 첫 hit 즉시 반환.
 * 시드에 없으면 null — 호출자는 카드 숨김.
 *
 * 2026-05-16 박제: silent fail 차단 ([[feedback-silent-failure-forbidden]]).
 *   lookup 0건/에러는 fire-and-forget admin_alerts 로 기록.
 *   사장님이 어드민에서 "이 destination 의 climate 가 production 에서 안 받힌다" 즉시 확인 가능.
 *   record 실패는 throw 금지 (page.tsx 흐름 차단 방지).
 */
export async function resolveDestinationClimate(
  rawDestination: string | null | undefined,
): Promise<DestinationClimateRow | null> {
  if (!rawDestination) return null;
  const keys = destinationLookupKeys(rawDestination);
  if (keys.length === 0) return null;

  const { data, error } = await supabaseAdmin
    .from('destination_climate')
    .select(CLIMATE_COLS)
    .in('destination', keys);

  if (error) {
    void recordClimateLookupAlert({ rawDestination, keys, reason: 'query_error', detail: error.message });
    return null;
  }
  if (!data || data.length === 0) {
    void recordClimateLookupAlert({ rawDestination, keys, reason: 'zero_hits', detail: null });
    return null;
  }

  // 우선순위 보존: keys 순서대로 첫 매치 반환
  const byKey = new Map<string, DestinationClimateRow>();
  for (const row of data as unknown as DestinationClimateRow[]) {
    byKey.set(row.destination, row);
  }
  for (const k of keys) {
    const hit = byKey.get(k);
    if (hit) return hit;
  }
  return (data[0] as unknown as DestinationClimateRow) ?? null;
}

/**
 * fire-and-forget admin_alerts INSERT. 실패는 console.warn 만.
 * 중복 폭주 방지: 같은 destination 의 동일 reason 은 5분 dedup (created_at 검사).
 */
async function recordClimateLookupAlert(p: {
  rawDestination: string;
  keys: string[];
  reason: 'zero_hits' | 'query_error';
  detail: string | null;
}): Promise<void> {
  try {
    // dedup: 같은 destination + reason 이 최근 5분 안에 있으면 skip
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from('admin_alerts')
      .select('id')
      .eq('category', 'climate_lookup_miss')
      .eq('ref_id', p.rawDestination)
      .gte('created_at', fiveMinAgo)
      .limit(1);
    if (recent && recent.length > 0) return;

    await supabaseAdmin.from('admin_alerts').insert({
      category: 'climate_lookup_miss',
      severity: 'warning',
      title: p.reason === 'query_error'
        ? `climate query error · ${p.rawDestination}`
        : `climate 0 hits · ${p.rawDestination}`,
      message: p.reason === 'query_error'
        ? `destination_climate query error: ${p.detail ?? '(no detail)'}`
        : `destination_climate 0 hits for keys: ${p.keys.join(' | ')}`,
      ref_type: 'destination',
      ref_id: p.rawDestination,
      meta: { keys: p.keys, reason: p.reason, detail: p.detail },
    });
  } catch (e) {
    console.warn('[climate-lookup-alert] insert failed:', e instanceof Error ? e.message : 'unknown');
  }
}
