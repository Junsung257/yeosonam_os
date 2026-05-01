/**
 * 여소남 OS — DeepSeek Agent Loop V2 (streaming + parallel tools)
 * 
 * V3 (2026-05-01): Gemini → DeepSeek V4-Pro 전환
 * 
 * 특징:
 * 1. OpenAI SDK 활용 (api.deepseek.com)
 * 2. stream: true 로 토큰 단위 delta 수신
 * 3. Parallel function calling 지원
 * 4. AsyncGenerator 로 이벤트 스트림 yield
 */

import OpenAI from 'openai';
import { supabaseAdmin } from '@/lib/supabase';
import { requiresHITL, getHITLInfo } from './hitl';
import { buildTenantSystemPrompt, isAgentAllowed } from './persona';
import { trackCost, assertQuota, QuotaExceededError } from './cost-tracker';
import type { StreamEvent } from './stream-encoder';
import type { AgentType, AgentRunResult, JarvisContext, PendingActionInfo } from './types';

const MAX_ROUNDS = Number.parseInt(process.env.JARVIS_V2_MAX_ROUNDS ?? '5', 10);
const HISTORY_TURNS = Number.parseInt(process.env.JARVIS_V2_HISTORY_TURNS ?? '5', 10);
const FALLBACK_MSG = '일시적인 오류가 발생했어요. 잠시 후 다시 시도해주세요.';
const ESCALATE_MSG = '요청이 조금 복잡하네요. 담당자에게 확인 후 정확히 안내드릴게요.';

export interface DeepSeekAgentV2Config {
  agentType: AgentType;
  systemPrompt: string;
  tools: any[]; // Anthropic/OpenAI style tools
  executeTool: (name: string, args: Record<string, any>, ctx: JarvisContext) => Promise<any>;
  contextExtractor?: (toolName: string, result: any) => Record<string, any>;
  model?: string;
  maxRounds?: number;
}

export interface V2RunParams {
  message: string;
  session: any;
  ctx: JarvisContext;
}

function getDeepSeek(): OpenAI {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY 미설정');
  return new OpenAI({ apiKey: key, baseURL: 'https://api.deepseek.com' });
}

export async function* runDeepSeekAgentLoopV2(
  config: DeepSeekAgentV2Config,
  params: V2RunParams,
): AsyncGenerator<StreamEvent, AgentRunResult> {
  const client = getDeepSeek();
  const model = config.model ?? process.env.JARVIS_V2_AGENT_MODEL ?? 'deepseek-v4-pro';
  const maxRounds = config.maxRounds ?? MAX_ROUNDS;
  const startedAt = Date.now();
  const totalUsage = { promptTokenCount: 0, candidatesTokenCount: 0, cachedContentTokenCount: 0, thoughtsTokenCount: 0 };

  // 1) 쿼터 및 권한 체크
  try {
    await assertQuota(params.ctx);
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      yield { type: 'error', data: { reason: 'quota_exceeded', message: err.message } };
      return emptyResult('이번 달 사용량 한도에 도달했어요. 관리자에게 문의해 주세요.');
    }
    throw err;
  }

  if (!(await isAgentAllowed(params.ctx, config.agentType))) {
    yield { type: 'error', data: { reason: 'agent_not_allowed' } };
    return emptyResult('이 기능은 현재 사용 권한이 없어요. 관리자에게 문의해 주세요.');
  }

  const tenantAwarePrompt = await buildTenantSystemPrompt(config.systemPrompt, params.ctx);

  // 2) 히스토리 + 현재 메시지 구성
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: tenantAwarePrompt },
    ...(params.session?.messages ?? []).slice(-HISTORY_TURNS).map((m: any) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: params.message },
  ];

  const toolsUsed: string[] = [];
  const contextUpdate: Record<string, any> = {};
  let aggregatedText = '';
  let pendingAction: PendingActionInfo | null = null;
  let pendingActionId: string | null = null;

  // DeepSeek tools format (Anthropic tools 와 유사하나 OpenAI 스펙 준수 필요)
  const openaiTools: OpenAI.Chat.ChatCompletionTool[] = config.tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema || t.parameters, // 둘 다 지원
    }
  }));

  for (let round = 0; round < maxRounds; round++) {
    let roundText = '';
    let toolCalls: any[] = [];

    try {
      const stream = await client.chat.completions.create({
        model,
        messages,
        tools: openaiTools,
        stream: true,
        temperature: 0.1,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          roundText += delta.content;
          yield { type: 'text_delta', data: delta.content };
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.function?.name) {
              yield { type: 'tool_use_start', data: { name: tc.function.name } };
            }
            // tool call chunk 병합
            const idx = tc.index;
            if (!toolCalls[idx]) toolCalls[idx] = { id: tc.id, function: { name: '', arguments: '' } };
            if (tc.id) toolCalls[idx].id = tc.id;
            if (tc.function?.name) toolCalls[idx].function.name = tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
          }
        }
        // Usage tracking (OpenAI SDK 는 마지막 chunk 에 usage 포함 가능)
        if ((chunk as any).usage) {
          const u = (chunk as any).usage;
          totalUsage.promptTokenCount += u.prompt_tokens || 0;
          totalUsage.candidatesTokenCount += u.completion_tokens || 0;
          totalUsage.cachedContentTokenCount += u.prompt_cache_hit_tokens || 0; // DeepSeek 캐시 히트 추적
        }
      }
    } catch (err) {
      console.error('[jarvis-v2-deepseek] stream 오류:', err);
      yield { type: 'error', data: { reason: 'upstream_error' } };
      return emptyResult(FALLBACK_MSG);
    }

    aggregatedText += roundText;
    
    // 유효한 tool call 만 필터링
    toolCalls = toolCalls.filter(tc => tc && tc.function?.name);

    if (toolCalls.length === 0) {
      // 텍스트 응답으로 종료
      messages.push({ role: 'assistant', content: roundText });
      void trackCost({
        ctx: params.ctx, sessionId: params.session?.id, agentType: config.agentType,
        model, usage: totalUsage, latencyMs: Date.now() - startedAt,
      });
      yield { type: 'done', data: { round, toolsUsed } };
      return {
        response: aggregatedText,
        toolsUsed,
        pendingAction: null,
        pendingActionId: null,
        contextUpdate,
      };
    }

    // Assistant 턴 기록
    messages.push({
      role: 'assistant',
      content: roundText || null,
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments }
      }))
    });

    // HITL 체크 (DeepSeek 도 parallel tool call 중 하나라도 HITL 이면 중단)
    const hitlCall = toolCalls.find(tc => tc.function?.name && requiresHITL(tc.function.name));
    if (hitlCall) {
      const name = hitlCall.function.name;
      const args = JSON.parse(hitlCall.function.arguments || '{}');
      toolsUsed.push(name);
      const info = getHITLInfo(name)!;
      const { data: pending } = await supabaseAdmin
        .from('jarvis_pending_actions')
        .insert({
          session_id: params.session?.id,
          agent_type: config.agentType,
          tool_name: name,
          tool_args: args,
          description: info.description,
          risk_level: info.riskLevel,
        })
        .select()
        .single();

      pendingActionId = pending?.id ?? null;
      pendingAction = {
        id: pending?.id ?? '',
        toolName: name,
        description: info.description,
        riskLevel: info.riskLevel,
        args,
      };
      const confirmMsg = `다음 작업을 실행하려고 합니다:\n\n**${info.description}**\n\n승인하시겠습니까?`;
      yield { type: 'text_delta', data: confirmMsg };
      yield { type: 'hitl_pending', data: pendingAction };
      void trackCost({
        ctx: params.ctx, sessionId: params.session?.id, agentType: config.agentType,
        model, usage: totalUsage, latencyMs: Date.now() - startedAt,
      });
      yield { type: 'done', data: { round, toolsUsed, pending: true } };
      return {
        response: aggregatedText + confirmMsg,
        toolsUsed,
        pendingAction,
        pendingActionId,
        contextUpdate,
      };
    }

    // 병렬 Tool 실행
    const executionResults = await Promise.all(
      toolCalls.map(async (tc) => {
        const name = tc.function.name;
        const args = JSON.parse(tc.function.arguments || '{}');
        toolsUsed.push(name);
        try {
          const result = await config.executeTool(name, args, params.ctx);
          if (config.contextExtractor) {
            Object.assign(contextUpdate, config.contextExtractor(name, result));
          }
          await supabaseAdmin.from('jarvis_tool_logs').insert({
            session_id: params.session?.id,
            agent_type: config.agentType,
            tool_name: name,
            tool_args: args,
            result,
            is_hitl: false,
          });
          return { id: tc.id, name, ok: true as const, result };
        } catch (err: any) {
          return { id: tc.id, name, ok: false as const, error: humanizeError(name, String(err?.message ?? err)) };
        }
      })
    );

    for (const r of executionResults) {
      yield { type: 'tool_result', data: { name: r.name, ok: r.ok } };
      messages.push({
        role: 'tool',
        tool_call_id: r.id,
        content: r.ok ? JSON.stringify({ result: r.result }) : JSON.stringify({ error: r.error }),
      });
    }
  }

  // 상한 초과
  yield { type: 'text_delta', data: ESCALATE_MSG };
  void trackCost({
    ctx: params.ctx, sessionId: params.session?.id, agentType: config.agentType,
    model, usage: totalUsage, latencyMs: Date.now() - startedAt,
  });
  yield { type: 'done', data: { reason: 'max_rounds', toolsUsed } };
  return {
    response: aggregatedText || ESCALATE_MSG,
    toolsUsed,
    pendingAction: null,
    pendingActionId: null,
    contextUpdate,
  };
}

function emptyResult(msg: string): AgentRunResult {
  return { response: msg, toolsUsed: [], pendingAction: null, pendingActionId: null, contextUpdate: {} };
}

function humanizeError(toolName: string, rawMsg: string): string {
  if (rawMsg.includes('duplicate key') || rawMsg.includes('already exists')) {
    return '이미 등록된 정보가 있어요. 중복 확인 후 다시 시도해 주세요.';
  }
  if (rawMsg.includes('violates foreign key') || rawMsg.includes('foreign key')) {
    return '연결된 정보를 찾을 수 없어요. 고객 또는 상품 정보를 먼저 확인해 주세요.';
  }
  if (rawMsg.includes('not found')) {
    return '해당 정보를 찾을 수 없어요. 이름이나 번호를 다시 확인해 주세요.';
  }
  return '처리 중 잠깐 문제가 생겼어요.';
}
