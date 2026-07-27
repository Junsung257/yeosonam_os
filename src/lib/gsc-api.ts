import { google } from 'googleapis';
import { getSecret } from '@/lib/secret-registry';
import { buildGscSearchSiteUrlCandidates } from '@/lib/gsc-site-url';

function readServiceAccountCredentialsRaw(): string | null {
  return (
    getSecret('GSC_SERVICE_ACCOUNT_JSON')
    || getSecret('GOOGLE_SERVICE_ACCOUNT_JSON')
  );
}

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
  if (parsed.private_key && typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

export function isGSCApiConfigured(): boolean {
  return !!readServiceAccountCredentialsRaw();
}

function buildAuth(scopes: string[]) {
  const raw = readServiceAccountCredentialsRaw();
  if (!raw) return null;
  try {
    return new google.auth.GoogleAuth({ credentials: parseServiceAccountJson(raw), scopes });
  } catch (err) {
    console.error('[gsc-api] failed to parse service account JSON:', err);
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
  ctr: number;
  position: number;
  startDate: string;
  endDate: string;
  gscSiteUrl?: string;
}

async function queryPageLevelMetrics(
  client: ReturnType<typeof google.searchconsole>,
  siteUrl: string,
  startDate: string,
  endDate: string,
  opts?: { pageContains?: string; rowLimit?: number },
): Promise<PageMetrics[]> {
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
    gscSiteUrl: siteUrl,
  }));
}

export async function fetchPageLevelMetrics(
  siteUrl: string,
  startDate: string,
  endDate: string,
  opts?: { pageContains?: string; rowLimit?: number },
): Promise<PageMetrics[]> {
  const client = getSearchConsoleClient();
  if (!client) return [];

  const candidates = buildGscSearchSiteUrlCandidates(siteUrl);
  const errors: string[] = [];
  let firstEmpty: PageMetrics[] | null = null;

  for (const candidateSiteUrl of candidates) {
    try {
      const rows = await queryPageLevelMetrics(client, candidateSiteUrl, startDate, endDate, opts);
      if (rows.length > 0) return rows;
      if (firstEmpty === null) firstEmpty = rows;
    } catch (err) {
      errors.push(`${candidateSiteUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errors.length > 0) {
    console.warn('[gsc-api] page-level searchanalytics.query candidates failed:', errors.join(' | '));
  }
  return firstEmpty ?? [];
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

export async function inspectUrlIndexState(
  siteUrl: string,
  inspectionUrl: string,
  languageCode: string = 'ko',
): Promise<UrlInspectionResult> {
  const auth = buildAuth(['https://www.googleapis.com/auth/webmasters']);
  if (!auth) {
    return makeInspectionError(inspectionUrl, 'GSC_SERVICE_ACCOUNT_JSON not configured');
  }

  try {
    const client = await auth.getClient();
    const tokenRes = await client.getAccessToken();
    const accessToken = tokenRes?.token;
    if (!accessToken) {
      return makeInspectionError(inspectionUrl, 'failed to issue access token');
    }

    const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        siteUrl,
        inspectionUrl,
        languageCode,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      if (res.status === 403) {
        console.warn('[gsc-api] URL Inspection API 403. Service account owner permission may be required. siteUrl:', siteUrl);
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

export function extractBlogSlugFromUrl(url: string): string | null {
  const match = url.match(/\/blog\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
