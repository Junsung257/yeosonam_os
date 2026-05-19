/**
 * 네이버 검색광고 API 인증 fetch 래퍼.
 *
 * - 자격 정보 (NAVER_AD_API_KEY / SECRET / CUSTOMER_ID) 자동 주입.
 * - HMAC-SHA256 서명 자동 생성.
 * - rate limit (429) / 인증 실패 (401) / 서버 오류 (5xx) 케이스 분류 후 로깅.
 * - 미설정 시 호출자가 `isNaverAdsConfigured()` 로 먼저 가드해야 함 — 본 함수는 가드 실패 시 throw.
 *
 * 공식 base URL: https://api.searchad.naver.com
 */

import { getSecret } from '@/lib/secret-registry';
import { buildNaverAdsHeaders } from './signer';

const BASE_URL = 'https://api.searchad.naver.com';

interface NaverAdsCredentials {
  apiKey: string;
  secret: string;
  customerId: string;
}

function getCredentials(): NaverAdsCredentials {
  const apiKey = getSecret('NAVER_AD_API_KEY');
  const secret = getSecret('NAVER_AD_SECRET');
  const customerId = getSecret('NAVER_AD_CUSTOMER_ID');
  if (!apiKey || !secret || !customerId) {
    throw new Error(
      'NAVER_AD_API_KEY / NAVER_AD_SECRET / NAVER_AD_CUSTOMER_ID 환경변수가 모두 설정되어야 합니다.',
    );
  }
  return { apiKey, secret, customerId };
}

export interface NaverAdsFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** AbortSignal — 외부에서 timeout 컨트롤 가능. */
  signal?: AbortSignal;
}

/**
 * 인증된 fetch — uri 는 경로만 ("/ncc/keywords/abc"), query 는 객체로 전달.
 * 서명은 query string 을 포함하지 않은 raw URI 로 계산되어야 함 (공식 사양).
 */
export async function naverAdsFetch<T = unknown>(
  uri: string,
  options: NaverAdsFetchOptions = {},
): Promise<T> {
  const { method = 'GET', body, query, signal } = options;
  const credentials = getCredentials();

  const headers = buildNaverAdsHeaders(method, uri, credentials);

  let fullUrl = `${BASE_URL}${uri}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
    }
    const qsStr = qs.toString();
    if (qsStr) fullUrl += `?${qsStr}`;
  }

  const res = await fetch(fullUrl, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ?? AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    // 본문을 읽되 큰 응답은 잘라서 로그 부담 회피
    const text = await res.text().catch(() => '');
    const preview = text.slice(0, 500);
    const tag = res.status === 401 ? 'AUTH' : res.status === 429 ? 'RATE_LIMIT' : 'API_ERROR';
    throw new Error(`[NaverAds ${tag}] ${method} ${uri} → HTTP ${res.status}: ${preview}`);
  }

  // 204 No Content 같은 경우 빈 응답
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return undefined as unknown as T;
  return (await res.json()) as T;
}
