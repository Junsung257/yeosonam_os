/**
 * 통합 검색엔진 색인 요청 모듈
 *
 * 호출 한 번으로 다음을 동시 실행:
 *   1. Google Indexing API (개별 URL, Service Account 필요, 일 200회 제한)
 *   2. IndexNow (Bing/Yandex/Seznam, 키 파일 검증 필요)
 *   3. Sitemap ping (구글은 2023년 폐지됐지만 Bing/네이버는 아직 작동)
 *
 * 모든 호출은 fire-and-forget. 실패해도 발행 흐름 막지 않음.
 */

import { requestGoogleIndexing, IndexingResult } from './gsc-client';

const INDEXNOW_KEY = process.env.INDEXNOW_KEY || '2bf8a3e4yeosonam7c1d9f6e0b5a';

export interface IndexingReport {
  url: string;
  google: 'success' | 'failed' | 'skipped';
  google_error?: string;
  indexnow: 'success' | 'failed';
  indexnow_error?: string;
  sitemap_pings: { provider: string; ok: boolean }[];
  duration_ms: number;
}

/**
 * 단일 URL 색인 요청 (모든 검색엔진에 동시 알림)
 *
 * 사용 예:
 *   notifyIndexing(`${baseUrl}/blog/${slug}`, baseUrl)  // 블로그 발행 시
 *   notifyIndexing(`${baseUrl}/blog/${slug}`, baseUrl, { type: 'URL_DELETED' })  // 삭제 시
 */
export async function notifyIndexing(
  url: string,
  baseUrl: string,
  options: { type?: 'URL_UPDATED' | 'URL_DELETED'; pingSitemap?: boolean } = {},
): Promise<IndexingReport> {
  const startedAt = Date.now();
  const { type = 'URL_UPDATED', pingSitemap = true } = options;
  const sitemapUrl = `${baseUrl}/sitemap.xml`;
  const host = new URL(baseUrl).host;

  const report: IndexingReport = {
    url,
    google: 'skipped',
    indexnow: 'failed',
    sitemap_pings: [],
    duration_ms: 0,
  };

  // 1. Google Indexing API (개별 URL 알림)
  const googleResult: IndexingResult = await requestGoogleIndexing(url, type);
  report.google = googleResult.ok ? 'success' : 'failed';
  if (!googleResult.ok) report.google_error = googleResult.error;

  // 2. IndexNow (Bing/Yandex/Seznam 통합)
  try {
    const indexnowRes = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host,
        key: INDEXNOW_KEY,
        keyLocation: `${baseUrl}/${INDEXNOW_KEY}.txt`,
        urlList: [url],
      }),
    });
    // IndexNow: 200 = 색인 요청 수락, 202 = 처리 중, 400 = 잘못된 요청, 403 = 키 미일치
    report.indexnow = (indexnowRes.status === 200 || indexnowRes.status === 202) ? 'success' : 'failed';
    if (!report.indexnow.includes('success')) {
      report.indexnow_error = `HTTP ${indexnowRes.status}`;
    }
  } catch (err) {
    report.indexnow_error = err instanceof Error ? err.message : String(err);
  }

  // 3. Sitemap ping (Bing/네이버용 — 구글은 2023년 폐지됐지만 호환성 유지)
  if (pingSitemap) {
    const pings = [
      { name: 'bing', url: `https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}` },
    ];
    for (const p of pings) {
      try {
        const r = await fetch(p.url);
        report.sitemap_pings.push({ provider: p.name, ok: r.ok });
      } catch {
        report.sitemap_pings.push({ provider: p.name, ok: false });
      }
    }
  }

  report.duration_ms = Date.now() - startedAt;
  return report;
}

/**
 * 여러 URL 일괄 색인 요청 (재발행, 대량 마이그레이션 등)
 * 일 200 URL 제한 (Google) 주의
 */
export async function notifyIndexingBatch(
  urls: string[],
  baseUrl: string,
  options: { type?: 'URL_UPDATED' | 'URL_DELETED' } = {},
): Promise<IndexingReport[]> {
  const { type = 'URL_UPDATED' } = options;
  const host = new URL(baseUrl).host;

  // Google Indexing은 병렬, IndexNow는 한 번에 여러 URL 전송 가능
  const googleResults = await Promise.all(
    urls.map(url => requestGoogleIndexing(url, type)),
  );

  // IndexNow batch (한 번에 최대 10,000 URL)
  let indexnowOk = false;
  let indexnowError: string | undefined;
  try {
    const indexnowRes = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host,
        key: INDEXNOW_KEY,
        keyLocation: `${baseUrl}/${INDEXNOW_KEY}.txt`,
        urlList: urls,
      }),
    });
    indexnowOk = indexnowRes.status === 200 || indexnowRes.status === 202;
    if (!indexnowOk) indexnowError = `HTTP ${indexnowRes.status}`;
  } catch (err) {
    indexnowError = err instanceof Error ? err.message : String(err);
  }

  return urls.map((url, idx) => ({
    url,
    google: googleResults[idx].ok ? 'success' : 'failed',
    google_error: googleResults[idx].error,
    indexnow: indexnowOk ? 'success' : 'failed',
    indexnow_error: indexnowError,
    sitemap_pings: [],
    duration_ms: 0,
  }));
}

export { INDEXNOW_KEY };
