/**
 * 통합 검색엔진 색인 요청 모듈
 *
 * 호출 한 번으로 다음을 동시 실행:
 *   1. Google Search Console Sitemaps API (일반 블로그 기본 경로)
 *   2. IndexNow (Bing/Yandex/Seznam, 키 파일 검증 필요)
 *   3. Sitemap ping/WebSub (Bing/네이버/Google feed refresh 보조)
 *
 * 모든 호출은 fire-and-forget. 실패해도 발행 흐름 막지 않음.
 */

import { requestGoogleIndexing, submitGoogleSitemap, IndexingResult } from './gsc-client';
import { getSecret } from '@/lib/secret-registry';

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

function shouldUseGoogleIndexingApi(url: string): boolean {
  if (getSecret('GOOGLE_INDEXING_API_FOR_BLOGS') === 'true') return true;
  try {
    const parsed = new URL(url);
    return !parsed.pathname.startsWith('/blog/');
  } catch {
    return false;
  }
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

  // 1. Google Search Console 알림.
  //    일반 블로그는 공식 지원 범위상 Indexing API 대신 Sitemaps API를 기본으로 쓴다.
  //    GOOGLE_INDEXING_API_FOR_BLOGS=true 일 때만 기존 직접 URL 알림을 보조로 허용한다.
  let googleDirectResult: IndexingResult | null = null;
  if (shouldUseGoogleIndexingApi(url)) {
    googleDirectResult = await requestGoogleIndexing(url, type);
    report.google = googleDirectResult.ok ? 'success' : 'failed';
    if (!googleDirectResult.ok) {
      report.google_error = googleDirectResult.error;
      if (googleDirectResult.error?.includes('403')) {
        console.warn('[indexing] Google Indexing API 403 — Search Console Sitemap 경로로 대체');
      }
    }
  } else {
    report.google = 'skipped';
    report.google_error = 'Google Indexing API는 공식적으로 JobPosting/BroadcastEvent 전용이라 블로그는 GSC Sitemap API로 처리';
  }

  const googleSitemap = await submitGoogleSitemap(sitemapUrl, baseUrl);
  report.sitemap_pings.push({
    provider: 'google_search_console_sitemap',
    ok: googleSitemap.ok,
  });
  if (googleSitemap.ok && (report.google === 'skipped' || report.google === 'failed')) {
    report.google = 'success';
    report.google_error = googleDirectResult?.ok === false ? report.google_error : undefined;
  } else if (!googleSitemap.ok && report.google === 'skipped') {
    report.google_error = googleSitemap.error ?? report.google_error;
  }

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
      report.sitemap_pings.push({ provider: 'global_indexnow', ok: report.indexnow === 'success' });
      if (report.indexnow !== 'success') {
        report.indexnow_error = `global HTTP ${globalRes.status}`;
      }
    } catch (err) {
      report.indexnow_error = err instanceof Error ? err.message : String(err);
      report.sitemap_pings.push({ provider: 'global_indexnow', ok: false });
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
      report.sitemap_pings.push({ provider: 'naver_indexnow', ok: naverOk });
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
      report.sitemap_pings.push({ provider: 'naver_indexnow', ok: false });
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
  if (urls.length === 0) return [];
  const startedAt = Date.now();
  const { type = 'URL_UPDATED' } = options;
  const host = new URL(baseUrl).host;
  const sitemapUrl = `${baseUrl}/sitemap.xml`;

  // Google Indexing은 병렬, IndexNow는 한 번에 여러 URL 전송 가능
  const googleSitemap = await submitGoogleSitemap(sitemapUrl, baseUrl);
  const googleResults = await Promise.all(
    urls.map(async (url) => {
      if (!shouldUseGoogleIndexingApi(url)) {
        return {
          ok: googleSitemap.ok,
          error: googleSitemap.ok
            ? undefined
            : googleSitemap.error ?? 'GSC Sitemap API submission failed',
        };
      }

      const direct = await requestGoogleIndexing(url, type);
      if (direct.ok) return direct;
      if (googleSitemap.ok) return { ok: true, error: direct.error };
      return direct;
    }),
  );

  // IndexNow batch (글로벌 + 네이버, 한 번에 최대 10,000 URL)
  const indexNowKey = getIndexNowKey();
  let indexnowOk = false;
  let indexnowError: string | undefined;
  const indexnowPings: { provider: string; ok: boolean }[] = [];
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
      indexnowPings.push({ provider: 'global_indexnow', ok: indexnowOk });
      if (!indexnowOk) indexnowError = `global HTTP ${globalRes.status}`;
    } catch (err) {
      indexnowError = err instanceof Error ? err.message : String(err);
      indexnowPings.push({ provider: 'global_indexnow', ok: false });
    }
    // 네이버 전용 IndexNow
    try {
      const naverRes = await fetch('https://searchadvisor.naver.com/indexnow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(indexNowPayload),
      });
      const naverOk = naverRes.status === 200 || naverRes.status === 202;
      indexnowPings.push({ provider: 'naver_indexnow', ok: naverOk });
      if (!naverOk) {
        indexnowError = indexnowError
          ? `${indexnowError}; naver HTTP ${naverRes.status}`
          : `naver HTTP ${naverRes.status}`;
      }
    } catch (err) {
      const naverErr = err instanceof Error ? err.message : String(err);
      indexnowPings.push({ provider: 'naver_indexnow', ok: false });
      indexnowError = indexnowError
        ? `${indexnowError}; naver ${naverErr}`
        : `naver ${naverErr}`;
    }
  } else {
    indexnowError = 'INDEXNOW_KEY 미설정';
  }

  const durationMs = Date.now() - startedAt;
  const indexnowStatus = !indexNowKey ? 'skipped' : indexnowOk ? 'success' : 'failed';

  return urls.map((url, idx) => ({
    url,
    google: googleResults[idx].ok ? 'success' : 'failed',
    google_error: googleResults[idx].error,
    indexnow: indexnowStatus,
    indexnow_error: indexnowError,
    sitemap_pings: [{ provider: 'google_search_console_sitemap', ok: googleSitemap.ok }, ...indexnowPings],
    duration_ms: durationMs,
  }));
}

export type { IndexingResult } from './gsc-client';
