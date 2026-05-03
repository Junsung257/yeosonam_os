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

const INDEXNOW_KEY = process.env.INDEXNOW_KEY ?? '';

export interface IndexingReport {
  url: string;
  google: 'success' | 'failed' | 'skipped';
  google_error?: string;
  indexnow: 'success' | 'failed' | 'skipped';
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

  // 0. Self-warmup — 발행 직후 자기 URL을 즉시 GET해서 ISR 캐시를 정상 데이터로 채운다.
  //    revalidatePath만 호출하고 끝내면 "다음 첫 요청"이 봇이 될 경우 잠깐의 빈 결과가 캐시될 위험이
  //    있어, 명시적으로 한 번 hydrate한다. URL_DELETED 시에는 스킵.
  if (type !== 'URL_DELETED') {
    try {
      await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': 'YeosonamWarmup/1.0' },
        cache: 'no-store',
        // 너무 오래 기다리지 않도록 타임아웃 — 6초면 충분
        signal: AbortSignal.timeout(6000),
      });
    } catch {
      // warmup 실패는 무시 (revalidatePath가 이미 캐시를 비웠으므로 다음 요청이 자연 hydrate)
    }
  }

  // 1. Google Indexing API (개별 URL 알림)
  const googleResult: IndexingResult = await requestGoogleIndexing(url, type);
  report.google = googleResult.ok ? 'success' : 'failed';
  if (!googleResult.ok) report.google_error = googleResult.error;

  // 2. IndexNow (Bing/Yandex/Seznam 통합) — INDEXNOW_KEY 미설정 시 스킵
  if (!INDEXNOW_KEY) {
    report.indexnow = 'skipped';
    report.indexnow_error = 'INDEXNOW_KEY 미설정';
  } else {
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
      report.indexnow = indexnowRes.status === 200 || indexnowRes.status === 202 ? 'success' : 'failed';
      if (report.indexnow !== 'success') {
        report.indexnow_error = `HTTP ${indexnowRes.status}`;
      }
    } catch (err) {
      report.indexnow_error = err instanceof Error ? err.message : String(err);
    }
  }

  // 3. Sitemap ping (Bing) + WebSub/PubSubHubbub ping (Google Feedfetcher)
  //    WebSub: Google이 구독하는 공개 허브에 RSS URL을 알려 즉시 재크롤링 유도.
  //    Service Account 없이 Google에 새 글을 알리는 표준 방식 (WordPress/Blogger 동일 방식).
  if (pingSitemap) {
    const rssUrl = `${baseUrl}/api/rss`;
    const pings = [
      { name: 'bing', url: `https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}` },
    ];
    for (const p of pings) {
      try {
        const r = await fetch(p.url, { method: 'GET' });
        report.sitemap_pings.push({ provider: p.name, ok: r.ok });
      } catch {
        report.sitemap_pings.push({ provider: p.name, ok: false });
      }
    }

    // Google WebSub/PubSubHubbub — form body 필수 (query param 방식은 411 에러)
    try {
      const body = `hub.mode=publish&hub.url=${encodeURIComponent(rssUrl)}`;
      const r = await fetch('https://pubsubhubbub.appspot.com/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      // 204 No Content = 수락, 그 외는 실패
      report.sitemap_pings.push({ provider: 'google_websub', ok: r.status === 204 });
    } catch {
      report.sitemap_pings.push({ provider: 'google_websub', ok: false });
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
