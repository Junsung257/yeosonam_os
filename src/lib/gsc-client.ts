import { google } from 'googleapis';
import { getSecret } from '@/lib/secret-registry';

/**
 * Google Search Console API 래퍼
 *
 * 환경변수:
 *   GSC_SERVICE_ACCOUNT_JSON / GOOGLE_SERVICE_ACCOUNT_JSON — Service Account JSON 전체 내용 (string)
 *
 * 사전 준비 (관리자가 1회 수행):
 *   1. Google Cloud Console → Search Console API 활성화
 *   2. IAM → Service Account 생성 → JSON 키 발급
 *   3. Search Console (search.google.com/search-console) → 속성 설정 → 사용자
 *      → Service Account 이메일 추가 (권한: 제한적 또는 전체)
 */

/** 꼬인 \n 이스케이프를 가진 Service Account JSON을 안전하게 파싱 */
function parseServiceAccountJson(raw: string) {
  let normalized = raw.trim();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    normalized = normalized.replace(
      /("private_key"\s*:\s*")([\s\S]*?)(",\s*"client_email")/,
      (_match, prefix: string, key: string, suffix: string) =>
        `${prefix}${key.replace(/\r?\n/g, '\\n')}${suffix}`,
    );
    parsed = JSON.parse(normalized);
  }
  // 2) private_key에 literal \n (두 글자)이 있으면 실제 개행으로 변환
  if (parsed.private_key && typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

function readServiceAccountJson(): string | null {
  return getSecret('GSC_SERVICE_ACCOUNT_JSON') || getSecret('GOOGLE_SERVICE_ACCOUNT_JSON');
}

function getGSCClient() {
  const serviceAccountJson = readServiceAccountJson();
  if (!serviceAccountJson) return null;

  try {
    const credentials = parseServiceAccountJson(serviceAccountJson);
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
  return !!readServiceAccountJson();
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
// 참고: Google 공식 문서상 JobPosting/BroadcastEvent 전용이다.
// 일반 블로그는 notifyIndexing()에서 Search Console Sitemaps API를 기본 경로로 사용한다.
// ========================================================================

export interface IndexingResult {
  url: string;
  ok: boolean;
  error?: string;
  notify_time?: string;
}

export interface GoogleSitemapSubmitResult {
  ok: boolean;
  sitemapUrl: string;
  error?: string;
}

function normalizeSiteUrlForGSC(baseUrl: string): string {
  const configured = process.env.GSC_SITE_URL;
  try {
    const parsed = new URL(baseUrl);
    parsed.pathname = '/';
    parsed.search = '';
    parsed.hash = '';
    if (configured) {
      if (configured.startsWith('sc-domain:')) return configured;
      const configuredUrl = new URL(configured);
      const sameApexHost =
        configuredUrl.hostname.replace(/^www\./, '') === parsed.hostname.replace(/^www\./, '');
      if (sameApexHost && parsed.hostname.startsWith('www.') && !configuredUrl.hostname.startsWith('www.')) {
        return parsed.toString();
      }
      return configuredUrl.toString();
    }
    return parsed.toString();
  } catch {
    return 'https://www.yeosonam.com/';
  }
}

/**
 * Google Search Console Sitemaps API submit.
 *
 * This is the official Google path for telling Search Console about sitemap
 * updates for normal blog content. Unlike the Indexing API, it is not limited
 * to JobPosting/BroadcastEvent pages.
 */
export async function submitGoogleSitemap(
  sitemapUrl: string,
  baseUrl: string,
): Promise<GoogleSitemapSubmitResult> {
  const serviceAccountJson = readServiceAccountJson();
  if (!serviceAccountJson) {
    return { ok: false, sitemapUrl, error: 'GSC_SERVICE_ACCOUNT_JSON 미설정' };
  }

  try {
    const credentials = parseServiceAccountJson(serviceAccountJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/webmasters'],
    });
    const client = google.searchconsole({ version: 'v1', auth });
    await client.sitemaps.submit({
      siteUrl: normalizeSiteUrlForGSC(baseUrl),
      feedpath: sitemapUrl,
    });
    return { ok: true, sitemapUrl };
  } catch (err) {
    return {
      ok: false,
      sitemapUrl,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Google에 개별 URL 색인/삭제 요청
 * @param url 색인 요청할 전체 URL
 * @param type 'URL_UPDATED' (신규/업데이트) | 'URL_DELETED' (삭제 알림)
 */
/**
 * GSC 속성과 실제 사이트 URL의 도메인 차이(www 유무)를 보정한다.
 * GSC에 등록된 속성이 `https://yeosonam.com/`(www 없음)인데
 * NEXT_PUBLIC_BASE_URL이 `https://www.yeosonam.com`(www 있음)이면
 * Indexing API가 "URL 소유권 확인 실패"를 반환한다.
 * → Indexing API에는 GSC 속성과 일치하는 URL을 보낸다.
 */
const GSC_SITE_HOST = (() => {
  try {
    const raw = process.env.GSC_SITE_URL || '';
    return new URL(raw).hostname; // 'yeosonam.com'
  } catch {
    return 'yeosonam.com';
  }
})();

/**
 * URL의 www를 GSC 속성 호스트에 맞춰 보정한다.
 * 예: https://www.yeosonam.com/blog/post → https://yeosonam.com/blog/post
 */
function normalizeUrlForGSC(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.startsWith('www.') && !GSC_SITE_HOST.startsWith('www.')) {
      parsed.hostname = parsed.hostname.replace(/^www\./, '');
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

export async function requestGoogleIndexing(
  url: string,
  type: 'URL_UPDATED' | 'URL_DELETED' = 'URL_UPDATED',
): Promise<IndexingResult> {
  const serviceAccountJson = readServiceAccountJson();
  if (!serviceAccountJson) {
    return { url, ok: false, error: 'GSC_SERVICE_ACCOUNT_JSON/GOOGLE_SERVICE_ACCOUNT_JSON 미설정' };
  }

  // GSC 속성에 맞게 URL 보정 (www 유무 차이 해결)
  const gscUrl = normalizeUrlForGSC(url);

  try {
    const credentials = parseServiceAccountJson(serviceAccountJson);
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
      body: JSON.stringify({ url: gscUrl, type }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return { url, ok: false, error: `HTTP ${res.status}: ${errBody.slice(0, 200)}` };
    }

    const data = await res.json();
    return {
      url: gscUrl,
      ok: true,
      notify_time: data?.urlNotificationMetadata?.latestUpdate?.notifyTime,
    };
  } catch (err) {
    return {
      url: gscUrl,
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
