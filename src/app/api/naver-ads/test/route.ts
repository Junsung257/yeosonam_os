/**
 * GET /api/naver-ads/test
 *
 * 네이버 검색광고 API 연결 테스트
 * - 키워드 검색 도구 (keywordstool) 호출
 * - 광고 계정 상태 확인
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  fetchNaverKeywordTool,
  getGoogleAdsConfigStatus,
  getNaverAdsConfigStatus,
  isNaverAdsConfigured,
} from '@/lib/search-ads-api';
import { getSecret } from '@/lib/secret-registry';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const hintParam = request.nextUrl.searchParams.get('keyword') || '여행';

  const result: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    naver_ads: {
      ...getNaverAdsConfigStatus(),
    },
    google_ads: {
      ...getGoogleAdsConfigStatus(),
      client_id: getSecret('GOOGLE_ADS_CLIENT_ID') ? '✅ 설정됨' : '❌ 미설정',
    },
  };

  // 네이버 키워드 검색 도구 테스트
  if (isNaverAdsConfigured()) {
    try {
      const keywords = await fetchNaverKeywordTool([hintParam]);
      result.naver_ads_keyword_test = {
        keyword: hintParam,
        total_results: keywords.length,
        samples: keywords.slice(0, 10).map(k => ({
          keyword: k.relKeyword,
          pcSearches: k.monthlyPcQcCnt,
          mobileSearches: k.monthlyMobileQcCnt,
          totalSearches: k.monthlyPcQcCnt + k.monthlyMobileQcCnt,
          competition: k.compIdx,
          lowBid: k.lowPrice,
          highBid: k.highPrice,
        })),
      };
    } catch (err) {
      result.naver_ads_keyword_test = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return NextResponse.json(result);
}
