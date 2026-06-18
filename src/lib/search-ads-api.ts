/**
 * ══════════════════════════════════════════════════════════
 * Search Ads API — 네이버/구글 검색광고 API 래퍼
 * ══════════════════════════════════════════════════════════
 *
 * 네이버 SearchAd API:
 *   - API 키: NAVER_ADS_API_KEY, NAVER_ADS_SECRET_KEY, NAVER_ADS_CUSTOMER_ID
 *   - Base: https://api.searchad.naver.com
 *   - 인증: API Key + Secret Key (HMAC 서명)
 *
 * 구글 Ads API:
 *   - Google Ads API v22 (REST)
 *   - 인증: OAuth 2.0 + Developer Token
 *
 * API 키 미설정 시 mock 데이터 반환 (graceful fallback)
 */

import type { SearchAdKeyword, Platform } from './keyword-brain';
import { getSecret } from '@/lib/secret-registry';
import { resolveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';

// ── 환경 변수 체크 ───────────────────────────────────────

export function isNaverAdsConfigured(): boolean {
  return !!(
    getSecret('NAVER_ADS_API_KEY') &&
    getSecret('NAVER_ADS_SECRET_KEY') &&
    getSecret('NAVER_ADS_CUSTOMER_ID')
  );
}

export function isGoogleAdsConfigured(): boolean {
  return !!(
    getSecret('GOOGLE_ADS_DEVELOPER_TOKEN') &&
    getSecret('GOOGLE_ADS_CUSTOMER_ID')
  );
}

export function getGoogleAdsConfigStatus(): {
  configured: boolean;
  developerToken: boolean;
  customerId: boolean;
  customerIdPreview: string | null;
} {
  const customerId = getSecret('GOOGLE_ADS_CUSTOMER_ID');
  return {
    configured: isGoogleAdsConfigured(),
    developerToken: Boolean(getSecret('GOOGLE_ADS_DEVELOPER_TOKEN')),
    customerId: Boolean(customerId),
    customerIdPreview: customerId ? `${customerId.slice(0, 3)}...${customerId.slice(-2)}` : null,
  };
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
  sourceQuality?: 'live' | 'mock';
  isMock?: boolean;
  excludedFromLearning?: boolean;
}

// ── Naver SearchAd API 기본 설정 ──────────────────────────

const NAVER_API_BASE = 'https://api.searchad.naver.com';

export function getNaverAdsConfigStatus(): {
  configured: boolean;
  apiKey: boolean;
  secretKey: boolean;
  customerId: boolean;
  customerIdPreview: string | null;
} {
  const customerId = getSecret('NAVER_ADS_CUSTOMER_ID');
  return {
    configured: isNaverAdsConfigured(),
    apiKey: Boolean(getSecret('NAVER_ADS_API_KEY')),
    secretKey: Boolean(getSecret('NAVER_ADS_SECRET_KEY')),
    customerId: Boolean(customerId),
    customerIdPreview: customerId ? `${customerId.slice(0, 3)}...${customerId.slice(-2)}` : null,
  };
}

export function isNaverAdsMutableKeywordId(keywordId: string): boolean {
  return /^nkw-[a-z0-9-]+$/i.test(keywordId);
}

export function isGoogleAdsMutableKeywordId(keywordId: string): boolean {
  return keywordId.startsWith('customers/');
}

/** Naver SearchAd API 인증 헤더 생성 (HMAC-SHA256) */
async function buildNaverAuthHeaders(
  method: string = 'GET',
  path: string = '/keywordstool',
): Promise<Record<string, string>> {
  const apiKey = getSecret('NAVER_ADS_API_KEY')!;
  const secretKey = getSecret('NAVER_ADS_SECRET_KEY')!;
  const customerId = getSecret('NAVER_ADS_CUSTOMER_ID')!;

  // HMAC-SHA256 서명 생성 — path는 실제 요청 path와 일치해야 함
  const timestamp = Date.now().toString();

  const crypto = await import('crypto');
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(`${timestamp}.${method}.${path}`)
    .digest('base64');

  return {
    'X-Timestamp': timestamp,
    'X-API-KEY': apiKey,
    'X-Customer': customerId,
    'X-Signature': signature,
    'Content-Type': 'application/json;charset=UTF-8',
  };
}

// ── Search Terms (검색어) 타입 ───────────────────────────

export interface SearchTerm {
  searchTerm: string;
  keywordText: string;
  matchType: string;
  impressions: number;
  clicks: number;
  ctr: number;
  costKrw: number;
  conversions: number;
  platform: Platform;
}

export interface HistoricalMetric {
  keyword: string;
  year: number;
  month: number;
  avgMonthlySearches: number;
  competition: string;
  competitionIndex: number;
  lowTopOfPageBid: number;
  highTopOfPageBid: number;
  platform: Platform;
}

/** 네이버 키워드 검색 도구 (KeywordTool) API 응답 항목 */
export interface NaverKeywordToolItem {
  relKeyword: string;
  monthlyPcQcCnt: number;
  monthlyMobileQcCnt: number;
  monthlyAvePcClkCnt: number;
  monthlyAveMobileClkCnt: number;
  monthlyAvePcCtr: number;
  monthlyAveMobileCtr: number;
  plAvgDepth: number;
  compIdx: number;
  lowPrice: number;
  highPrice: number;
}

export interface NaverCreatedKeyword {
  nccKeywordId: string;
  nccAdgroupId: string;
  keyword: string;
  userLock?: boolean;
}

export interface NaverAdgroupSummary {
  nccAdgroupId: string;
  nccCampaignId?: string;
  name: string;
  userLock?: boolean;
  inspectStatus?: string;
  adgroupAttrJson?: unknown;
}

export interface NaverCampaignSummary {
  nccCampaignId: string;
  name: string;
  campaignTp?: string;
  userLock?: boolean;
  status?: string;
}

export interface NaverBusinessChannelSummary {
  nccBusinessChannelId: string;
  name?: string;
  channelTp?: string;
  inspectStatus?: string;
  url?: string;
}

/** 네이버 키워드 검색 도구 (KeywordTool) API 호출 */
export async function fetchNaverKeywordTool(
  hintKeywords: string[],
): Promise<NaverKeywordToolItem[]> {
  if (!isNaverAdsConfigured()) return [];

  try {
    const path = '/keywordstool';
    const headers = await buildNaverAuthHeaders('GET', path);
    const params = new URLSearchParams({
      hintKeywords: hintKeywords.join(','),
      showDetail: '1',
    });

    const res = await fetch(`${NAVER_API_BASE}${path}?${params.toString()}`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.warn(`[search-ads] Naver KeywordTool 오류 (${res.status}): ${errorText.slice(0, 200)}`);
      return [];
    }

    const json = await res.json() as { keywordList?: NaverKeywordToolItem[] };
    return json.keywordList ?? [];
  } catch (err) {
    console.error('[search-ads] Naver KeywordTool 실패:', err);
    return [];
  }
}

export async function fetchNaverKeywordIdeas(
  hintKeywords: string[],
): Promise<NaverKeywordToolItem[]> {
  return fetchNaverKeywordTool(hintKeywords);
}

export async function createNaverPausedKeywords(input: {
  nccAdgroupId: string;
  keywords: Array<{ keyword: string; bidAmt?: number }>;
}): Promise<{ ok: boolean; created: NaverCreatedKeyword[]; error?: string }> {
  if (!isNaverAdsConfigured()) {
    return { ok: false, created: [], error: 'NAVER_ADS_API_KEY/NAVER_ADS_SECRET_KEY/NAVER_ADS_CUSTOMER_ID 미설정' };
  }

  const nccAdgroupId = input.nccAdgroupId.trim();
  if (!nccAdgroupId) {
    return { ok: false, created: [], error: 'NAVER_ADS_ADGROUP_ID 미설정' };
  }

  const keywords = input.keywords
    .map((row) => ({
      customerId: Number(getSecret('NAVER_ADS_CUSTOMER_ID')),
      nccAdgroupId,
      keyword: row.keyword.trim(),
      bidAmt: Math.max(70, Math.round(Number(row.bidAmt || 70))),
      useGroupBidAmt: false,
      userLock: true,
    }))
    .filter((row) => row.keyword.length > 0);

  if (!keywords.length) return { ok: true, created: [] };

  try {
    const path = '/ncc/keywords';
    const headers = await buildNaverAuthHeaders('POST', path);
    const params = new URLSearchParams({ nccAdgroupId });
    const res = await fetch(`${NAVER_API_BASE}${path}?${params.toString()}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(keywords),
    });

    if (!res.ok) {
      const errorText = await res.text();
      return { ok: false, created: [], error: `Naver keyword create failed (${res.status}): ${errorText.slice(0, 300)}` };
    }

    const json = await res.json() as NaverCreatedKeyword[] | { data?: NaverCreatedKeyword[] };
    const created = Array.isArray(json) ? json : json.data || [];
    return { ok: true, created };
  } catch (err) {
    return { ok: false, created: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchNaverAdgroups(input: {
  nccCampaignId?: string;
  recordSize?: number;
} = {}): Promise<{ ok: boolean; adgroups: NaverAdgroupSummary[]; error?: string }> {
  if (!isNaverAdsConfigured()) {
    return { ok: false, adgroups: [], error: 'NAVER_ADS_API_KEY/NAVER_ADS_SECRET_KEY/NAVER_ADS_CUSTOMER_ID 미설정' };
  }

  try {
    const path = '/ncc/adgroups';
    const headers = await buildNaverAuthHeaders('GET', path);
    const params = new URLSearchParams({
      recordSize: String(Math.min(Math.max(Number(input.recordSize || 100), 1), 1000)),
    });
    if (input.nccCampaignId) params.set('nccCampaignId', input.nccCampaignId);

    const res = await fetch(`${NAVER_API_BASE}${path}?${params.toString()}`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const errorText = await res.text();
      return { ok: false, adgroups: [], error: `Naver adgroup list failed (${res.status}): ${errorText.slice(0, 300)}` };
    }

    const json = await res.json() as NaverAdgroupSummary[] | { data?: NaverAdgroupSummary[] };
    const rows = Array.isArray(json) ? json : json.data || [];
    return {
      ok: true,
      adgroups: rows
        .filter((row) => row.nccAdgroupId && row.name)
        .map((row) => ({
          nccAdgroupId: row.nccAdgroupId,
          nccCampaignId: row.nccCampaignId,
          name: row.name,
          userLock: row.userLock,
          inspectStatus: row.inspectStatus,
          adgroupAttrJson: row.adgroupAttrJson,
        })),
    };
  } catch (err) {
    return { ok: false, adgroups: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchNaverAdgroupById(
  nccAdgroupId: string,
): Promise<{ ok: boolean; adgroup: NaverAdgroupSummary | null; error?: string }> {
  if (!isNaverAdsConfigured()) {
    return { ok: false, adgroup: null, error: 'NAVER_ADS_API_KEY/NAVER_ADS_SECRET_KEY/NAVER_ADS_CUSTOMER_ID 미설정' };
  }

  const id = nccAdgroupId.trim();
  if (!id) return { ok: false, adgroup: null, error: 'nccAdgroupId 미입력' };

  try {
    const path = `/ncc/adgroups/${encodeURIComponent(id)}`;
    const headers = await buildNaverAuthHeaders('GET', path);
    const res = await fetch(`${NAVER_API_BASE}${path}`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const errorText = await res.text();
      return { ok: false, adgroup: null, error: `Naver adgroup lookup failed (${res.status}): ${errorText.slice(0, 300)}` };
    }

    const row = await res.json() as NaverAdgroupSummary;
    if (!row?.nccAdgroupId) {
      return { ok: false, adgroup: null, error: '네이버 광고그룹 응답에 nccAdgroupId가 없습니다.' };
    }

    return {
      ok: true,
      adgroup: {
        nccAdgroupId: row.nccAdgroupId,
        nccCampaignId: row.nccCampaignId,
        name: row.name,
        userLock: row.userLock,
        inspectStatus: row.inspectStatus,
        adgroupAttrJson: row.adgroupAttrJson,
      },
    };
  } catch (err) {
    return { ok: false, adgroup: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchNaverCampaigns(input: {
  recordSize?: number;
} = {}): Promise<{ ok: boolean; campaigns: NaverCampaignSummary[]; error?: string }> {
  if (!isNaverAdsConfigured()) {
    return { ok: false, campaigns: [], error: 'NAVER_ADS_API_KEY/NAVER_ADS_SECRET_KEY/NAVER_ADS_CUSTOMER_ID 미설정' };
  }

  try {
    const path = '/ncc/campaigns';
    const headers = await buildNaverAuthHeaders('GET', path);
    const params = new URLSearchParams({
      recordSize: String(Math.min(Math.max(Number(input.recordSize || 100), 1), 1000)),
    });

    const res = await fetch(`${NAVER_API_BASE}${path}?${params.toString()}`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const errorText = await res.text();
      return { ok: false, campaigns: [], error: `Naver campaign list failed (${res.status}): ${errorText.slice(0, 300)}` };
    }

    const json = await res.json() as NaverCampaignSummary[] | { data?: NaverCampaignSummary[] };
    const rows = Array.isArray(json) ? json : json.data || [];
    return {
      ok: true,
      campaigns: rows
        .filter((row) => row.nccCampaignId && row.name)
        .map((row) => ({
          nccCampaignId: row.nccCampaignId,
          name: row.name,
          campaignTp: row.campaignTp,
          userLock: row.userLock,
          status: row.status,
        })),
    };
  } catch (err) {
    return { ok: false, campaigns: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchNaverBusinessChannels(input: {
  recordSize?: number;
} = {}): Promise<{ ok: boolean; channels: NaverBusinessChannelSummary[]; error?: string }> {
  if (!isNaverAdsConfigured()) {
    return { ok: false, channels: [], error: 'NAVER_ADS_API_KEY/NAVER_ADS_SECRET_KEY/NAVER_ADS_CUSTOMER_ID 미설정' };
  }

  try {
    const path = '/ncc/channels';
    const headers = await buildNaverAuthHeaders('GET', path);
    const params = new URLSearchParams({
      recordSize: String(Math.min(Math.max(Number(input.recordSize || 100), 1), 1000)),
    });

    const res = await fetch(`${NAVER_API_BASE}${path}?${params.toString()}`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const errorText = await res.text();
      return { ok: false, channels: [], error: `Naver channel list failed (${res.status}): ${errorText.slice(0, 300)}` };
    }

    const json = await res.json() as NaverBusinessChannelSummary[] | { data?: NaverBusinessChannelSummary[] };
    const rows = Array.isArray(json) ? json : json.data || [];
    return {
      ok: true,
      channels: rows
        .filter((row) => row.nccBusinessChannelId)
        .map((row) => ({
          nccBusinessChannelId: row.nccBusinessChannelId,
          name: row.name,
          channelTp: row.channelTp,
          inspectStatus: row.inspectStatus,
          url: row.url,
        })),
    };
  } catch (err) {
    return { ok: false, channels: [], error: err instanceof Error ? err.message : String(err) };
  }
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
        sourceQuality: 'mock',
        isMock: true,
        excludedFromLearning: true,
      };
    });
}

// ── 네이버 검색광고 API (실제 연동) ──────────────────────

/**
 * 네이버 검색광고 성과 데이터 조회
 *
 * 실제 API:
 *   GET /stats?ids={keywordId}&datePreset={period}
 *   인증: HMAC 서명
 */
export async function fetchNaverPerformance(keywords: SearchAdKeyword[]): Promise<SearchAdPerformance[]> {
  const naverKeywords = keywords.filter(k => k.platform === 'naver');
  if (!naverKeywords.length) return [];

  if (!isNaverAdsConfigured()) {
    return generateMockPerformance(naverKeywords);
  }

  try {
    const statsPath = '/stats';
    const headers = await buildNaverAuthHeaders('GET', statsPath);

    // API 호출: 일괄 성과 조회
    const keywordIds = naverKeywords
      .map(k => k.id)
      .filter(isNaverAdsMutableKeywordId);
    if (!keywordIds.length) return generateMockPerformance(naverKeywords);

    const url = `${NAVER_API_BASE}${statsPath}`;
    const params = new URLSearchParams({
      ids: JSON.stringify(keywordIds),
      fields: JSON.stringify(['impCnt', 'clkCnt', 'ctr', 'cpc', 'salesAmt', 'ccnt']),
      datePreset: 'last7days',
    });

    const res = await fetch(`${url}?${params.toString()}`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.warn(`[search-ads] Naver API 오류 (${res.status}): ${errorText.slice(0, 200)}`);
      return generateMockPerformance(naverKeywords);
    }

    const json = await res.json() as {
      data?: Array<{
        id: string;
        keyword: string;
        impCnt?: number;
        clkCnt?: number;
        ctr: number;
        cpc?: number;
        salesAmt?: number;
        ccnt?: number;
      }>;
    };

    if (!json.data?.length) {
      return generateMockPerformance(naverKeywords);
    }

    const today = new Date().toISOString().slice(0, 10);
    return json.data.map(item => ({
      keywordId: item.id,
      keyword: item.keyword ?? naverKeywords.find(k => k.id === item.id)?.keyword ?? item.id,
      platform: 'naver' as const,
      impressions: item.impCnt ?? 0,
      clicks: item.clkCnt ?? 0,
      ctr: item.ctr ?? 0,
      cpc: item.cpc ?? 0,
      conversions: item.ccnt ?? 0,
      spend: item.salesAmt ?? 0,
      avgPosition: 0,
      date: today,
    }));
  } catch (err) {
    console.error('[search-ads] Naver 성과 조회 실패:', err);
    return generateMockPerformance(naverKeywords);
  }
}

/**
 * 네이버 키워드 입찰가 업데이트
 *
 * 실제 API:
 *   PUT /ncc/keywords/{keywordId}
 *   Body: { "nccKeywordId": keywordId, "bidAmt": newBid, "useGroupBidAmt": false }
 */
export async function updateNaverBid(keywordId: string, newBid: number): Promise<boolean> {
  if (!isNaverAdsMutableKeywordId(keywordId)) {
    console.warn(`[search-ads] Naver 입찰가 변경 생략: 실제 ncc keyword id가 아닙니다 (${keywordId})`);
    return false;
  }

  if (!isNaverAdsConfigured()) {
    console.warn(`[search-ads] Naver bid update blocked: account is not configured (${keywordId})`);
    return false;
  }

  try {
    const bidPath = `/ncc/keywords/${keywordId}`;
    const headers = await buildNaverAuthHeaders('PUT', bidPath);

    const res = await fetch(`${NAVER_API_BASE}${bidPath}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({ nccKeywordId: keywordId, bidAmt: newBid, useGroupBidAmt: false }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[search-ads] Naver 입찰가 변경 실패: ${errorText.slice(0, 200)}`);
      return false;
    }

    console.log(`[search-ads] 네이버 입찰가 변경 완료: ${keywordId} → ₩${newBid}`);
    return true;
  } catch (err) {
    console.error('[search-ads] Naver 입찰가 변경 오류:', err);
    return false;
  }
}

/**
 * 네이버 키워드 일시정지
 *
 * 실제 API:
 *   PUT /ncc/keywords/{keywordId}
 *   Body: { "nccKeywordId": keywordId, "userLock": true }
 */
export async function pauseNaverKeyword(keywordId: string): Promise<boolean> {
  if (!isNaverAdsMutableKeywordId(keywordId)) {
    console.warn(`[search-ads] Naver 키워드 정지 생략: 실제 ncc keyword id가 아닙니다 (${keywordId})`);
    return false;
  }

  if (!isNaverAdsConfigured()) {
    console.warn(`[search-ads] Naver keyword pause blocked: account is not configured (${keywordId})`);
    return false;
  }

  try {
    const pausePath = `/ncc/keywords/${keywordId}`;
    const headers = await buildNaverAuthHeaders('PUT', pausePath);

    const res = await fetch(`${NAVER_API_BASE}${pausePath}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({ nccKeywordId: keywordId, userLock: true }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[search-ads] Naver 키워드 정지 실패: ${errorText.slice(0, 200)}`);
      return false;
    }

    console.log(`[search-ads] 네이버 키워드 정지 완료: ${keywordId}`);
    return true;
  } catch (err) {
    console.error('[search-ads] Naver 키워드 정지 오류:', err);
    return false;
  }
}

export async function setNaverKeywordUserLock(keywordId: string, userLock: boolean): Promise<boolean> {
  if (!isNaverAdsMutableKeywordId(keywordId)) {
    console.warn(`[search-ads] Naver keyword lock update skipped: not a real ncc keyword id (${keywordId})`);
    return false;
  }

  if (!isNaverAdsConfigured()) {
    console.warn(`[search-ads] Naver keyword lock update blocked: account is not configured (${keywordId})`);
    return false;
  }

  try {
    const path = `/ncc/keywords/${keywordId}`;
    const headers = await buildNaverAuthHeaders('PUT', path);

    const res = await fetch(`${NAVER_API_BASE}${path}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ nccKeywordId: keywordId, userLock }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[search-ads] Naver keyword lock update failed: ${errorText.slice(0, 200)}`);
      return false;
    }

    console.log(`[search-ads] Naver keyword userLock updated: ${keywordId} -> ${userLock}`);
    return true;
  } catch (err) {
    console.error('[search-ads] Naver keyword lock update error:', err);
    return false;
  }
}

export async function activateNaverKeyword(keywordId: string): Promise<boolean> {
  return setNaverKeywordUserLock(keywordId, false);
}

// ── 구글 Ads API (실제 연동) ─────────────────────────────

const GOOGLE_ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION ?? 'v22';
const GOOGLE_ADS_API_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

/**
 * Google Ads API — 성과 데이터 조회
 *
 * POST /customers/{customerId}/googleAds:search
 *   { "query": "SELECT metrics.impressions, metrics.clicks, ... FROM keywords ..." }
 */
export async function fetchGooglePerformance(keywords: SearchAdKeyword[]): Promise<SearchAdPerformance[]> {
  const googleKeywords = keywords.filter(k => k.platform === 'google');
  if (!googleKeywords.length) return [];

  if (!isGoogleAdsConfigured()) {
    return generateMockPerformance(googleKeywords);
  }

  try {
    const token = await resolveOAuthToken('', 'google_ads');
    const developerToken = getSecret('GOOGLE_ADS_DEVELOPER_TOKEN')!;
    const customerId = getSecret('GOOGLE_ADS_CUSTOMER_ID')?.replace(/-/g, '') ?? '';

    if (!token || !customerId) {
      return generateMockPerformance(googleKeywords);
    }

    // GAQL 쿼리 — 최근 7일 성과
    const keywordNames = googleKeywords.map(k => k.keyword);
    const gaql = `
      SELECT
        ad_group_criterion.keyword.text,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.average_cpc,
        metrics.cost_micros,
        metrics.conversions,
        metrics.search_impression_share
      FROM keyword_view
      WHERE
        segments.date DURING LAST_7_DAYS
        AND ad_group_criterion.keyword.text IN (${keywordNames.map(k => `'${k.replace(/'/g, "\\'")}'`).join(',')})
      LIMIT 1000
    `;

    const res = await fetch(`${GOOGLE_ADS_API_BASE}/customers/${customerId}/googleAds:search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token.accessToken}`,
        'developer-token': developerToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: gaql }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.warn(`[search-ads] Google Ads API 오류 (${res.status}): ${errorText.slice(0, 200)}`);
      return generateMockPerformance(googleKeywords);
    }

    const json = await res.json() as {
      results?: Array<{
        adGroupCriterion?: { keyword?: { text?: string } };
        metrics?: {
          impressions?: number;
          clicks?: number;
          ctr?: number;
          averageCpc?: number;
          costMicros?: number;
          conversions?: number;
          searchImpressionShare?: number;
        };
      }>;
    };

    if (!json.results?.length) {
      return generateMockPerformance(googleKeywords);
    }

    const today = new Date().toISOString().slice(0, 10);
    return json.results.map((item, idx) => {
      const kw = item.adGroupCriterion?.keyword?.text ?? googleKeywords[idx]?.keyword ?? '';
      const matchingKw = googleKeywords.find(k => k.keyword === kw);
      return {
        keywordId: matchingKw?.id ?? kw,
        keyword: kw,
        platform: 'google' as const,
        impressions: item.metrics?.impressions ?? 0,
        clicks: item.metrics?.clicks ?? 0,
        ctr: (item.metrics?.ctr ?? 0) * 100, // GAQL은 0-1 범위 → 퍼센트 변환
        cpc: Math.round((item.metrics?.averageCpc ?? 0) / 1_000_000), // micros → 원
        conversions: item.metrics?.conversions ?? 0,
        spend: Math.round((item.metrics?.costMicros ?? 0) / 1_000_000), // micros → 원
        avgPosition: item.metrics?.searchImpressionShare
          ? Math.round((1 / (item.metrics.searchImpressionShare / 100)) * 10) / 10
          : 5,
        date: today,
      };
    });
  } catch (err) {
    console.error('[search-ads] Google 성과 조회 실패:', err);
    return generateMockPerformance(googleKeywords);
  }
}

/**
 * Google Ads 키워드 입찰가 업데이트
 *
 * POST /customers/{customerId}/googleAds:mutate
 *   [{
 *     "update": {
 *       "resourceName": "...",
 *       "cpcBidMicros": newBid * 1_000_000
 *     },
 *     "updateMask": "cpcBidMicros"
 *   }]
 */
export async function updateGoogleBid(keywordId: string, newBid: number): Promise<boolean> {
  if (!isGoogleAdsMutableKeywordId(keywordId)) {
    console.warn(`[search-ads] Google bid update skipped: not a real Google Ads resource name (${keywordId})`);
    return false;
  }

  if (!isGoogleAdsConfigured()) {
    console.warn(`[search-ads] Google bid update blocked: account is not configured (${keywordId})`);
    return false;
  }

  try {
    const token = await resolveOAuthToken('', 'google_ads');
    const developerToken = getSecret('GOOGLE_ADS_DEVELOPER_TOKEN')!;
    const customerId = getSecret('GOOGLE_ADS_CUSTOMER_ID')?.replace(/-/g, '') ?? '';

    if (!token) {
      return false;
    }

    const resourceName = keywordId.startsWith('customers/') ? keywordId : `customers/${customerId}/adGroupCriteria/${keywordId}`;

    const res = await fetch(`${GOOGLE_ADS_API_BASE}/customers/${customerId}/googleAds:mutate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token.accessToken}`,
        'developer-token': developerToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operations: [{
          update: {
            resourceName,
            cpcBidMicros: newBid * 1_000_000,
          },
          updateMask: 'cpcBidMicros',
        }],
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[search-ads] Google 입찰가 변경 실패: ${errorText.slice(0, 200)}`);
      return false;
    }

    console.log(`[search-ads] 구글 입찰가 변경 완료: ${keywordId} → ₩${newBid}`);
    return true;
  } catch (err) {
    console.error('[search-ads] Google 입찰가 변경 오류:', err);
    return false;
  }
}

/**
 * Google Ads 키워드 일시정지
 */
export async function pauseGoogleKeyword(keywordId: string): Promise<boolean> {
  if (!isGoogleAdsMutableKeywordId(keywordId)) {
    console.warn(`[search-ads] Google keyword pause skipped: not a real Google Ads resource name (${keywordId})`);
    return false;
  }

  if (!isGoogleAdsConfigured()) {
    console.warn(`[search-ads] Google keyword pause blocked: account is not configured (${keywordId})`);
    return false;
  }

  try {
    const token = await resolveOAuthToken('', 'google_ads');
    const developerToken = getSecret('GOOGLE_ADS_DEVELOPER_TOKEN')!;
    const customerId = getSecret('GOOGLE_ADS_CUSTOMER_ID')?.replace(/-/g, '') ?? '';

    if (!token) {
      return false;
    }

    const resourceName = keywordId.startsWith('customers/') ? keywordId : `customers/${customerId}/adGroupCriteria/${keywordId}`;

    const res = await fetch(`${GOOGLE_ADS_API_BASE}/customers/${customerId}/googleAds:mutate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token.accessToken}`,
        'developer-token': developerToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operations: [{
          update: {
            resourceName,
            status: 'PAUSED',
          },
          updateMask: 'status',
        }],
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[search-ads] Google 키워드 정지 실패: ${errorText.slice(0, 200)}`);
      return false;
    }

    console.log(`[search-ads] 구글 키워드 정지 완료: ${keywordId}`);
    return true;
  } catch (err) {
    console.error('[search-ads] Google 키워드 정지 오류:', err);
    return false;
  }
}

// ── 통합 함수 ────────────────────────────────────────────

export async function fetchAllPerformance(keywords: SearchAdKeyword[]): Promise<SearchAdPerformance[]> {
  const [naver, google] = await Promise.all([
    fetchNaverPerformance(keywords),
    fetchGooglePerformance(keywords),
  ]);
  return [...naver, ...google].map((row) => ({
    ...row,
    sourceQuality: row.sourceQuality ?? 'live',
    isMock: row.isMock ?? false,
    excludedFromLearning: row.excludedFromLearning ?? false,
  }));
}

export async function updateBid(keyword: SearchAdKeyword, newBid: number): Promise<boolean> {
  if (keyword.platform === 'naver') return updateNaverBid(keyword.id, newBid);
  return updateGoogleBid(keyword.id, newBid);
}

export async function pauseKeyword(keyword: SearchAdKeyword): Promise<boolean> {
  if (keyword.platform === 'naver') return pauseNaverKeyword(keyword.id);
  return pauseGoogleKeyword(keyword.id);
}

// ── Phase 1: GenerateHistoricalMetrics ────────────────────

/**
 * Google Ads Keyword Planner — 히스토리컬 메트릭스 조회
 *
 * 실제 API (Basic Access 필요):
 *   POST /customers/{customerId}/keywords:generateHistoricalMetrics
 *
 * 키워드별 월간 검색량, 경쟁도, 입찰가 참고치 반환
 */
export async function generateGoogleHistoricalMetrics(
  keywords: string[],
): Promise<HistoricalMetric[]> {
  if (!isGoogleAdsConfigured()) {
    return generateMockHistoricalMetrics(keywords, 'google');
  }

  try {
    const token = await resolveOAuthToken('', 'google_ads');
    const developerToken = getSecret('GOOGLE_ADS_DEVELOPER_TOKEN')!;
    const customerId = getSecret('GOOGLE_ADS_CUSTOMER_ID')?.replace(/-/g, '') ?? '';

    if (!token || !customerId) {
      return generateMockHistoricalMetrics(keywords, 'google');
    }

    const res = await fetch(
      `${GOOGLE_ADS_API_BASE}/customers/${customerId}:generateKeywordHistoricalMetrics`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token.accessToken}`,
          'developer-token': developerToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          keywords,
          geoTargetConstants: ['geoTargetConstants/1002236'], // 한국
          language: 'languageConstants/1026', // 한국어
        }),
      },
    );

    if (!res.ok) {
      const errorText = await res.text();
      console.warn(`[search-ads] Google Historical Metrics 오류: ${errorText.slice(0, 200)}`);
      return generateMockHistoricalMetrics(keywords, 'google');
    }

    const json = (await res.json()) as {
      results?: Array<{
        keyword: string;
        monthlySearchMetrics?: Array<{
          year: number;
          month: number;
          avgMonthlySearches: number;
        }>;
        competition?: string;
        competitionIndex?: number;
        lowTopOfPageBidMicros?: number;
        highTopOfPageBidMicros?: number;
      }>;
    };

    if (!json.results?.length) {
      return generateMockHistoricalMetrics(keywords, 'google');
    }

    const now = new Date();
    const metrics: HistoricalMetric[] = [];

    for (const result of json.results) {
      const recentMetrics = result.monthlySearchMetrics?.slice(-12) ?? [];
      for (const m of recentMetrics) {
        metrics.push({
          keyword: result.keyword,
          year: m.year,
          month: m.month,
          avgMonthlySearches: m.avgMonthlySearches ?? 0,
          competition: (result.competition ?? 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH',
          competitionIndex: result.competitionIndex ?? 50,
          lowTopOfPageBid: Math.round((result.lowTopOfPageBidMicros ?? 100000) / 1_000_000),
          highTopOfPageBid: Math.round((result.highTopOfPageBidMicros ?? 500000) / 1_000_000),
          platform: 'google',
        });
      }
    }

    return metrics;
  } catch (err) {
    console.error('[search-ads] Google Historical Metrics 실패:', err);
    return generateMockHistoricalMetrics(keywords, 'google');
  }
}

function generateMockHistoricalMetrics(
  keywords: string[],
  platform: Platform,
): HistoricalMetric[] {
  const now = new Date();
  const metrics: HistoricalMetric[] = [];

  for (const kw of keywords) {
    // 지난 12개월 mock 데이터 생성
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const isPeak = d.getMonth() >= 5 && d.getMonth() <= 7; // 6-8월 성수기
      const baseVolume = 500 + Math.floor(Math.random() * 2000);

      metrics.push({
        keyword: kw,
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        avgMonthlySearches: isPeak ? baseVolume * 2 : baseVolume,
        competition: ['LOW', 'MEDIUM', 'HIGH'][Math.floor(Math.random() * 3)],
        competitionIndex: Math.floor(Math.random() * 80) + 10,
        lowTopOfPageBid: Math.floor(Math.random() * 500) + 100,
        highTopOfPageBid: Math.floor(Math.random() * 1000) + 300,
        platform,
      });
    }
  }

  return metrics;
}

// ── Phase 1: Search Terms 조회 ────────────────────────────

/**
 * Google Ads Search Terms 조회
 *
 * 실제 API (Basic Access 필요):
 *   POST /customers/{customerId}/googleAds:search
 *   SELECT search_term_view.search_term, ...
 */
export async function fetchGoogleSearchTerms(
  parentKeywordIds: string[],
): Promise<SearchTerm[]> {
  if (!isGoogleAdsConfigured()) {
    return generateMockSearchTerms();
  }

  try {
    const token = await resolveOAuthToken('', 'google_ads');
    const developerToken = getSecret('GOOGLE_ADS_DEVELOPER_TOKEN')!;
    const customerId = getSecret('GOOGLE_ADS_CUSTOMER_ID')?.replace(/-/g, '') ?? '';

    if (!token || !customerId) {
      return generateMockSearchTerms();
    }

    const gaql = `
      SELECT
        search_term_view.search_term,
        search_term_view.ad_group,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.cost_micros,
        metrics.conversions
      FROM search_term_view
      WHERE
        segments.date DURING LAST_30_DAYS
        AND campaign.advertising_channel_type = 'SEARCH'
      LIMIT 1000
    `;

    const res = await fetch(
      `${GOOGLE_ADS_API_BASE}/customers/${customerId}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token.accessToken}`,
          'developer-token': developerToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: gaql }),
      },
    );

    if (!res.ok) {
      const errorText = await res.text();
      console.warn(`[search-ads] Google Search Terms 오류: ${errorText.slice(0, 200)}`);
      return generateMockSearchTerms();
    }

    const json = (await res.json()) as {
      results?: Array<{
        searchTermView?: {
          searchTerm: string;
          adGroup?: string;
        };
        metrics?: {
          impressions: number;
          clicks: number;
          ctr: number;
          costMicros: number;
          conversions: number;
        };
      }>;
    };

    if (!json.results?.length) {
      return generateMockSearchTerms();
    }

    return json.results.map((item) => ({
      searchTerm: item.searchTermView?.searchTerm ?? '',
      keywordText: item.searchTermView?.adGroup ?? '',
      matchType: 'broad',
      impressions: item.metrics?.impressions ?? 0,
      clicks: item.metrics?.clicks ?? 0,
      ctr: (item.metrics?.ctr ?? 0) * 100,
      costKrw: Math.round((item.metrics?.costMicros ?? 0) / 1_000_000),
      conversions: item.metrics?.conversions ?? 0,
      platform: 'google' as const,
    }));
  } catch (err) {
    console.error('[search-ads] Google Search Terms 실패:', err);
    return generateMockSearchTerms();
  }
}

function generateMockSearchTerms(count = 20): SearchTerm[] {
  const searchTerms = [
    '다낭 패키지 가격', '다낭 여행', '방콕 자유여행', '오사카 여행',
    '다낭 3박5일 가격', '방콕 5일 패키지', '세부 골프', '발리 허니문',
    '도쿄 자유여행 비용', '후쿠오카 3일', '괌 패키지', '다낭 호텔',
    '오사카 4박5일', '장가계 패키지', '푸꾸옥 리조트', '나트랑 여행',
    '다낭 얼리버드', '방콕 쇼핑', '세부 자유여행', '오사카 가족여행',
  ];

  return searchTerms.slice(0, count).map((term) => ({
    searchTerm: term,
    keywordText: term.split(' ').slice(0, 2).join(' '),
    matchType: 'broad',
    impressions: Math.floor(Math.random() * 2000) + 50,
    clicks: Math.floor(Math.random() * 100) + 1,
    ctr: 0,
    costKrw: Math.floor(Math.random() * 50000) + 500,
    conversions: Math.floor(Math.random() * 5),
    platform: 'google' as const,
  }));
}

// ── Phase 1: Search Terms 기반 키워드 확장/제외 ───────────

export interface SearchTermRecommendation {
  searchTerm: string;
  action: 'add_as_keyword' | 'add_as_negative' | 'review';
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

/**
 * Search Terms 분석 → 키워드 추가/제외 추천
 *
 * 로직:
 *   - 전환 발생 & 검색어 != 타겟키워드 → 신규 키워드로 추가
 *   - CTR < 0.5% & 지출 > 10,000원 → negative 키워드 추가
 *   - 나머지는 검토 대상
 */
export function analyzeSearchTerms(searchTerms: SearchTerm[]): SearchTermRecommendation[] {
  const recommendations: SearchTermRecommendation[] = [];

  for (const st of searchTerms) {
    // 전환 발생 → 키워드 추가 추천
    if (st.conversions > 0 && st.searchTerm !== st.keywordText) {
      recommendations.push({
        searchTerm: st.searchTerm,
        action: 'add_as_keyword',
        reason: `전환 ${st.conversions}회 발생 — 신규 키워드 추가 추천`,
        priority: 'high',
      });
      continue;
    }

    // 고비용 저성과 → negative 추가
    if (st.ctr < 0.5 && st.costKrw > 10000) {
      recommendations.push({
        searchTerm: st.searchTerm,
        action: 'add_as_negative',
        reason: `CTR ${st.ctr.toFixed(2)}%, 지출 ₩${st.costKrw.toLocaleString()} — 제외 추천`,
        priority: 'high',
      });
      continue;
    }

    // 그 외 검토 대상
    recommendations.push({
      searchTerm: st.searchTerm,
      action: 'review',
      reason: `노출 ${st.impressions}회, 클릭 ${st.clicks}회 — 검토 필요`,
      priority: 'medium',
    });
  }

  return recommendations.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });
}
