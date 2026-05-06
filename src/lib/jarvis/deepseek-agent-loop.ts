/**
 * 여소남 OS — DeepSeek Agent Loop (Non-streaming)
 * 
 * V3 (2026-05-01): Gemini → DeepSeek V4-Pro 전환
 */

import OpenAI from 'openai';
import { supabaseAdmin } from '@/lib/supabase';
import { requiresHITL, getHITLInfo } from './hitl';
import { AgentType, AgentRunParams, AgentRunResult, PendingActionInfo } from './types';
import { getSecret } from '@/lib/secret-registry';

const MAX_ROUNDS = Number.parseInt(process.env.JARVIS_MAX_ROUNDS ?? '10', 10);
const HISTORY_TURNS = Number.parseInt(process.env.JARVIS_HISTORY_TURNS ?? '10', 10);
const FALLBACK_MSG = '일시적인 오류가 발생했어요. 잠시 후 다시 시도해주세요.';

export interface DeepSeekAgentConfig {
  agentType: AgentType;
  systemPrompt: string;
  tools: any[];
  executeTool: (name: string, args: Record<string, any>) => Promise<any>;
  contextExtractor?: (toolName: string, result: any) => Record<string, any>;
}

export async function runDeepSeekAgentLoop(
  config: DeepSeekAgentConfig,
  params: AgentRunParams
): Promise<AgentRunResult> {
  const { agentType, systemPrompt, tools, executeTool, contextExtractor } = config;
  const { message, session } = params;

  const key = getSecret('DEEPSEEK_API_KEY');
  if (!key) {
    return { response: 'API 키 미설정', toolsUsed: [], pendingAction: null, pendingActionId: null, contextUpdate: {} };
  }

  const client = new OpenAI({ apiKey: key, baseURL: 'https://api.deepseek.com' });
  const model = process.env.JARVIS_AGENT_MODEL || 'deepseek-v4-pro';

  const toolsUsed: string[] = [];
  let pendingAction: PendingActionInfo | null = null;
  let pendingActionId: string | null = null;
  const contextUpdate: Record<string, any> = {};

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...(session?.messages?.slice(-HISTORY_TURNS) || []).map((m: any) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: message },
  ];

  const openaiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema || t.parameters,
    }
  }));

  let lastTextResponse = '';

  for (let round = 0; round < MAX_ROUNDS; round++) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        tools: openaiTools,
        temperature: 0.1,
      });

      const choice = response.choices[0];
      const aiMessage = choice.message;

      if (!aiMessage.tool_calls || aiMessage.tool_calls.length === 0) {
        lastTextResponse = aiMessage.content || '처리가 완료되었습니다.';
        break;
      }

      // Assistant 턴 기록
      messages.push(aiMessage);

      // Tool 실행
      for (const tc of aiMessage.tool_calls) {
        const name = tc.function.name;
        const args = JSON.parse(tc.function.arguments || '{}');
        toolsUsed.push(name);

        if (requiresHITL(name)) {
          const hitlInfo = getHITLInfo(name)!;
          const { data: pending } = await supabaseAdmin
            .from('jarvis_pending_actions')
            .insert({
              session_id: session?.id,
              agent_type: agentType,
              tool_name: name,
              tool_args: args,
              description: hitlInfo.description,
              risk_level: hitlInfo.riskLevel,
            })
            .select()
            .single();

          pendingActionId = pending?.id;
          pendingAction = {
            id: pending?.id,
            toolName: name,
            description: hitlInfo.description,
            riskLevel: hitlInfo.riskLevel,
            args,
          };
          lastTextResponse = `다음 작업을 실행하려고 합니다:\n\n**${hitlInfo.description}**\n\n승인하시겠습니까?`;
          break;
        }

        let toolResult: any;
        try {
          toolResult = await executeTool(name, args);
          if (contextExtractor) {
            Object.assign(contextUpdate, contextExtractor(name, toolResult));
          }
          await supabaseAdmin.from('jarvis_tool_logs').insert({
            session_id: session?.id,
            agent_type: agentType,
            tool_name: name,
            tool_args: args,
            result: toolResult,
            is_hitl: false,
          });
        } catch (err: any) {
          toolResult = { error: err.message };
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify({ result: toolResult }),
        });
      }

      if (pendingAction) break;
    } catch (err) {
      console.error('[자비스-딥시크] 루프 오류:', err);
      return { response: FALLBACK_MSG, toolsUsed, pendingAction, pendingActionId, contextUpdate };
    }
  }

  return {
    response: lastTextResponse,
    toolsUsed,
    pendingAction,
    pendingActionId,
    contextUpdate,
  };
}
