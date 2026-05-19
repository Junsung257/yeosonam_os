/**
 * 네이버 검색광고 API HMAC-SHA256 서명 생성기.
 *
 * 공식 패턴: timestamp + "." + HTTP_METHOD + "." + URI → HMAC-SHA256(SECRET) → Base64.
 * Node.js 표준 `crypto` 모듈만 사용 (외부 npm 추가 없음).
 *
 * 출처: https://github.com/naver/searchad-apidoc — 공식 GitHub Issues 다수 참조.
 */

import { createHmac } from 'crypto';

export interface NaverAdsSignature {
  timestamp: string;
  signature: string;
}

/**
 * 단일 요청에 대해 timestamp + signature 한 쌍 생성.
 * @param method  HTTP 메서드 (GET/POST/PUT/DELETE)
 * @param uri     경로만 (예: "/ncc/keywords/abc123"). 쿼리스트링·도메인 제외.
 * @param secret  NAVER_AD_SECRET 환경변수 값
 */
export function buildNaverAdsSignature(
  method: string,
  uri: string,
  secret: string,
): NaverAdsSignature {
  const timestamp = String(Date.now());
  const message = `${timestamp}.${method.toUpperCase()}.${uri}`;
  const signature = createHmac('sha256', secret).update(message).digest('base64');
  return { timestamp, signature };
}

/**
 * 네이버 검색광고 API 인증 헤더 한 번에 구성.
 * fetch 의 `headers` 에 spread 로 합치면 됨.
 */
export function buildNaverAdsHeaders(
  method: string,
  uri: string,
  credentials: { apiKey: string; secret: string; customerId: string },
): Record<string, string> {
  const { timestamp, signature } = buildNaverAdsSignature(method, uri, credentials.secret);
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Timestamp': timestamp,
    'X-API-KEY': credentials.apiKey,
    'X-Customer': credentials.customerId,
    'X-Signature': signature,
  };
}
