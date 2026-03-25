// ─── Gemini 멀티턴 Function Calling 루프 ──────────────────────────────────────

import type { UIComponent } from './ui-types';
import { executeTool } from './tools';

const GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_ROUNDS = 15;

export interface RunGeminiOptions {
  apiKey: string;
  contents: unknown[];
  systemPrompt: string;
  tools: unknown[];
  injectedContext?: Record<string, string>;
}

export interface GeminiResult {
  reply: string;
  actions: { type: string; data: unknown }[];
  uiState: UIComponent[] | null;
}

export async function runGemini(opts: RunGeminiOptions): Promise<GeminiResult> {
  const { apiKey, contents, systemPrompt, tools, injectedContext = {} } = opts;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const actions: { type: string; data: unknown }[] = [];
  const uiComponents: UIComponent[] = [];
  let currentContents = [...contents];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        tools: [{ function_declarations: tools }],
        contents: currentContents,
        generationConfig: { temperature: 0.1 },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API 오류 ${res.status}: ${err}`);
    }

    const json = await res.json();
    const candidate = json.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    const funcCalls = parts.filter((p: { functionCall?: unknown }) => p.functionCall);

    // 텍스트 응답 → 루프 종료
    if (funcCalls.length === 0) {
      const textPart = parts.find((p: { text?: string }) => p.text);
      return {
        reply: textPart?.text ?? '처리가 완료되었습니다.',
        actions,
        uiState: uiComponents.length > 0 ? uiComponents : null,
      };
    }

    // model 턴 기록
    currentContents = [...currentContents, { role: 'model', parts }];

    // 도구 실행
    const functionResponses = [];
    for (const part of funcCalls) {
      const { name, args } = part.functionCall as { name: string; args: Record<string, unknown> };
      let toolResult: unknown;
      try {
        const { result, action, actions: toolActions, uiComponents: toolUi } = await executeTool(
          name,
          args ?? {},
          injectedContext
        );
        toolResult = result;
        if (action) actions.push(action);
        if (toolActions) actions.push(...toolActions);
        if (toolUi) uiComponents.push(...toolUi);
      } catch (err) {
        // 에러 인간화: raw 메시지 대신 부드러운 오류 전달
        const rawMsg = err instanceof Error ? err.message : '도구 실행 실패';
        toolResult = {
          error: rawMsg,
          humanized: humanizeError(name, rawMsg),
        };
      }
      functionResponses.push({ functionResponse: { name, response: { result: toolResult } } });
    }

    currentContents = [...currentContents, { role: 'user', parts: functionResponses }];
  }

  return {
    reply: '처리가 완료되었습니다.',
    actions,
    uiState: uiComponents.length > 0 ? uiComponents : null,
  };
}

// ─── 에러 인간화 ──────────────────────────────────────────────────────────────
function humanizeError(toolName: string, rawMsg: string): string {
  if (rawMsg.includes('duplicate key') || rawMsg.includes('already exists')) {
    return '이미 등록된 정보가 있어요. 중복 확인 후 다시 시도해 주세요.';
  }
  if (rawMsg.includes('violates foreign key') || rawMsg.includes('foreign key')) {
    return '연결된 정보를 찾을 수 없어요. 고객 또는 상품 정보를 먼저 확인해 주세요.';
  }
  if (rawMsg.includes('violates check constraint') || rawMsg.includes('check constraint')) {
    return '입력 값이 올바르지 않아요. 날짜나 금액 형식을 다시 확인해 주세요.';
  }
  if (rawMsg.includes('not found') || rawMsg.includes('찾을 수 없')) {
    return '해당 정보를 찾을 수 없어요. 이름이나 번호를 다시 확인해 주세요.';
  }
  if (toolName.includes('booking') || toolName.includes('customer')) {
    return '어이쿠, 처리 중 잠깐 문제가 생겼어요. 다시 시도해 주시겠어요?';
  }
  if (toolName.includes('stats') || toolName.includes('finance')) {
    return '장부 조회 중 일시적인 문제가 발생했어요. 다시 시도해 주세요.';
  }
  return '일시적인 오류가 발생했어요. 잠시 후 다시 말씀해 주시면 처리해 드릴게요.';
}
