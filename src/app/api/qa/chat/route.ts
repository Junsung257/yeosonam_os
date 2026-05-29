import { NextRequest } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { ApiErrors } from '@/lib/api-response';
import { rateLimitAI } from '@/lib/rate-limiter';
import { detectPromptInjection } from '@/lib/guardrails/prompt-injection';
import { allowRateLimit, getClientIpFromRequest } from '@/lib/simple-rate-limit';
import { hasResilientLlmConfig } from '@/lib/secret-registry';
import { createV1QaChatStream } from '@/lib/qa-chat-engine';
import { recordAgentIncident } from '@/lib/agent/tasking';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const limited = await rateLimitAI(request);
  if (limited) return limited;

  const body = await request.json();
  const {
    message,
    history = [],
    sessionId,
    referrer,
    affiliateRef,
    affiliateId: bodyAffiliateId,
  } = body;

  if (!message?.trim()) {
    return ApiErrors.badRequest('메시지가 필요합니다.');
  }

  const ip = getClientIpFromRequest(request);
  const rlKey = `qa_chat:${ip}:${sessionId ?? 'anon'}`;
  if (!allowRateLimit(rlKey, 25, 60_000)) {
    return ApiErrors.rateLimited('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  }

  const correlationId = crypto.randomUUID();

  const injection = detectPromptInjection(message);
  if (injection.blocked) {
    if (isSupabaseConfigured) {
      await recordAgentIncident({
        correlationId,
        severity: 'warn',
        category: 'prompt_injection',
        message: 'QA 채팅 입력에서 프롬프트 인젝션 의심 패턴 감지',
        details: { reason: injection.reason },
        detectedBy: 'guardrails:prompt-injection',
      });
    }
    return ApiErrors.badRequest('요청이 보안 정책에 의해 차단되었습니다. 상담원 연결로 진행해 주세요.');
  }

  if (!hasResilientLlmConfig()) {
    return ApiErrors.internalError(
      'AI API 키가 설정되지 않았습니다. (DEEPSEEK_API_KEY 권장, 또는 GEMINI_API_KEY / GOOGLE_AI_API_KEY)',
    );
  }

  const isShadowMode = process.env.AI_SHADOW_MODE === 'true';
  if (isShadowMode) {
    const lines = [
      JSON.stringify({
        type: 'text',
        content: '현재 상담 품질 점검 모드입니다. 잠시 후 상담원이 순차적으로 안내드립니다.',
      }),
      JSON.stringify({
        type: 'meta',
        packages: [],
        escalate: true,
        critiqueSeverity: 'warn',
        journey: { stage: 'shadow_mode' },
        freeTravelHref: null,
      }),
      JSON.stringify({ type: 'done' }),
    ].join('\n');
    return new Response(`${lines}\n`, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  const stream = await createV1QaChatStream({
    message,
    history,
    sessionId: sessionId ?? null,
    referrer: referrer ?? null,
    affiliateRef: affiliateRef ?? null,
    affiliateId: bodyAffiliateId ?? null,
    correlationId,
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
