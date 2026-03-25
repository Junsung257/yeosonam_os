// ─── buildAgentConfig: 모드별 도구 + 시스템 프롬프트 조립 ────────────────────

import type { IntentMode } from '../router';
import { getBasePrompt } from '../prompts/base';
import { PRODUCT_PROMPT } from '../prompts/product';
import { BOOKING_PROMPT } from '../prompts/booking';
import { FINANCE_PROMPT } from '../prompts/finance';
import { PRODUCT_TOOL_DECLARATIONS } from './product';
import { BOOKING_TOOL_DECLARATIONS } from './booking';
import { FINANCE_TOOL_DECLARATIONS } from './finance';

export interface AgentConfig {
  tools: unknown[];
  systemPrompt: string;
}

export function buildAgentConfig(mode: IntentMode): AgentConfig {
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const base = getBasePrompt(today);

  switch (mode) {
    case 'PRODUCT_MODE':
      return {
        tools: PRODUCT_TOOL_DECLARATIONS,
        systemPrompt: base + '\n\n' + PRODUCT_PROMPT,
      };

    case 'FINANCE_MODE':
      return {
        tools: FINANCE_TOOL_DECLARATIONS,
        systemPrompt: base + '\n\n' + FINANCE_PROMPT,
      };

    case 'BOOKING_MODE':
      return {
        tools: BOOKING_TOOL_DECLARATIONS,
        systemPrompt: base + '\n\n' + BOOKING_PROMPT,
      };

    case 'MULTI_MODE':
    default:
      // 복합 명령: 전체 도구 로드
      return {
        tools: [
          ...PRODUCT_TOOL_DECLARATIONS,
          ...BOOKING_TOOL_DECLARATIONS.filter(
            t => !PRODUCT_TOOL_DECLARATIONS.some(pt => pt.name === t.name)
          ),
          ...FINANCE_TOOL_DECLARATIONS.filter(
            t => ![...PRODUCT_TOOL_DECLARATIONS, ...BOOKING_TOOL_DECLARATIONS].some(pt => pt.name === t.name)
          ),
        ],
        systemPrompt: base + '\n\n' + PRODUCT_PROMPT + '\n\n' + BOOKING_PROMPT + '\n\n' + FINANCE_PROMPT,
      };
  }
}
