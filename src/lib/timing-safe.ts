/**
 * @file timing-safe.ts
 * @description 타이밍 공격 방어용 상수 시간 문자열 비교 유틸
 *
 * 사용처:
 *   - 웹훅 서명/시크릿 헤더 검증 (SMS, alimtalk, toss-webhook 등)
 *   - HMAC 비교
 *   - API key 비교
 *
 * 기존의 `secret !== expected` 패턴은 차이가 발생하는 첫 byte 위치에서
 * 즉시 반환해 미세한 시간차이가 측정 가능 → 단계적 secret guessing 가능.
 * 이 함수는 항상 동일한 시간을 보장한다.
 */

import { timingSafeEqual } from 'crypto';

/**
 * 두 문자열을 상수 시간으로 비교한다. 길이가 다르면 즉시 false (이건 공격에 도움 안됨).
 *
 * @param a — 비교 대상 1 (보통 헤더값)
 * @param b — 비교 대상 2 (보통 expected secret)
 * @returns 일치 여부
 */
export function safeEqualString(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
