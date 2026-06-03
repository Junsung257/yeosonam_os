/**
 * 여소남 OS — Conformal Abstention 야간 재보정 크론
 *
 * 박제 사유 (2026-05-22):
 *   `registration-policy.ts` 에 24h stale lazy fire-and-forget 박혔지만,
 *   주말·연휴 등 등록 트래픽이 0 인 기간에는 `getRegistrationPolicy()` 호출 자체가 없어
 *   threshold 가 stale 누적된다.
 *
 *   야간 4am cron 으로 매일 강제 재보정 → BAD set 신선도 보장 + lazy 트리거 미스 차단.
 *
 * 호출:
 *   GET /api/cron/conformal-recalibrate
 *   Authorization: Bearer $CRON_SECRET (설정 시)
 *
 * 결과: registration_auto_policy.conformal_threshold / sample_size / last_calibrated_at 갱신.
 */

import { NextRequest } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { refreshConformalPolicy } from '@/lib/conformal-calibration';
import { invalidateRegistrationPolicyCache } from '@/lib/registration-policy';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();

  const start = Date.now();
  try {
    const result = await refreshConformalPolicy();
    // 5분 cache 강제 무효화 — 다음 등록 호출이 fresh threshold 즉시 받도록.
    invalidateRegistrationPolicyCache();

    return apiResponse({
      ok: true,
      threshold: result.threshold,
      sampleSize: result.sampleSize,
      alpha: result.alpha,
      reason: result.reason,
      elapsed_ms: Date.now() - start,
    });
  } catch (err) {
    return apiResponse(
      {
        ok: false,
        error: sanitizeDbError(err, 'Recalibration failed'),
        elapsed_ms: Date.now() - start,
      },
      { status: 500 },
    );
  }
}
