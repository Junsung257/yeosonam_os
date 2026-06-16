import { google } from 'googleapis';
import { getSecret } from '@/lib/secret-registry';

/**
 * Google Search Console API — 색인 상태 + 페이지 단위 평균 순위 헬퍼
 *
 * 기존 src/lib/gsc-client.ts 는 query 단위(page+query 차원) 데이터 + Indexing API 를 담당.
 * 이 모듈은 cron/gsc-index-rank 전용으로:
 *   1) page-only 차원 평균 순위 (대시보드/리포트 용)
 *   2) URL Inspection API — 개별 URL 색인 상태 (indexed / not indexed / crawled / etc.)
 * 를 노출한다.
 *
 * 환경변수:
 *   GSC_SERVICE_ACCOUNT_JSON      — Service Account JSON 전체 내용 (신규, 권장)
 *   GOOGLE_SERVICE_ACCOUNT_JSON   — 기존 키 (fallback, 점진 마이그레이션용)
 *   GSC_SITE_URL                  — Search Console 등록 속성 (예: 'https://yeosonam.com/')
 */

function readServiceAccountCredentialsRaw(): string | null {
  return (
    getSecret('GSC_SERVICE_ACCOUNT_JSON')
    || getSecret('GOOGLE_SERVICE_ACCOUNT_JSON')
  );
}

function parseServiceAccountJson(raw: string) {
  let normalized = raw.trim();
  try {
    return JSON.parse(normalized);
  } catch {
    normalized = normalized.replace(
      /("private_key"\s*:\s*")([\s\S]*?)(",\s*"client_email")/,
      (_match, prefix: string, key: string, suffix: string) =>
        `${prefix}${key.replace(/\r?\n/g, '\\n')}${suffix}`,
    );
    return JSON.parse(normalized);
  }
}

export function isGSCApiConfigured(): boolean {
  return !!readServiceAccountCredentialsRaw();
}

function buildAuth(scopes: string[]) {
  const raw = readServiceAccountCredentialsRaw();
  if (!raw) return null;
  try {
    const parsed = parseServiceAccountJson(raw);
    if (parsed.private_key && typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return new google.auth.GoogleAuth({ credentials: parsed, scopes });
  } catch (err) {
    console.error('[gsc-api] Service Account JSON 파싱 실패:', err);
    return null;
  }
}

function getSearchConsoleClient() {
  const auth = buildAuth(['https://www.googleapis.com/auth/webmasters.readonly']);
  if (!auth) return null;
  return google.searchconsole({ version: 'v1', auth });
}

export interface PageMetrics {
  page: string;
  impressions: number;
  clicks: number;
  ctr: number;          // 0~1
  position: number;     // 평균 순위
  startDate: string;
  endDate: string;
}

/**
 * 페이지 단위 (query 차원 없음) 평균 순위 / 노출 / 클릭 집계.
 * GSC 는 최근 1~2 일은 데이터 비어있을 수 있으므로 호출 측에서 lookback 조정.
 *
 * @param siteUrl   Search Console 속성 (e.g. 'https://yeosonam.com/')
 * @param startDate YYYY-MM-DD
 * @param endDate   YYYY-MM-DD (inclusive)
 * @param opts.pageContains  /blog/ 처럼 특정 경로만 필터링
 */
export async function fetchPageLevelMetrics(
  siteUrl: string,
  startDate: string,
  endDate: string,
  opts?: { pageContains?: string; rowLimit?: number },
): Promise<PageMetrics[]> {
  const client = getSearchConsoleClient();
  if (!client) return [];

  try {
    const res = await client.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['page'],
        rowLimit: opts?.rowLimit ?? 1000,
        ...(opts?.pageContains
          ? {
              dimensionFilterGroups: [{
                filters: [{
                  dimension: 'page',
                  operator: 'contains',
                  expression: opts.pageContains,
                }],
              }],
            }
          : {}),
      },
    });

    const rows = res.data.rows || [];
    return rows.map((row) => ({
      page: row.keys?.[0] || '',
      impressions: row.impressions || 0,
      clicks: row.clicks || 0,
      ctr: row.ctr || 0,
      position: row.position || 0,
      startDate,
      endDate,
    }));
  } catch (err) {
    console.error('[gsc-api] page-level searchanalytics.query 실패:', err);
    return [];
  }
}

export type IndexCoverageVerdict =
  | 'PASS'
  | 'PARTIAL'
  | 'FAIL'
  | 'NEUTRAL'
  | 'VERDICT_UNSPECIFIED';

export interface UrlInspectionResult {
  url: string;
  verdict: IndexCoverageVerdict | null;
  coverageState: string | null;
  indexingState: string | null;
  lastCrawlTime: string | null;
  pageFetchState: string | null;
  robotsTxtState: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  raw?: unknown;
  error?: string;
}

/**
 * URL Inspection API — 단일 URL 색인 상태 조회.
 * 일일 호출 한도가 있으니 cron 측에서 N개 제한 + 캐싱.
 *
 * GSC 속성 호스트(www 유무)에 맞춰 검사 URL을 보정한다.
 *
 * scopes: webmasters (search console 읽기) 면 충분.
 */
const GSC_SITE_HOST = (() => {
  try {
    const raw = process.env.GSC_SITE_URL || '';
    return raw ? new URL(raw).hostname : 'www.yeosonam.com';
  } catch {
    return 'www.yeosonam.com';
  }
})();

function normalizeInspectionUrl(url: string): string {
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

export async function inspectUrlIndexState(
  siteUrl: string,
  inspectionUrl: string,
  languageCode: string = 'ko',
): Promise<UrlInspectionResult> {
  const auth = buildAuth(['https://www.googleapis.com/auth/webmasters']);
  if (!auth) {
    return makeInspectionError(inspectionUrl, 'GSC_SERVICE_ACCOUNT_JSON 미설정');
  }

  // GSC 속성과 inspectionUrl의 도메인을 일치시킨다 (www 유무 차이 해결)
  const normalizedUrl = normalizeInspectionUrl(inspectionUrl);

  try {
    const client = await auth.getClient();
    const tokenRes = await client.getAccessToken();
    const accessToken = tokenRes?.token;
    if (!accessToken) {
      return makeInspectionError(inspectionUrl, 'access token 발급 실패');
    }

    const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        siteUrl,
        inspectionUrl: normalizedUrl,
        languageCode,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const is403 = res.status === 403;
      if (is403) {
        console.warn('[gsc-api] URL Inspection API 403 — GSC Service Account에 Owner 권한 필요. siteUrl:', siteUrl);
      }
      return makeInspectionError(inspectionUrl, `HTTP ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      inspectionResult?: {
        indexStatusResult?: {
          verdict?: IndexCoverageVerdict;
          coverageState?: string;
          indexingState?: string;
          lastCrawlTime?: string;
          pageFetchState?: string;
          robotsTxtState?: string;
          googleCanonical?: string;
          userCanonical?: string;
        };
      };
    };
    const r = data.inspectionResult?.indexStatusResult || {};
    return {
      url: inspectionUrl,
      verdict: r.verdict ?? null,
      coverageState: r.coverageState ?? null,
      indexingState: r.indexingState ?? null,
      lastCrawlTime: r.lastCrawlTime ?? null,
      pageFetchState: r.pageFetchState ?? null,
      robotsTxtState: r.robotsTxtState ?? null,
      googleCanonical: r.googleCanonical ?? null,
      userCanonical: r.userCanonical ?? null,
      raw: data,
    };
  } catch (err) {
    return makeInspectionError(inspectionUrl, err instanceof Error ? err.message : String(err));
  }
}

function makeInspectionError(url: string, message: string): UrlInspectionResult {
  return {
    url,
    verdict: null,
    coverageState: null,
    indexingState: null,
    lastCrawlTime: null,
    pageFetchState: null,
    robotsTxtState: null,
    googleCanonical: null,
    userCanonical: null,
    error: message,
  };
}

/** URL 경로에서 slug 추출 (/blog/my-post → my-post) */
export function extractBlogSlugFromUrl(url: string): string | null {
  const match = url.match(/\/blog\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
