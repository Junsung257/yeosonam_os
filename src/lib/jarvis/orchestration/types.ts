/**
 * 자비스 오케스트레이션 — 도메인 에이전트(6) 아래 서브 스페셜리스트 계층
 *
 * 확장: specialist id 는 문자열로 열어 두고, 레지스트리에만 추가하면 라우팅·로그에 반영됨.
 */

import type { AgentType } from '../types';

/** 라우팅 근거 — 추후 LLM 서브라우터 붙일 때 'llm' 추가 */
export type SpecialistRoutingMethod = 'keyword' | 'default' | 'surface_override';

export interface SpecialistPick {
  /** 전역 고유 id (로그·세션 context 키) 예: operations.booking_lookup */
  specialistId: string;
  labelKo: string;
  parentAgent: AgentType;
  method: SpecialistRoutingMethod;
}

/** 세션 context.orchestration 에 누적되는 마지막 한 턴 스냅샷 (디버깅·분석용) */
export interface OrchestrationTurnTrace {
  specialistId: string;
  labelKo: string;
  parentAgent: AgentType;
  method: SpecialistRoutingMethod;
  at: string;
}
