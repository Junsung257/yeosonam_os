/**
 * @file registration-policy.ts
 * @description 등록 자동화 게이트 임계치 정책 로더 (5분 cache).
 *
 * 박제 사유 (2026-05-13 F-4):
 * 컨펌 큐 → 풀자동 전환을 코드 변경 없이 어드민에서 조정 가능하게.
 * parser.ts:calculateConfidenceV2 의 decideAutoGate 가 이 정책을 소비.
 *
 * 자동화 전환 트리거 조건 (project_registration_accuracy_roadmap 메모리 박제):
 *   1. 30일 연속 거절률 < trigger_max_reject_rate_30d
 *   2. Leak/week < trigger_max_leak_per_week
 *   3. CoVe 통과율 > trigger_min_cove_pass_rate
 *   4. Reflexion 누적 >= trigger_min_reflexion_count
 * 위 4 조건 모두 충족 시 full_auto_enabled = true 로 전환 검토.
 */

export interface RegistrationPolicy {
  auto_publish_above:          number;
  confirm_queue_above:         number;
  pending_review_above:        number;
  reject_leak_score_above:     number;
  full_auto_enabled:           boolean;
  trigger_max_reject_rate_30d: number;
  trigger_max_leak_per_week:   number;
  trigger_min_cove_pass_rate:  number;
  trigger_min_reflexion_count: number;
}

export const DEFAULT_REGISTRATION_POLICY: RegistrationPolicy = {
  auto_publish_above:          0.95,
  confirm_queue_above:         0.70,
  pending_review_above:        0.50,
  reject_leak_score_above:     0.40,
  full_auto_enabled:           false,
  trigger_max_reject_rate_30d: 0.02,
  trigger_max_leak_per_week:   0,
  trigger_min_cove_pass_rate:  0.98,
  trigger_min_reflexion_count: 100,
};

let cache: { policy: RegistrationPolicy; expiry: number } | null = null;
const TTL_MS = 5 * 60 * 1000; // 5분

/**
 * Supabase 에서 현재 정책 로드. 5분 cache. fail-soft: DB 오류 시 DEFAULT 반환.
 */
export async function getRegistrationPolicy(): Promise<RegistrationPolicy> {
  if (cache && Date.now() < cache.expiry) return cache.policy;

  try {
    const supaMod = await import('@/lib/supabase');
    if (!supaMod.isSupabaseConfigured) return DEFAULT_REGISTRATION_POLICY;
    const { data, error } = await supaMod.supabaseAdmin
      .from('registration_auto_policy')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return DEFAULT_REGISTRATION_POLICY;
    const policy: RegistrationPolicy = {
      auto_publish_above:          Number(data.auto_publish_above)          ?? DEFAULT_REGISTRATION_POLICY.auto_publish_above,
      confirm_queue_above:         Number(data.confirm_queue_above)         ?? DEFAULT_REGISTRATION_POLICY.confirm_queue_above,
      pending_review_above:        Number(data.pending_review_above)        ?? DEFAULT_REGISTRATION_POLICY.pending_review_above,
      reject_leak_score_above:     Number(data.reject_leak_score_above)     ?? DEFAULT_REGISTRATION_POLICY.reject_leak_score_above,
      full_auto_enabled:           Boolean(data.full_auto_enabled),
      trigger_max_reject_rate_30d: Number(data.trigger_max_reject_rate_30d) ?? DEFAULT_REGISTRATION_POLICY.trigger_max_reject_rate_30d,
      trigger_max_leak_per_week:   Number(data.trigger_max_leak_per_week)   ?? DEFAULT_REGISTRATION_POLICY.trigger_max_leak_per_week,
      trigger_min_cove_pass_rate:  Number(data.trigger_min_cove_pass_rate)  ?? DEFAULT_REGISTRATION_POLICY.trigger_min_cove_pass_rate,
      trigger_min_reflexion_count: Number(data.trigger_min_reflexion_count) ?? DEFAULT_REGISTRATION_POLICY.trigger_min_reflexion_count,
    };
    cache = { policy, expiry: Date.now() + TTL_MS };
    return policy;
  } catch {
    return DEFAULT_REGISTRATION_POLICY;
  }
}

/** 강제 cache 무효화 (어드민이 정책 변경 후 호출) */
export function invalidateRegistrationPolicyCache(): void {
  cache = null;
}

/**
 * decideAutoGate — V2 산출 결과를 정책 임계치에 매핑.
 * parser.ts:calculateConfidenceV2 가 이 함수를 호출 (또는 동등 inline 로직).
 */
export function decideAutoGateWithPolicy(
  confidence: number,
  leakScore: number,
  criticalFails: number,
  policy: RegistrationPolicy,
): 'auto_publish' | 'confirm_queue' | 'pending_review' | 'rejected' {
  if (criticalFails > 0)                            return 'rejected';
  if (leakScore >= policy.reject_leak_score_above)  return 'rejected';
  if (confidence < policy.pending_review_above)     return 'rejected';
  if (confidence < policy.confirm_queue_above)      return 'pending_review';
  if (confidence < policy.auto_publish_above)       return 'confirm_queue';
  // 풀자동 비활성화면 confirm_queue 로 강제 (사장님 1-click)
  return policy.full_auto_enabled ? 'auto_publish' : 'confirm_queue';
}
