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
import { getSecret } from '@/lib/secret-registry';
import { logWarning } from './sentry-logger';

// 모듈 톱레벨이 아니라 함수 내부에서 getSecret() 호출로 변경 (서버 재시작 없이 env 변경 반영)
function getIndexNowKey(): string {
  return getSecret('INDEXNOW_KEY') ?? '';
}

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

  // 2. IndexNow (Bing/Yandex/Seznam/Naver 통합)
  const indexNowKey = getIndexNowKey();
  if (!indexNowKey) {
    report.indexnow = 'skipped';
    report.indexnow_error = 'INDEXNOW_KEY 미설정';
  } else {
    const indexNowPayload = {
      host,
      key: indexNowKey,
      keyLocation: `${baseUrl}/${indexNowKey}.txt`,
      urlList: [url],
    };
    // 글로벌 IndexNow (Bing, Yandex, Seznam 등)
    try {
      const globalRes = await fetch('https://api.indexnow.org/indexnow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(indexNowPayload),
      });
      report.indexnow = globalRes.status === 200 || globalRes.status === 202 ? 'success' : 'failed';
      if (report.indexnow !== 'success') {
        report.indexnow_error = `global HTTP ${globalRes.status}`;
      }
    } catch (err) {
      report.indexnow_error = err instanceof Error ? err.message : String(err);
    }
    // 네이버 전용 IndexNow (별도 엔드포인트 — 동일 key 사용)
    try {
      const naverRes = await fetch('https://searchadvisor.naver.com/indexnow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(indexNowPayload),
      });
      // 성공 시 indexnow 상태 유지, 실패 시에도 전체 실패로 처리하지 않음
      const naverOk = naverRes.status === 200 || naverRes.status === 202;
      if (!naverOk) {
        // naver 실패는 별도 로그만 (Bing/Yandex 경로는 이미 성공했을 수 있음)
        report.indexnow_error = report.indexnow_error
          ? `${report.indexnow_error}; naver HTTP ${naverRes.status}`
          : `naver HTTP ${naverRes.status}`;
        if (report.indexnow === 'success') {
          // 글로벌은 성공했으니 naver 실패는 부차 정보로만 남김
        }
      }
    } catch (err) {
      const naverErr = err instanceof Error ? err.message : String(err);
      report.indexnow_error = report.indexnow_error
        ? `${report.indexnow_error}; naver ${naverErr}`
        : `naver ${naverErr}`;
    }
  }

  // 3. Sitemap ping (Bing) + WebSub/PubSubHubbub ping (Google Feedfetcher)
  //    WebSub: Google이 구독하는 공개 허브에 RSS URL을 알려 즉시 재크롤링 유도.
  //    Service Account 없이 Google에 새 글을 알리는 표준 방식 (WordPress/Blogger 동일 방식).
  if (pingSitemap) {
    const rssUrl = `${baseUrl}/api/rss`;
    const pings = [
      { name: 'bing', url: `https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}` },
      { name: 'naver', url: `https://searchadvisor.naver.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}` },
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

  // IndexNow batch (글로벌 + 네이버, 한 번에 최대 10,000 URL)
  const indexNowKey = getIndexNowKey();
  let indexnowOk = false;
  let indexnowError: string | undefined;
  if (indexNowKey) {
    const indexNowPayload = {
      host,
      key: indexNowKey,
      keyLocation: `${baseUrl}/${indexNowKey}.txt`,
      urlList: urls,
    };
    // 글로벌 IndexNow (Bing, Yandex, Seznam)
    try {
      const globalRes = await fetch('https://api.indexnow.org/indexnow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(indexNowPayload),
      });
      indexnowOk = globalRes.status === 200 || globalRes.status === 202;
      if (!indexnowOk) indexnowError = `global HTTP ${globalRes.status}`;
    } catch (err) {
      indexnowError = err instanceof Error ? err.message : String(err);
    }
    // 네이버 전용 IndexNow
    try {
      const naverRes = await fetch('https://searchadvisor.naver.com/indexnow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(indexNowPayload),
      });
      const naverOk = naverRes.status === 200 || naverRes.status === 202;
      if (!naverOk) {
        indexnowError = indexnowError
          ? `${indexnowError}; naver HTTP ${naverRes.status}`
          : `naver HTTP ${naverRes.status}`;
      }
    } catch (err) {
      const naverErr = err instanceof Error ? err.message : String(err);
      indexnowError = indexnowError
        ? `${indexnowError}; naver ${naverErr}`
        : `naver ${naverErr}`;
    }
  } else {
    indexnowError = 'INDEXNOW_KEY 미설정';
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

export type { IndexingResult } from './gsc-client';
