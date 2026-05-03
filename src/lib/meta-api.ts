/**
 * Meta Marketing API 클라이언트
 * - 모든 호출은 서버사이드 전용 (API 라우트 내부에서만 import)
 * - 추가 npm 패키지 없음 — raw fetch() 사용
 * - Base URL: https://graph.facebook.com/v18.0/
 */

import type { MetaApiResponse, MetaInsightData } from '@/types/meta-ads';

const BASE_URL = 'https://graph.facebook.com/v18.0';

function getCredentials() {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID; // "act_XXXXXXXXX" 형식
  const pageId = process.env.META_PAGE_ID;

  if (!accessToken || !adAccountId) {
    throw new Error('META_ACCESS_TOKEN 또는 META_AD_ACCOUNT_ID 환경변수가 설정되지 않았습니다.');
  }
  return { accessToken, adAccountId, pageId };
}

/**
 * Meta API 공통 에러 처리
 * - 에러코드 190 = 토큰 만료 → 특별 처리
 */
function handleMetaError(json: MetaApiResponse, context: string): never {
  const err = json.error!;
  if (err.code === 190) {
    throw new Error(`META_TOKEN_EXPIRED: ${context} — ${err.message}`);
  }
  throw new Error(`Meta API 오류 [${context}] code=${err.code}: ${err.message}`);
}

// ─────────────────────────────────────────────
// 1. 캠페인 생성
// ─────────────────────────────────────────────
export async function createMetaCampaign(params: {
  name: string;
  objective: string;
}): Promise<{ id: string }> {
  const { accessToken, adAccountId } = getCredentials();

  const body = new URLSearchParams({
    name: params.name,
    objective: params.objective,
    status: 'PAUSED', // 항상 일시정지 상태로 생성, 관리자가 수동 활성화
    special_ad_categories: '[]',
    access_token: accessToken,
  });

  const res = await fetch(`${BASE_URL}/${adAccountId}/campaigns`, {
    method: 'POST',
    body,
  });
  const json: MetaApiResponse<{ id: string }> = await res.json();
  if (json.error) handleMetaError(json, 'createMetaCampaign');
  return { id: json.id! };
}

// ─────────────────────────────────────────────
// 2. 광고 세트 생성
// ─────────────────────────────────────────────
export async function createAdSet(params: {
  campaignId: string;
  name: string;
  dailyBudgetCents: number; // Meta는 USD cents 단위
  targeting?: {
    age_min?: number;
    age_max?: number;
    geo_locations?: { countries: string[] };
  };
}): Promise<{ id: string }> {
  const { accessToken, adAccountId } = getCredentials();

  const targeting = params.targeting ?? {
    age_min: 25,
    age_max: 55,
    geo_locations: { countries: ['KR'] },
  };

  const body = new URLSearchParams({
    name: params.name,
    campaign_id: params.campaignId,
    daily_budget: String(params.dailyBudgetCents),
    billing_event: 'LINK_CLICKS',
    optimization_goal: 'LINK_CLICKS',
    targeting: JSON.stringify(targeting),
    status: 'PAUSED',
    access_token: accessToken,
  });

  const res = await fetch(`${BASE_URL}/${adAccountId}/adsets`, {
    method: 'POST',
    body,
  });
  const json: MetaApiResponse<{ id: string }> = await res.json();
  if (json.error) handleMetaError(json, 'createAdSet');
  return { id: json.id! };
}

// ─────────────────────────────────────────────
// 3. 광고 소재 업로드
// ─────────────────────────────────────────────
export async function uploadCreativeToMeta(params: {
  name: string;
  message: string;   // body_copy
  link: string;      // 패키지 상품 URL
  imageHash?: string;
}): Promise<{ id: string }> {
  const { accessToken, adAccountId, pageId } = getCredentials();

  if (!pageId) {
    throw new Error('META_PAGE_ID 환경변수가 설정되지 않았습니다.');
  }

  const linkData: Record<string, unknown> = {
    message: params.message,
    link: params.link,
  };
  if (params.imageHash) {
    linkData.image_hash = params.imageHash;
  }

  const objectStorySpec = {
    page_id: pageId,
    link_data: linkData,
  };

  const body = new URLSearchParams({
    name: params.name,
    object_story_spec: JSON.stringify(objectStorySpec),
    access_token: accessToken,
  });

  const res = await fetch(`${BASE_URL}/${adAccountId}/adcreatives`, {
    method: 'POST',
    body,
  });
  const json: MetaApiResponse<{ id: string }> = await res.json();
  if (json.error) handleMetaError(json, 'uploadCreativeToMeta');
  return { id: json.id! };
}

// ─────────────────────────────────────────────
// 4. 광고 생성 (adset + creative 연결)
// ─────────────────────────────────────────────
export async function createAd(params: {
  adsetId: string;
  creativeId: string;
  name: string;
}): Promise<{ id: string }> {
  const { accessToken, adAccountId } = getCredentials();

  const body = new URLSearchParams({
    name: params.name,
    adset_id: params.adsetId,
    creative: JSON.stringify({ creative_id: params.creativeId }),
    status: 'PAUSED',
    access_token: accessToken,
  });

  const res = await fetch(`${BASE_URL}/${adAccountId}/ads`, {
    method: 'POST',
    body,
  });
  const json: MetaApiResponse<{ id: string }> = await res.json();
  if (json.error) handleMetaError(json, 'createAd');
  return { id: json.id! };
}

// ─────────────────────────────────────────────
// 5. 광고 일시정지
// ─────────────────────────────────────────────
export async function pauseAd(adId: string): Promise<void> {
  const { accessToken } = getCredentials();

  const body = new URLSearchParams({
    status: 'PAUSED',
    access_token: accessToken,
  });

  const res = await fetch(`${BASE_URL}/${adId}`, {
    method: 'POST',
    body,
  });
  const json: MetaApiResponse = await res.json();
  if (json.error) handleMetaError(json, `pauseAd(${adId})`);
}

// ─────────────────────────────────────────────
// 6. 광고 활성화
// ─────────────────────────────────────────────
export async function activateAd(adId: string): Promise<void> {
  const { accessToken } = getCredentials();

  const body = new URLSearchParams({
    status: 'ACTIVE',
    access_token: accessToken,
  });

  const res = await fetch(`${BASE_URL}/${adId}`, {
    method: 'POST',
    body,
  });
  const json: MetaApiResponse = await res.json();
  if (json.error) handleMetaError(json, `activateAd(${adId})`);
}

// ─────────────────────────────────────────────
// 7. 광고 세트 예산 변경
// ─────────────────────────────────────────────
export async function updateAdsetBudget(
  adsetId: string,
  newDailyBudgetCents: number
): Promise<void> {
  const { accessToken } = getCredentials();

  const body = new URLSearchParams({
    daily_budget: String(newDailyBudgetCents),
    access_token: accessToken,
  });

  const res = await fetch(`${BASE_URL}/${adsetId}`, {
    method: 'POST',
    body,
  });
  const json: MetaApiResponse = await res.json();
  if (json.error) handleMetaError(json, `updateAdsetBudget(${adsetId})`);
}

// ─────────────────────────────────────────────
// 8. 캠페인 Insights 조회
// ─────────────────────────────────────────────
export async function fetchCampaignInsights(
  metaCampaignId: string,
  dateFrom: string, // YYYY-MM-DD
  dateTo: string    // YYYY-MM-DD
): Promise<MetaInsightData[]> {
  const { accessToken } = getCredentials();

  const params = new URLSearchParams({
    fields: 'campaign_id,spend,impressions,clicks,cpc,date_start,date_stop',
    time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
    time_increment: '1', // 일별 분류
    access_token: accessToken,
  });

  const res = await fetch(
    `${BASE_URL}/${metaCampaignId}/insights?${params.toString()}`
  );
  const json: MetaApiResponse<MetaInsightData[]> = await res.json();
  if (json.error) handleMetaError(json, `fetchCampaignInsights(${metaCampaignId})`);
  return (json.data as MetaInsightData[]) ?? [];
}

// ─────────────────────────────────────────────
// 9. KRW → Meta cents 변환 유틸
// ─────────────────────────────────────────────
export function krwToMetaCents(krw: number, usdKrwRate: number): number {
  // Meta API는 USD cents 단위 사용
  return Math.max(100, Math.round((krw / usdKrwRate) * 100));
}

// ─────────────────────────────────────────────
// 10. Meta API 설정 여부 확인
// ─────────────────────────────────────────────
export function isMetaConfigured(): boolean {
  return !!(
    process.env.META_ACCESS_TOKEN &&
    process.env.META_AD_ACCOUNT_ID
  );
}

export interface MetaAdAccountFields {
  name: string;
  account_status?: number;
  balance?: string;
  amount_spent?: string;
  spend_cap?: string;
  currency?: string;
}

/**
 * 광고계정 스냅샷 (잔액·지출) — AdController 잔액 동기화용.
 * balance / amount_spent 는 통화 단위가 계정 설정에 따름.
 */
export async function fetchAdAccountSnapshot(): Promise<MetaAdAccountFields> {
  const { accessToken, adAccountId } = getCredentials();
  const params = new URLSearchParams({
    fields: 'name,account_status,balance,amount_spent,spend_cap,currency',
    access_token: accessToken,
  });
  const res = await fetch(`${BASE_URL}/${adAccountId}?${params.toString()}`);
  const json = (await res.json()) as MetaApiResponse<MetaAdAccountFields> & Partial<MetaAdAccountFields>;
  if (json.error) handleMetaError(json, 'fetchAdAccountSnapshot');
  return json as MetaAdAccountFields;
}
