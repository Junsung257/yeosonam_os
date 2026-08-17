import { google } from 'googleapis';
import { getSecret } from '@/lib/secret-registry';
import { buildGscSearchSiteUrlCandidates } from '@/lib/gsc-site-url';

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
    console.error('[gsc-client] failed to parse service account JSON:', err);
    return null;
  }
}

export function isGSCConfigured(): boolean {
  return !!readServiceAccountJson();
}

export interface GSCMetrics {
  page: string;
  query: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  date: string;
  gscSiteUrl?: string;
}

async function queryBlogSearchMetrics(
  client: ReturnType<typeof google.searchconsole>,
  siteUrl: string,
  date: string,
  pageFilter: boolean,
): Promise<GSCMetrics[]> {
  const rowLimit = 25_000;
  const maximumRows = 50_000;
  const output: GSCMetrics[] = [];
  for (let startRow = 0; startRow < maximumRows; startRow += rowLimit) {
    const res = await client.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: date,
        endDate: date,
        dimensions: ['date', 'page', 'query'],
        rowLimit,
        startRow,
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
    output.push(...rows.map((row) => ({
      date: row.keys?.[0] || date,
      page: row.keys?.[1] || '',
      query: row.keys?.[2] || null,
      impressions: row.impressions || 0,
      clicks: row.clicks || 0,
      ctr: row.ctr || 0,
      position: row.position || 0,
      gscSiteUrl: siteUrl,
    })));
    if (rows.length < rowLimit) break;
  }
  return output;
}

export async function fetchBlogSearchMetrics(
  siteUrl: string,
  date: string,
  pageFilter: boolean = true,
): Promise<GSCMetrics[]> {
  const client = getGSCClient();
  if (!client) return [];

  const candidates = buildGscSearchSiteUrlCandidates(siteUrl);
  const errors: string[] = [];
  let firstEmpty: GSCMetrics[] | null = null;

  for (const candidateSiteUrl of candidates) {
    try {
      const rows = await queryBlogSearchMetrics(client, candidateSiteUrl, date, pageFilter);
      if (rows.length > 0) return rows;
      if (firstEmpty === null) firstEmpty = rows;
    } catch (err) {
      errors.push(`${candidateSiteUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errors.length > 0) {
    console.warn('[gsc-client] searchanalytics.query candidates failed:', errors.join(' | '));
  }
  return firstEmpty ?? [];
}

export function extractSlugFromUrl(url: string): string | null {
  const match = url.match(/\/blog\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

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
  const candidates = buildGscSearchSiteUrlCandidates(process.env.GSC_SITE_URL, {
    canonicalOrigin: baseUrl,
  });
  return candidates[0] ?? 'https://www.yeosonam.com/';
}

function gscSiteUrlCandidates(baseUrl: string): string[] {
  return buildGscSearchSiteUrlCandidates(process.env.GSC_SITE_URL, {
    canonicalOrigin: baseUrl,
  });
}

export async function submitGoogleSitemap(
  sitemapUrl: string,
  baseUrl: string,
): Promise<GoogleSitemapSubmitResult> {
  const serviceAccountJson = readServiceAccountJson();
  if (!serviceAccountJson) {
    return { ok: false, sitemapUrl, error: 'GSC_SERVICE_ACCOUNT_JSON not configured' };
  }

  try {
    const credentials = parseServiceAccountJson(serviceAccountJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/webmasters'],
    });
    const client = google.searchconsole({ version: 'v1', auth });
    const errors: string[] = [];
    for (const siteUrl of gscSiteUrlCandidates(baseUrl)) {
      try {
        await client.sitemaps.submit({
          siteUrl,
          feedpath: sitemapUrl,
        });
        return { ok: true, sitemapUrl };
      } catch (err) {
        errors.push(`${siteUrl}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { ok: false, sitemapUrl, error: errors.join(' | ') };
  } catch (err) {
    return {
      ok: false,
      sitemapUrl,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const GSC_SITE_HOST = (() => {
  try {
    const normalized = normalizeSiteUrlForGSC(process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com/');
    return normalized.startsWith('sc-domain:')
      ? 'www.yeosonam.com'
      : new URL(normalized).hostname;
  } catch {
    return 'www.yeosonam.com';
  }
})();

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
    return { url, ok: false, error: 'GSC_SERVICE_ACCOUNT_JSON/GOOGLE_SERVICE_ACCOUNT_JSON not configured' };
  }

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
      return { url, ok: false, error: 'failed to issue access token' };
    }

    const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: gscUrl, type }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return { url: gscUrl, ok: false, error: `HTTP ${res.status}: ${errBody.slice(0, 200)}` };
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

export async function requestGoogleIndexingBatch(
  urls: string[],
  type: 'URL_UPDATED' | 'URL_DELETED' = 'URL_UPDATED',
): Promise<IndexingResult[]> {
  return Promise.all(urls.map(url => requestGoogleIndexing(url, type)));
}
