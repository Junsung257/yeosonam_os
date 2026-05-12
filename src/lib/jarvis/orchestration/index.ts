/**
 * 자비스 오케스트레이션 — 단일 진입, 다층 에이전트
 *
 * - 레지스트리: `specialist-registry.ts` 만 수정해 팀을 추가/분할
 * - 해석기: `resolve-specialist.ts` — 키워드 → (옵션) LLM 서브라우터로 교체 가능
 * - 상세 설계: `docs/jarvis-orchestration.md`
 */

export type { OrchestrationTurnTrace, SpecialistPick, SpecialistRoutingMethod } from './types';
export { SPECIALISTS_BY_AGENT } from './specialist-registry';
export { resolveSpecialist } from './resolve-specialist';

import type { OrchestrationTurnTrace, SpecialistPick } from './types';

export function specialistToTrace(pick: SpecialistPick): OrchestrationTurnTrace {
  return {
    specialistId: pick.specialistId,
    labelKo: pick.labelKo,
    parentAgent: pick.parentAgent,
    method: pick.method,
    at: new Date().toISOString(),
  };
}

/** 세션 context 병합용 — 기존 키와 충돌 없이 orchestration 만 덮어씀 */
export function mergeOrchestrationContext(
  prev: Record<string, unknown> | undefined,
  pick: SpecialistPick,
): Record<string, unknown> {
  const trace = specialistToTrace(pick);
  return {
    ...(prev ?? {}),
    orchestration: {
      last: trace,
      last_specialist_id: pick.specialistId,
      last_parent_agent: pick.parentAgent,
    },
  };
}
