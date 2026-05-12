/**
 * 어드민 API 응답용 Cache-Control 헤더 프리셋.
 *
 * 감사: docs/audits/2026-05-11-admin-perf-audit.md (Phase 0~3)
 *
 * 어드민은 인증 필요 → `private` 만 사용. CDN(`s-maxage`) 은 그대로 활용 가능
 * (Vercel CDN 은 인증 우회 없이 캐시 키에 쿠키 포함).
 *
 * 사용:
 *   return NextResponse.json(data, { headers: ADMIN_CACHE.list });
 *
 * 또는 헤더만:
 *   return NextResponse.json(data, { headers: cacheControl(ADMIN_CACHE.hot) });
 */

export interface AdminCachePreset {
  /** 'Cache-Control' 헤더 값 */
  cacheControl: string;
  /** 사람이 읽는 정책 설명 */
  rationale: string;
}

export const ADMIN_CACHE_PRESETS = {
  /** 사이드바 배지 등 hot path — 30s 브라우저 / 60s CDN / 5분 SWR */
  hot: {
    cacheControl: 'private, max-age=30, s-maxage=60, stale-while-revalidate=300',
    rationale: '실시간성 중간 (배지·요약 수). 60s 캐시로 페이지간 이동 시 즉시 표시.',
  },
  /** 분석·코호트 — 2분 브라우저 / 5분 CDN / 10분 SWR */
  analytics: {
    cacheControl: 'private, max-age=120, s-maxage=300, stale-while-revalidate=600',
    rationale: '코호트·LTV 등 실시간 X. 5분 stale 허용. 동일 사용자 재진입 즉시.',
  },
  /** 어드민 목록 (bookings/customers) — 30s/60s/5분 */
  list: {
    cacheControl: 'private, max-age=30, s-maxage=60, stale-while-revalidate=300',
    rationale: '어드민 목록 — 30s stale 허용 (CRUD 직후는 SWR mutate() 로 강제 갱신).',
  },
  /** 단건 상세 (packages/bookings by id) — 5분 / 10분 */
  detail: {
    cacheControl: 'public, s-maxage=300, stale-while-revalidate=600',
    rationale: '공개 상세 — 인증 무관 정적 가까운 데이터.',
  },
  /** 환경 정보 (환율·feature flag 등) — 10분 / 1시간 */
  config: {
    cacheControl: 'public, s-maxage=600, stale-while-revalidate=3600',
    rationale: '환율·플랫폼 설정 — 10분 stale.',
  },
} as const satisfies Record<string, AdminCachePreset>;

export type AdminCachePresetName = keyof typeof ADMIN_CACHE_PRESETS;

/** {Cache-Control: …} 객체 반환 — NextResponse 의 headers 옵션에 spread. */
export function cacheControl(preset: AdminCachePreset | AdminCachePresetName): { 'Cache-Control': string } {
  const p = typeof preset === 'string' ? ADMIN_CACHE_PRESETS[preset] : preset;
  return { 'Cache-Control': p.cacheControl };
}

/** 편의: 자주 쓰는 프리셋 직접 export */
export const ADMIN_CACHE = {
  hot: cacheControl('hot'),
  analytics: cacheControl('analytics'),
  list: cacheControl('list'),
  detail: cacheControl('detail'),
  config: cacheControl('config'),
};
