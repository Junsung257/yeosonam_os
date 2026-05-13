/**
 * @file conformal-calibration.ts — Split Conformal Abstention for registration auto-gate.
 *
 * 박제 사유 (2026-05-22):
 *   `auto_publish_above = 0.95` 휴리스틱이 거짓 신호. 사장님 거절 누적 데이터로
 *   calibration set 의 confidence 분포를 모아 (1-alpha) quantile 을 임계값으로 사용.
 *   → false-accept rate ≤ alpha 수학적 보장 (arXiv 2405.01563, 2502.06884).
 *
 *   인프라 의존성 0 (외부 라이브러리 X). DB 쿼리 + quantile 만으로 동작.
 *
 *   BAD ground truth 정의:
 *     1. travel_packages.status = 'rejected' (사장님 거절)
 *     2. extractions_corrections 에 critical/high severity 가 있는 package_id
 *
 *   Cold-start 가드: sample < conformal_min_sample (default 20) 이면 threshold NULL 저장
 *   → registration-policy.ts 가 auto_publish_above 로 fallback.
 *
 *   재계산: getRegistrationPolicy() lazy 트리거 또는 cron 야간 1회.
 */

import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export interface ConformalCalibrationResult {
  threshold: number | null;     // NULL = 표본 부족, fallback
  sampleSize: number;
  alpha: number;
  badConfidences: number[];     // 디버깅용 분포 (slice 일부만)
  reason: 'ok' | 'cold_start' | 'no_data' | 'error';
}

/**
 * 최근 N일 (default 90일) BAD ground truth 의 confidence 분포에서 (1-alpha) quantile 계산.
 * 예: alpha=0.05 → BAD 의 confidence 가 threshold 이상인 비율 ≤ 5% 가 되도록.
 * 새 prediction 이 threshold 이상이어야 auto_publish 허용 → BAD 의 95% 차단 보장.
 */
export async function recomputeConformalThreshold(
  options: { alpha?: number; minSample?: number; windowDays?: number } = {},
): Promise<ConformalCalibrationResult> {
  const { alpha = 0.05, minSample = 20, windowDays = 90 } = options;
  if (!isSupabaseConfigured) return { threshold: null, sampleSize: 0, alpha, badConfidences: [], reason: 'error' };

  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    // 1) BAD set 수집 — rejected 상품
    const { data: rejected } = await supabaseAdmin
      .from('travel_packages')
      .select('id')
      .eq('status', 'rejected')
      .gte('created_at', windowStart);
    const badPkgIds = new Set<string>((rejected ?? []).map((r: { id: string }) => r.id));

    // 2) BAD set 보강 — critical/high 정정이 있는 package_id
    const { data: corrections } = await supabaseAdmin
      .from('extractions_corrections')
      .select('package_id')
      .in('severity', ['critical', 'high'])
      .gte('created_at', windowStart);
    for (const c of (corrections ?? []) as Array<{ package_id: string | null }>) {
      if (c.package_id) badPkgIds.add(c.package_id);
    }

    if (badPkgIds.size === 0) {
      return { threshold: null, sampleSize: 0, alpha, badConfidences: [], reason: 'no_data' };
    }

    // 3) 각 BAD pkg 의 V2 confidence 수집 (ai_quality_log 최신 행)
    const { data: logs } = await supabaseAdmin
      .from('ai_quality_log')
      .select('package_id, confidence, created_at')
      .in('package_id', Array.from(badPkgIds))
      .order('created_at', { ascending: false });

    // 각 pkg 의 가장 최근 confidence 만 사용 (중복 제거)
    const latestByPkg = new Map<string, number>();
    for (const log of (logs ?? []) as Array<{ package_id: string; confidence: number | string }>) {
      if (latestByPkg.has(log.package_id)) continue;
      const conf = Number(log.confidence);
      if (Number.isFinite(conf) && conf >= 0 && conf <= 1) {
        latestByPkg.set(log.package_id, conf);
      }
    }

    const badConfidences = Array.from(latestByPkg.values()).sort((a, b) => b - a); // 내림차순
    const sampleSize = badConfidences.length;

    if (sampleSize < minSample) {
      return { threshold: null, sampleSize, alpha, badConfidences: badConfidences.slice(0, 10), reason: 'cold_start' };
    }

    // 4) (1 - alpha) quantile 계산 — 내림차순 정렬했으므로 index = floor(N * alpha)
    // BAD confidences 가 [0.95, 0.91, 0.85, 0.80, ...] 이고 alpha=0.05, N=40 이면
    // index = floor(40 * 0.05) = 2 → threshold = 0.85
    // → new prediction confidence > 0.85 면 auto_publish 허용
    // → BAD 중 confidence > 0.85 인 비율 = 2 / 40 = 5% (= alpha)
    const idx = Math.min(Math.floor(sampleSize * alpha), sampleSize - 1);
    const rawThreshold = badConfidences[idx];

    // bound to [0.50, 0.99] — 안전 가드 (산식 버그로 0.0 / 1.0 나오는 케이스 방어)
    const threshold = Math.max(0.50, Math.min(0.99, rawThreshold));

    return {
      threshold,
      sampleSize,
      alpha,
      badConfidences: badConfidences.slice(0, 10),
      reason: 'ok',
    };
  } catch (e) {
    console.warn('[conformal] 재계산 실패(무시):', (e as Error).message);
    return { threshold: null, sampleSize: 0, alpha, badConfidences: [], reason: 'error' };
  }
}

/**
 * 재계산 + registration_auto_policy UPDATE.
 * getRegistrationPolicy() 가 24h stale 감지 시 fire-and-forget 으로 호출.
 */
export async function refreshConformalPolicy(): Promise<ConformalCalibrationResult> {
  if (!isSupabaseConfigured) {
    return { threshold: null, sampleSize: 0, alpha: 0.05, badConfidences: [], reason: 'error' };
  }

  // 정책 행에서 alpha · min_sample 읽기
  const { data: policy } = await supabaseAdmin
    .from('registration_auto_policy')
    .select('conformal_target_alpha, conformal_min_sample, conformal_enabled')
    .eq('id', 1)
    .maybeSingle();

  const enabled = policy?.conformal_enabled ?? true;
  if (!enabled) {
    return { threshold: null, sampleSize: 0, alpha: 0.05, badConfidences: [], reason: 'error' };
  }

  const alpha = Number(policy?.conformal_target_alpha ?? 0.05);
  const minSample = Number(policy?.conformal_min_sample ?? 20);
  const result = await recomputeConformalThreshold({ alpha, minSample });

  await supabaseAdmin
    .from('registration_auto_policy')
    .update({
      conformal_threshold:           result.threshold,
      conformal_sample_size:         result.sampleSize,
      conformal_last_calibrated_at:  new Date().toISOString(),
    })
    .eq('id', 1);

  console.log(`[conformal] 재보정 완료 — threshold=${result.threshold ?? 'NULL'} (sample=${result.sampleSize}, α=${alpha}, reason=${result.reason})`);
  return result;
}
