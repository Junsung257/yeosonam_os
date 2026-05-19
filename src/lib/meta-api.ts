/**
 * Meta Marketing API 클라이언트
 * - 모든 호출은 서버사이드 전용 (API 라우트 내부에서만 import)
 * - 추가 npm 패키지 없음 — raw fetch() 사용
 * - Base URL: https://graph.facebook.com/v18.0/
 */

import type { MetaApiResponse, MetaInsightData } from '@/types/meta-ads';
import { getSecret, hasSecrets } from '@/lib/secret-registry';

const BASE_URL = 'https://graph.facebook.com/v18.0';

function getCredentials() {
  const accessToken = getSecret('META_ACCESS_TOKEN');
  const adAccountId = getSecret('META_AD_ACCOUNT_ID'); // "act_XXXXXXXXX" 형식
  const pageId = getSecret('META_PAGE_ID');

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
// 6-bis. 캠페인 PAUSE / ACTIVATE (광고 단위가 아닌 캠페인 전체)
// ─────────────────────────────────────────────
export async function pauseMetaCampaign(campaignId: string): Promise<void> {
  const { accessToken } = getCredentials();
  const body = new URLSearchParams({
    status: 'PAUSED',
    access_token: accessToken,
  });
  const res = await fetch(`${BASE_URL}/${campaignId}`, { method: 'POST', body });
  const json: MetaApiResponse = await res.json();
  if (json.error) handleMetaError(json, `pauseMetaCampaign(${campaignId})`);
}

export async function activateMetaCampaign(campaignId: string): Promise<void> {
  const { accessToken } = getCredentials();
  const body = new URLSearchParams({
    status: 'ACTIVE',
    access_token: accessToken,
  });
  const res = await fetch(`${BASE_URL}/${campaignId}`, { method: 'POST', body });
  const json: MetaApiResponse = await res.json();
  if (json.error) handleMetaError(json, `activateMetaCampaign(${campaignId})`);
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
// 8-bis. 활성 캠페인 목록 (자동 PAUSE 후보 선별용)
// ─────────────────────────────────────────────
export interface MetaCampaignSummary {
  id: string;
  name: string;
  status: string;
  objective?: string;
  daily_budget?: string;
}

export async function listActiveCampaigns(): Promise<MetaCampaignSummary[]> {
  const { accessToken, adAccountId } = getCredentials();
  const params = new URLSearchParams({
    fields: 'id,name,status,objective,daily_budget',
    effective_status: '["ACTIVE"]',
    limit: '100',
    access_token: accessToken,
  });
  const res = await fetch(`${BASE_URL}/${adAccountId}/campaigns?${params.toString()}`);
  const json = (await res.json()) as MetaApiResponse<MetaCampaignSummary[]> & { data?: MetaCampaignSummary[] };
  if (json.error) handleMetaError(json, 'listActiveCampaigns');
  return json.data ?? [];
}

// ─────────────────────────────────────────────
// 8-ter. 캠페인 ROAS 계산 (action_values 의 purchase 활용)
// ─────────────────────────────────────────────
export interface MetaCampaignROAS {
  campaignId: string;
  spend: number;       // 통화 단위 (KRW 계정이면 원)
  revenue: number;     // 통화 단위
  conversions: number;
  roasPct: number;     // revenue / spend * 100
  impressions: number;
  clicks: number;
}

interface MetaActionRow {
  action_type: string;
  value: string;
}

/** 캠페인 단위 ROAS — 기본 7일 윈도우 (Meta 표준 7-day-click) */
export async function fetchCampaignROAS(
  campaignId: string,
  daysBack: number = 7,
): Promise<MetaCampaignROAS> {
  const { accessToken } = getCredentials();
  const to = new Date();
  const from = new Date(to.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    fields: 'spend,impressions,clicks,actions,action_values',
    time_range: JSON.stringify({
      since: from.toISOString().slice(0, 10),
      until: to.toISOString().slice(0, 10),
    }),
    access_token: accessToken,
  });
  const res = await fetch(`${BASE_URL}/${campaignId}/insights?${params.toString()}`);
  const json = (await res.json()) as MetaApiResponse<
    Array<{
      spend?: string;
      impressions?: string;
      clicks?: string;
      actions?: MetaActionRow[];
      action_values?: MetaActionRow[];
    }>
  >;
  if (json.error) handleMetaError(json, `fetchCampaignROAS(${campaignId})`);
  const row = json.data?.[0];
  if (!row) {
    return { campaignId, spend: 0, revenue: 0, conversions: 0, roasPct: 0, impressions: 0, clicks: 0 };
  }
  const spend = Number(row.spend ?? 0);
  const purchaseAction = row.actions?.find((a) => a.action_type === 'purchase' || a.action_type === 'omni_purchase');
  const purchaseValue = row.action_values?.find((a) => a.action_type === 'purchase' || a.action_type === 'omni_purchase');
  const conversions = Number(purchaseAction?.value ?? 0);
  const revenue = Number(purchaseValue?.value ?? 0);
  const roasPct = spend > 0 ? Math.round((revenue / spend) * 100) : 0;
  return {
    campaignId,
    spend: Math.round(spend),
    revenue: Math.round(revenue),
    conversions: Math.round(conversions),
    roasPct,
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
  };
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
  return hasSecrets(['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID']);
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
