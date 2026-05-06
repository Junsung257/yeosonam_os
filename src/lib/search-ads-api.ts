/**
 * ══════════════════════════════════════════════════════════
 * Search Ads API — 네이버/구글 검색광고 API 래퍼
 * ══════════════════════════════════════════════════════════
 * API 키 미설정 시 mock 데이터 반환 (graceful fallback)
 */

import type { SearchAdKeyword, Platform } from './keyword-brain';
import { getSecret } from '@/lib/secret-registry';

// ── 환경 변수 체크 ───────────────────────────────────────
export function isNaverAdsConfigured(): boolean {
  return !!(getSecret('NEXT_PUBLIC_NAVER_ADS_API_KEY') && getSecret('NEXT_PUBLIC_NAVER_ADS_CUSTOMER_ID'));
}

export function isGoogleAdsConfigured(): boolean {
  return !!getSecret('NEXT_PUBLIC_GOOGLE_ADS_DEVELOPER_TOKEN');
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

export async function fetchNaverPerformance(keywords: SearchAdKeyword[]): Promise<SearchAdPerformance[]> {
  if (!isNaverAdsConfigured()) {
    // Mock fallback
    return generateMockPerformance(keywords.filter(k => k.platform === 'naver'));
  }

  // TODO: 실제 네이버 검색광고 API 연동
  // POST https://api.searchad.naver.com/keywordstool
  // GET https://api.searchad.naver.com/stats
  return generateMockPerformance(keywords.filter(k => k.platform === 'naver'));
}

export async function updateNaverBid(keywordId: string, newBid: number): Promise<boolean> {
  if (!isNaverAdsConfigured()) {
    console.log(`[Mock] 네이버 입찰가 변경: ${keywordId} → ₩${newBid}`);
    return true;
  }
  // TODO: PUT https://api.searchad.naver.com/ncc/keywords/{keywordId}
  return true;
}

export async function pauseNaverKeyword(keywordId: string): Promise<boolean> {
  if (!isNaverAdsConfigured()) {
    console.log(`[Mock] 네이버 키워드 정지: ${keywordId}`);
    return true;
  }
  // TODO: PUT status=PAUSED
  return true;
}

// ── 구글 Ads API ─────────────────────────────────────────

export async function fetchGooglePerformance(keywords: SearchAdKeyword[]): Promise<SearchAdPerformance[]> {
  if (!isGoogleAdsConfigured()) {
    return generateMockPerformance(keywords.filter(k => k.platform === 'google'));
  }
  // TODO: Google Ads API v16 연동
  return generateMockPerformance(keywords.filter(k => k.platform === 'google'));
}

export async function updateGoogleBid(keywordId: string, newBid: number): Promise<boolean> {
  if (!isGoogleAdsConfigured()) {
    console.log(`[Mock] 구글 입찰가 변경: ${keywordId} → ₩${newBid}`);
    return true;
  }
  return true;
}

export async function pauseGoogleKeyword(keywordId: string): Promise<boolean> {
  if (!isGoogleAdsConfigured()) {
    console.log(`[Mock] 구글 키워드 정지: ${keywordId}`);
    return true;
  }
  return true;
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
