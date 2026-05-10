/**
 * @file affiliate-config.ts
 * @description 어필리에이트 정산 관련 기본값 — 환경변수 우선, 미설정 시 안전 디폴트.
 *
 * 사용처:
 *   - admin/applications: 신규 파트너 default commission_rate
 *   - cron/affiliate-lifetime-commission: lifetime 보상 비율
 *
 * 정책:
 *   - 변경 시 Vercel 환경변수만 갱신하면 코드 배포 없이 반영
 *   - 0~1 범위 강제 (잘못된 값으로 인한 과다 지급 방어)
 */

function clamp01(n: number, fallback: number): number {
  if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;
  return n;
}

function parseRate(envKey: string, fallback: number): number {
  // 동적 env 키이므로 process.env 직접 접근 (secret-registry.SecretKey 타입 외)
  const raw = process.env[envKey];
  if (raw === undefined || raw === '') return fallback;
  return clamp01(parseFloat(raw), fallback);
}

/** 신규 파트너 신청 승인 시 기본 commission_rate (0.09 = 9%) */
export function getDefaultAffiliateCommissionRate(): number {
  return parseRate('DEFAULT_AFFILIATE_COMMISSION_RATE', 0.09);
}

/** lifetime_0_5 실험 그룹의 평생 커미션 비율 (0.005 = 0.5%) */
export function getLifetimeCommissionRate(): number {
  return parseRate('LIFETIME_COMMISSION_RATE', 0.005);
}
