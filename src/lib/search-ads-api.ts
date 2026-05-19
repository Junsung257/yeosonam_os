/**
 * ══════════════════════════════════════════════════════════
 * Search Ads API — 네이버/구글 검색광고 API 래퍼
 * ══════════════════════════════════════════════════════════
 * API 키 미설정 시 mock 데이터 반환 (graceful fallback)
 *
 * 2026-05-19 PR B: 네이버 실제 API 연동 (HMAC-SHA256 서명).
 * 2026-05-19 PR C: 구글 Ads google-ads-api npm 패키지 연동 (OAuth refresh).
 */

import type { SearchAdKeyword, Platform } from './keyword-brain';
import { getSecret } from '@/lib/secret-registry';
import { naverAdsFetch } from './naver-ads/client';

// ── 환경 변수 체크 ───────────────────────────────────────
// 2026-05-19 통일: 서버 전용 키로 마이그레이션 (NEXT_PUBLIC_* 제거 — 클라이언트 번들 노출 위험 차단)
// 네이버 검색광고: API_KEY + SECRET (HMAC 서명 필요) + CUSTOMER_ID 세 가지 모두 필수.
export function isNaverAdsConfigured(): boolean {
  return !!(
    getSecret('NAVER_AD_API_KEY') &&
    getSecret('NAVER_AD_SECRET') &&
    getSecret('NAVER_AD_CUSTOMER_ID')
  );
}

// 구글 Ads: OAuth refresh_token 흐름이므로 4가지 모두 필수
export function isGoogleAdsConfigured(): boolean {
  return !!(
    getSecret('GOOGLE_ADS_DEVELOPER_TOKEN') &&
    getSecret('GOOGLE_ADS_CLIENT_ID') &&
    getSecret('GOOGLE_ADS_CLIENT_SECRET') &&
    getSecret('GOOGLE_ADS_REFRESH_TOKEN') &&
    getSecret('GOOGLE_ADS_CUSTOMER_ID')
  );
}

// ── 공통 성과 데이터 타입 ────────────────────────────────
export interface SearchAdPerformance {
  keywordId: string;
  keyword: string;
  platform: Platform;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  conversions: number;
  spend: number;
  avgPosition: number;
  date: string;
}

// ── Mock 데이터 생성 ─────────────────────────────────────
function generateMockPerformance(keywords: SearchAdKeyword[]): SearchAdPerformance[] {
  return keywords
    .filter(k => k.status === 'active' && k.tier !== 'negative')
    .map(k => {
      const impressions = Math.floor(Math.random() * 5000) + 100;
      const ctr = Math.random() * 8 + 0.5;
      const clicks = Math.floor(impressions * ctr / 100);
      const cpc = k.bid * (0.6 + Math.random() * 0.5);
      const conversions = Math.floor(clicks * (Math.random() * 0.1));
      const spend = Math.round(clicks * cpc);

      return {
        keywordId: k.id,
        keyword: k.keyword,
        platform: k.platform,
        impressions,
        clicks,
        ctr: Math.round(ctr * 100) / 100,
        cpc: Math.round(cpc),
        conversions,
        spend,
        avgPosition: Math.round((Math.random() * 5 + 1) * 10) / 10,
        date: new Date().toISOString().slice(0, 10),
      };
    });
}

// ── 네이버 검색광고 API ──────────────────────────────────

interface NaverStatsRow {
  id: string;
  impCnt?: number;
  clkCnt?: number;
  ctr?: number;
  cpc?: number;
  ccnt?: number;       // 전환수
  salesAmt?: number;   // 비용(원)
  avgRnk?: number;
}

export async function fetchNaverPerformance(keywords: SearchAdKeyword[]): Promise<SearchAdPerformance[]> {
  const naverKw = keywords.filter(k => k.platform === 'naver');
  if (!isNaverAdsConfigured() || naverKw.length === 0) {
    return generateMockPerformance(naverKw);
  }

  try {
    // 공식 stats API — 키워드 ID 콤마 결합, 최근 7일 성과 집계
    // https://github.com/naver/searchad-apidoc — /stats?ids=...&fields=impCnt,clkCnt,salesAmt,ccnt
    const ids = naverKw.map(k => k.id).join(',');
    const today = new Date().toISOString().slice(0, 10);
    const stats = await naverAdsFetch<{ data?: NaverStatsRow[] }>('/stats', {
      method: 'GET',
      query: { ids, fields: 'impCnt,clkCnt,ctr,cpc,ccnt,salesAmt,avgRnk', timeRange: today },
    });
    const rows = stats?.data ?? [];
    const byId = new Map(rows.map(r => [r.id, r]));

    return naverKw.map(k => {
      const r = byId.get(k.id);
      return {
        keywordId: k.id,
        keyword: k.keyword,
        platform: 'naver' as const,
        impressions: r?.impCnt ?? 0,
        clicks: r?.clkCnt ?? 0,
        ctr: Math.round((r?.ctr ?? 0) * 100) / 100,
        cpc: Math.round(r?.cpc ?? 0),
        conversions: r?.ccnt ?? 0,
        spend: Math.round(r?.salesAmt ?? 0),
        avgPosition: r?.avgRnk ?? 0,
        date: today,
      };
    });
  } catch (e) {
    console.warn('[NaverAds] fetchNaverPerformance 실패 — mock fallback:', (e as Error)?.message ?? e);
    return generateMockPerformance(naverKw);
  }
}

export async function updateNaverBid(keywordId: string, newBid: number): Promise<boolean> {
  if (!isNaverAdsConfigured()) {
    console.log(`[Mock] 네이버 입찰가 변경: ${keywordId} → ₩${newBid}`);
    return true;
  }
  try {
    // PUT /ncc/keywords/{keywordId}  body: { bidAmt: number }
    await naverAdsFetch(`/ncc/keywords/${encodeURIComponent(keywordId)}`, {
      method: 'PUT',
      body: { bidAmt: newBid },
    });
    return true;
  } catch (e) {
    console.error(`[NaverAds] updateNaverBid 실패 ${keywordId}:`, (e as Error)?.message ?? e);
    return false;
  }
}

export async function pauseNaverKeyword(keywordId: string): Promise<boolean> {
  if (!isNaverAdsConfigured()) {
    console.log(`[Mock] 네이버 키워드 정지: ${keywordId}`);
    return true;
  }
  try {
    // PUT /ncc/keywords/{keywordId}  body: { userLock: true } — userLock 으로 일시 중지
    await naverAdsFetch(`/ncc/keywords/${encodeURIComponent(keywordId)}`, {
      method: 'PUT',
      body: { userLock: true },
    });
    return true;
  } catch (e) {
    console.error(`[NaverAds] pauseNaverKeyword 실패 ${keywordId}:`, (e as Error)?.message ?? e);
    return false;
  }
}

/**
 * 키워드 도구 API — 시드 키워드의 관련 키워드 + 월간 검색량 + 경쟁도 조회.
 * 공식: GET /keywordstool?hintKeywords=...&showDetail=1
 */
export interface NaverKeywordIdea {
  relKeyword: string;
  monthlyPcQcCnt: number;
  monthlyMobileQcCnt: number;
  monthlyAvePcClkCnt: number;
  monthlyAveMobileClkCnt: number;
  compIdx: '낮음' | '중간' | '높음';
  plAvgDepth?: number;
}

export async function fetchNaverKeywordIdeas(
  seedKeywords: string[],
): Promise<NaverKeywordIdea[]> {
  if (!isNaverAdsConfigured() || seedKeywords.length === 0) return [];
  try {
    // hintKeywords 는 콤마 결합, 최대 5개. 5개 초과 시 호출자가 분할 권장.
    const hint = seedKeywords.slice(0, 5).join(',');
    const res = await naverAdsFetch<{ keywordList?: NaverKeywordIdea[] }>('/keywordstool', {
      method: 'GET',
      query: { hintKeywords: hint, showDetail: 1 },
    });
    return res?.keywordList ?? [];
  } catch (e) {
    console.warn('[NaverAds] fetchNaverKeywordIdeas 실패:', (e as Error)?.message ?? e);
    return [];
  }
}

// ── 구글 Ads API ─────────────────────────────────────────
// 2026-05-19 PR C: google-ads-api npm 패키지 OAuth refresh_token 흐름으로 실제 연동.
// 환경변수 미설정 시 mock fallback.

export async function fetchGooglePerformance(keywords: SearchAdKeyword[]): Promise<SearchAdPerformance[]> {
  const googleKw = keywords.filter(k => k.platform === 'google');
  if (!isGoogleAdsConfigured() || googleKw.length === 0) {
    return generateMockPerformance(googleKw);
  }
  try {
    const { getGoogleAdsCustomer } = await import('./google-ads/client');
    const customer = getGoogleAdsCustomer();
    const today = new Date().toISOString().slice(0, 10);
    // GAQL — 키워드 단위 성과 조회 (최근 7일)
    // https://developers.google.com/google-ads/api/fields/v16/keyword_view
    // average_position 은 2019 deprecated — average_top_impression_percentage 등으로 대체 가능하나
    // 본 시점에는 노출 위치 메트릭 생략 (avgPosition=0 으로 보고).
    const query = `
      SELECT
        ad_group_criterion.resource_name,
        ad_group_criterion.keyword.text,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions,
        metrics.cost_micros
      FROM keyword_view
      WHERE ad_group_criterion.resource_name IN (${googleKw.map(k => `'${k.id.replace(/'/g, '')}'`).join(',')})
        AND segments.date DURING LAST_7_DAYS
    `;
    const rows = await customer.query(query);
    const byResource = new Map<string, typeof rows[number]>();
    for (const row of rows) {
      const rn = row.ad_group_criterion?.resource_name;
      if (rn) byResource.set(rn, row);
    }
    return googleKw.map(k => {
      const row = byResource.get(k.id);
      const m = row?.metrics;
      return {
        keywordId: k.id,
        keyword: k.keyword,
        platform: 'google' as const,
        impressions: Number(m?.impressions ?? 0),
        clicks: Number(m?.clicks ?? 0),
        ctr: Math.round(Number(m?.ctr ?? 0) * 10000) / 100,
        cpc: Math.round(Number(m?.average_cpc ?? 0) / 1_000_000),
        conversions: Math.round(Number(m?.conversions ?? 0)),
        spend: Math.round(Number(m?.cost_micros ?? 0) / 1_000_000),
        avgPosition: 0, // 2019 deprecated by Google
        date: today,
      };
    });
  } catch (e) {
    console.warn('[GoogleAds] fetchGooglePerformance 실패 — mock fallback:', (e as Error)?.message ?? e);
    return generateMockPerformance(googleKw);
  }
}

export async function updateGoogleBid(keywordId: string, newBid: number): Promise<boolean> {
  if (!isGoogleAdsConfigured()) {
    console.log(`[Mock] 구글 입찰가 변경: ${keywordId} → ₩${newBid}`);
    return true;
  }
  const { updateAdGroupCriterionBid } = await import('./google-ads/client');
  return updateAdGroupCriterionBid(keywordId, newBid);
}

export async function pauseGoogleKeyword(keywordId: string): Promise<boolean> {
  if (!isGoogleAdsConfigured()) {
    console.log(`[Mock] 구글 키워드 정지: ${keywordId}`);
    return true;
  }
  const { mutateAdGroupCriterionStatus } = await import('./google-ads/client');
  return mutateAdGroupCriterionStatus(keywordId, 'PAUSED');
}

// ── 통합 함수 ────────────────────────────────────────────

export async function fetchAllPerformance(keywords: SearchAdKeyword[]): Promise<SearchAdPerformance[]> {
  const [naver, google] = await Promise.all([
    fetchNaverPerformance(keywords),
    fetchGooglePerformance(keywords),
  ]);
  return [...naver, ...google];
}

export async function updateBid(keyword: SearchAdKeyword, newBid: number): Promise<boolean> {
  if (keyword.platform === 'naver') return updateNaverBid(keyword.id, newBid);
  return updateGoogleBid(keyword.id, newBid);
}

export async function pauseKeyword(keyword: SearchAdKeyword): Promise<boolean> {
  if (keyword.platform === 'naver') return pauseNaverKeyword(keyword.id);
  return pauseGoogleKeyword(keyword.id);
}
