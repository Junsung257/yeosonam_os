import { google } from 'googleapis';

/**
 * Google Search Console API 래퍼
 *
 * 환경변수:
 *   GOOGLE_SERVICE_ACCOUNT_JSON — Service Account JSON 전체 내용 (string)
 *
 * 사전 준비 (관리자가 1회 수행):
 *   1. Google Cloud Console → Search Console API 활성화
 *   2. IAM → Service Account 생성 → JSON 키 발급
 *   3. Search Console (search.google.com/search-console) → 속성 설정 → 사용자
 *      → Service Account 이메일 추가 (권한: 제한적 또는 전체)
 */

function getGSCClient() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) return null;

  try {
    const credentials = JSON.parse(serviceAccountJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
    return google.searchconsole({ version: 'v1', auth });
  } catch (err) {
    console.error('[gsc-client] Service Account JSON 파싱 실패:', err);
    return null;
  }
}

export function isGSCConfigured(): boolean {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
}

export interface GSCMetrics {
  page: string;           // URL
  query: string | null;   // 검색어
  impressions: number;
  clicks: number;
  ctr: number;            // 0~1
  position: number;       // 평균 순위
  date: string;           // YYYY-MM-DD
}

/**
 * 특정 날짜의 블로그 URL별 검색 성과 조회
 * @param siteUrl - Search Console에 등록된 도메인 (예: 'https://yeosonam.com/')
 * @param date - YYYY-MM-DD
 * @param pageFilter - /blog/ 경로만 필터링 (기본 true)
 */
export async function fetchBlogSearchMetrics(
  siteUrl: string,
  date: string,
  pageFilter: boolean = true,
): Promise<GSCMetrics[]> {
  const client = getGSCClient();
  if (!client) return [];

  try {
    const res = await client.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: date,
        endDate: date,
        dimensions: ['page', 'query'],
        rowLimit: 1000,
        ...(pageFilter && {
          dimensionFilterGroups: [{
            filters: [{
              dimension: 'page',
              operator: 'contains',
              expression: '/blog/',
            }],
          }],
        }),
      },
    });

    const rows = res.data.rows || [];
    return rows.map((row) => ({
      page: row.keys?.[0] || '',
      query: row.keys?.[1] || null,
      impressions: row.impressions || 0,
      clicks: row.clicks || 0,
      ctr: row.ctr || 0,
      position: row.position || 0,
      date,
    }));
  } catch (err) {
    console.error('[gsc-client] searchanalytics.query 실패:', err);
    return [];
  }
}

/**
 * URL 경로에서 slug 추출 (/blog/my-post → my-post)
 */
export function extractSlugFromUrl(url: string): string | null {
  const match = url.match(/\/blog\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// ========================================================================
// Google Indexing API — 개별 URL 색인 요청 (즉시 크롤링 트리거)
// ========================================================================
//
// Search Console API와 별도 API. Service Account가 Search Console에 owner여야 작동.
// 일 200 URL 제한.
//
// 사전 준비 (1회):
//   1. Google Cloud Console → "Indexing API" 활성화
//   2. Search Console → 속성 설정 → 사용자 → Service Account 이메일을 **소유자(Owner)** 권한으로 추가
//      ※ "전체" 권한이 아니라 "소유자" 권한 필요
//
// 참고: 공식적으로 JobPosting/BroadcastEvent 전용이지만 일반 페이지도 동작 확인됨
// ========================================================================

export interface IndexingResult {
  url: string;
  ok: boolean;
  error?: string;
  notify_time?: string;
}

/**
 * Google에 개별 URL 색인/삭제 요청
 * @param url 색인 요청할 전체 URL
 * @param type 'URL_UPDATED' (신규/업데이트) | 'URL_DELETED' (삭제 알림)
 */
export async function requestGoogleIndexing(
  url: string,
  type: 'URL_UPDATED' | 'URL_DELETED' = 'URL_UPDATED',
): Promise<IndexingResult> {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    return { url, ok: false, error: 'GOOGLE_SERVICE_ACCOUNT_JSON 미설정' };
  }

  try {
    const credentials = JSON.parse(serviceAccountJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/indexing'],
    });
    const client = await auth.getClient();
    const accessToken = (await client.getAccessToken()).token;
    if (!accessToken) {
      return { url, ok: false, error: 'access token 발급 실패' };
    }

    const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, type }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return { url, ok: false, error: `HTTP ${res.status}: ${errBody.slice(0, 200)}` };
    }

    const data = await res.json();
    return {
      url,
      ok: true,
      notify_time: data?.urlNotificationMetadata?.latestUpdate?.notifyTime,
    };
  } catch (err) {
    return {
      url,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 여러 URL 일괄 색인 요청 (병렬, fire-and-forget 권장)
 * 일 200 URL 제한 주의
 */
export async function requestGoogleIndexingBatch(
  urls: string[],
  type: 'URL_UPDATED' | 'URL_DELETED' = 'URL_UPDATED',
): Promise<IndexingResult[]> {
  return Promise.all(urls.map(url => requestGoogleIndexing(url, type)));
}
