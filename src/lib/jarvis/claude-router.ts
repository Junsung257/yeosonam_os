import OpenAI from 'openai';
import { RouterResult } from './types';
import { ROUTER_PROMPT } from './prompts';

/**
 * 자비스 의도 라우터 (DeepSeek V4-Flash)
 * 
 * V3 (2026-05-01): Gemini → DeepSeek 전환 (비용 절감 + 속도 최적화)
 */
export async function routeMessage(
  userMessage: string,
  context: Record<string, any>
): Promise<RouterResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return { agent: 'operations', confidence: 0.5, reasoning: 'API 키 미설정' };
  }

  const client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com' });
  const model = process.env.JARVIS_ROUTER_MODEL || 'deepseek-v4-flash';

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: ROUTER_PROMPT },
        { role: 'user', content: `컨텍스트: ${JSON.stringify(context)}\n\n사용자 메시지: ${userMessage}` },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const text = response.choices?.[0]?.message?.content || '';
    return JSON.parse(text) as RouterResult;
  } catch (err) {
    console.error('[자비스-라우터] 오류:', err);
    return { agent: 'operations', confidence: 0.5, reasoning: '라우팅 실패, 기본 에이전트 사용' };
  }
}
