/**
 * Google Ads API 클라이언트 (google-ads-api npm 패키지 래퍼).
 *
 * - OAuth refresh_token 흐름 → 자격 정보 5가지 모두 필수.
 * - getCustomer() 결과는 모듈 레벨 캐시 (Vercel Fluid Compute 인스턴스 재사용 시 재생성 회피).
 * - 미설정 시 호출자가 `isGoogleAdsConfigured()` 로 먼저 가드해야 함 — 본 모듈은 가드 실패 시 throw.
 *
 * 공식 npm: https://www.npmjs.com/package/google-ads-api
 * 공식 quickstart: https://developers.google.com/google-ads/api/docs/get-started/make-first-call
 */

import { GoogleAdsApi, type Customer } from 'google-ads-api';
import { getSecret } from '@/lib/secret-registry';

interface GoogleAdsCredentials {
  clientId: string;
  clientSecret: string;
  developerToken: string;
  refreshToken: string;
  customerId: string;
}

function getCredentials(): GoogleAdsCredentials {
  const clientId = getSecret('GOOGLE_ADS_CLIENT_ID');
  const clientSecret = getSecret('GOOGLE_ADS_CLIENT_SECRET');
  const developerToken = getSecret('GOOGLE_ADS_DEVELOPER_TOKEN');
  const refreshToken = getSecret('GOOGLE_ADS_REFRESH_TOKEN');
  const customerId = getSecret('GOOGLE_ADS_CUSTOMER_ID');
  if (!clientId || !clientSecret || !developerToken || !refreshToken || !customerId) {
    throw new Error(
      'Google Ads 자격 정보 누락 — GOOGLE_ADS_CLIENT_ID / CLIENT_SECRET / DEVELOPER_TOKEN / REFRESH_TOKEN / CUSTOMER_ID 5개 모두 필요.',
    );
  }
  return { clientId, clientSecret, developerToken, refreshToken, customerId };
}

let _api: GoogleAdsApi | null = null;
let _customer: Customer | null = null;

function getApi(creds: GoogleAdsCredentials): GoogleAdsApi {
  if (!_api) {
    _api = new GoogleAdsApi({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      developer_token: creds.developerToken,
    });
  }
  return _api;
}

export function getGoogleAdsCustomer(): Customer {
  if (_customer) return _customer;
  const creds = getCredentials();
  const api = getApi(creds);
  // customer ID 는 dashes 제거 ("123-456-7890" → "1234567890") — 공식 가이드
  const cleanCustomerId = creds.customerId.replace(/-/g, '');
  _customer = api.Customer({
    customer_id: cleanCustomerId,
    refresh_token: creds.refreshToken,
  });
  return _customer;
}

/**
 * 키워드 상태 변경 (PAUSED/ENABLED/REMOVED) — Ad Group Criterion resource 단위.
 *
 * @param resourceName  "customers/{customerId}/adGroupCriteria/{adGroupId}~{criterionId}"
 *                      keyword_performances.id 가 이 형식이라고 가정 (DB 시드 시 표준화 필요).
 * @param status        "PAUSED" | "ENABLED" | "REMOVED"
 */
export async function mutateAdGroupCriterionStatus(
  resourceName: string,
  status: 'PAUSED' | 'ENABLED' | 'REMOVED',
): Promise<boolean> {
  const customer = getGoogleAdsCustomer();
  try {
    await customer.adGroupCriteria.update([
      { resource_name: resourceName, status: status as never },
    ]);
    return true;
  } catch (e) {
    console.error(`[GoogleAds] mutate status 실패 ${resourceName} → ${status}:`, (e as Error)?.message ?? e);
    return false;
  }
}

/**
 * 키워드 입찰가 변경 — cpc_bid_micros 단위 (1원 = 1,000,000 micros 의 환산은 통화별 다름,
 * 한국은 1 KRW = 1,000,000 micros 가 아니라 currency 가 KRW 인 계정에서 1 = 1_000_000 micros).
 *
 * @param resourceName  Ad Group Criterion resource name
 * @param newBidKrw     입찰가 원화 정수
 */
export async function updateAdGroupCriterionBid(
  resourceName: string,
  newBidKrw: number,
): Promise<boolean> {
  const customer = getGoogleAdsCustomer();
  try {
    await customer.adGroupCriteria.update([
      {
        resource_name: resourceName,
        cpc_bid_micros: newBidKrw * 1_000_000,
      } as never,
    ]);
    return true;
  } catch (e) {
    console.error(`[GoogleAds] update bid 실패 ${resourceName} → ${newBidKrw}원:`, (e as Error)?.message ?? e);
    return false;
  }
}

/**
 * Keyword Plan Idea Service — 시드 키워드의 추천 키워드 + 검색량 + 경쟁도 + 평균 CPC 조회.
 * https://developers.google.com/google-ads/api/docs/keyword-planning/generate-keyword-ideas
 */
export interface GoogleKeywordIdea {
  keyword: string;
  avgMonthlySearches: number;
  competition: 'UNSPECIFIED' | 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH';
  /** 환산: micros / 1_000_000 = 원 (KRW 계정 기준) */
  lowTopOfPageBidKrw: number;
  highTopOfPageBidKrw: number;
}

export async function generateKeywordIdeas(
  seedKeywords: string[],
  options: { geoTargetIds?: string[]; languageId?: string } = {},
): Promise<GoogleKeywordIdea[]> {
  if (seedKeywords.length === 0) return [];
  const customer = getGoogleAdsCustomer();
  try {
    // 한국 지역(geoTargetConstants/2410), 한국어(languageConstants/1012) 기본
    const response = (await customer.keywordPlanIdeas.generateKeywordIdeas({
      keyword_seed: { keywords: seedKeywords.slice(0, 20) },
      geo_target_constants: options.geoTargetIds ?? ['geoTargetConstants/2410'],
      language: options.languageId ?? 'languageConstants/1012',
      include_adult_keywords: false,
    } as never)) as unknown as {
      results?: Array<{
        text?: string;
        keyword_idea_metrics?: {
          avg_monthly_searches?: number | string;
          competition?: GoogleKeywordIdea['competition'];
          low_top_of_page_bid_micros?: number | string;
          high_top_of_page_bid_micros?: number | string;
        };
      }>;
    };
    const results = response?.results ?? [];
    return results.map((idea) => ({
      keyword: idea.text ?? '',
      avgMonthlySearches: Number(idea.keyword_idea_metrics?.avg_monthly_searches ?? 0),
      competition: idea.keyword_idea_metrics?.competition ?? 'UNKNOWN',
      lowTopOfPageBidKrw: Math.round(Number(idea.keyword_idea_metrics?.low_top_of_page_bid_micros ?? 0) / 1_000_000),
      highTopOfPageBidKrw: Math.round(Number(idea.keyword_idea_metrics?.high_top_of_page_bid_micros ?? 0) / 1_000_000),
    }));
  } catch (e) {
    console.warn('[GoogleAds] generateKeywordIdeas 실패:', (e as Error)?.message ?? e);
    return [];
  }
}
