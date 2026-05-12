/**
 * 2단 라우팅 — 1단: 기존 routeMessage (도메인 6개)
 *          2단: 키워드 기반 서브 스페셜리스트 (추후 LLM 미세 라우터로 교체 가능)
 */

import type { JarvisContext } from '../types';
import type { AgentType } from '../types';
import { SPECIALISTS_BY_AGENT } from './specialist-registry';
import type { SpecialistPick, SpecialistRoutingMethod } from './types';

function pickFromDefinitions(
  agentType: AgentType,
  message: string,
  baseMethod: SpecialistRoutingMethod,
): SpecialistPick {
  const list = SPECIALISTS_BY_AGENT[agentType];
  if (!list?.length) {
    return {
      specialistId: `${agentType}.default`,
      labelKo: '기본',
      parentAgent: agentType,
      method: 'default',
    };
  }

  const msg = message.trim();
  for (const def of list) {
    if (def.match.length === 0) continue;
    if (def.match.some((re) => re.test(msg))) {
      return {
        specialistId: def.id,
        labelKo: def.labelKo,
        parentAgent: agentType,
        method: baseMethod,
      };
    }
  }

  const fallback = list[list.length - 1];
  return {
    specialistId: fallback.id,
    labelKo: fallback.labelKo,
    parentAgent: agentType,
    method: 'default',
  };
}

/**
 * @param agentType — 이미 상위 라우터가 결정한 도메인
 */
export function resolveSpecialist(
  agentType: AgentType,
  message: string,
  ctx: JarvisContext,
): SpecialistPick {
  // surface 기반 오버라이드 (V2 dispatch 와 동일 철학 — 고객면은 concierge 팀으로 묶이지만 id 는 구분)
  if (agentType === 'products' && ctx.surface === 'customer') {
    return {
      specialistId: 'products.concierge_rag',
      labelKo: '고객면 컨시어지(RAG)',
      parentAgent: 'products',
      method: 'surface_override',
    };
  }

  return pickFromDefinitions(agentType, message, 'keyword');
}
