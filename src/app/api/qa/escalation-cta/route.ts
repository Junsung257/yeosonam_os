/**
 * POST /api/qa/escalation-cta
 * 고객이 QA 채팅 에스컬레이션에서 전화·카톡 버튼을 눌렀을 때 — 학습 이벤트 + 문의 큐(선택)
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveAffiliateScopeId } from '@/lib/affiliate-scope';
import { redactForPlatformLearning } from '@/lib/message-redact';
import { recordPlatformLearningEvent } from '@/lib/platform-learning';
import { allowRateLimit, getClientIpFromRequest } from '@/lib/simple-rate-limit';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const CHANNELS = new Set(['phone', 'kakao']);
const MAX_SUMMARY_CHARS = 2000;
/** IP당 1분에 최대 요청 (서버리스 인스턴스별) */
const RATE_MAX = 30;

function normalizeConversationSummary(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const stripped = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, MAX_SUMMARY_CHARS);
  if (!stripped) return null;
  return redactForPlatformLearning(stripped) ?? stripped;
}

export async function POST(req: NextRequest) {
  const ip = getClientIpFromRequest(req);
  if (!allowRateLimit(`escalation-cta:${ip}`, RATE_MAX)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const channel = b.channel;
  if (typeof channel !== 'string' || !CHANNELS.has(channel)) {
    return NextResponse.json({ error: 'invalid_channel' }, { status: 400 });
  }

  const sessionId =
    typeof b.sessionId === 'string' && b.sessionId.length < 200 ? b.sessionId : null;
  const affiliateRef =
    typeof b.affiliateRef === 'string' && b.affiliateRef.length < 500
      ? b.affiliateRef
      : null;
  const path =
    typeof b.path === 'string' ? b.path.trim().slice(0, 300) : null;

  const summaryRedacted = normalizeConversationSummary(b.conversationSummary);

  const affiliateId = await resolveAffiliateScopeId({ referrer: affiliateRef });

  recordPlatformLearningEvent({
    source: 'qa_escalation_cta',
    sessionId,
    affiliateId,
    tenantId: null,
    userMessage: `[escalation_cta] ${channel}`,
    payload: {
      channel,
      path,
      conversation_summary_attached: Boolean(summaryRedacted),
    },
  });

  if (isSupabaseConfigured) {
    const label = channel === 'phone' ? '전화' : '카카오톡';
    const sessionNote = sessionId ? ` 세션: ${sessionId.slice(0, 8)}…` : '';
    const pathNote = path ? ` 페이지: ${path}` : '';
    let question = `AI 상담 에스컬레이션 — ${label} 연결 선택.${sessionNote}${pathNote ? ` ${pathNote}` : ''}`;
    if (summaryRedacted) {
      question += `\n\n--- 고객 발화 요약(PII 마스킹) ---\n${summaryRedacted}`;
    }

    void supabaseAdmin
      .from('qa_inquiries')
      .insert({
        question,
        inquiry_type: 'escalation_cta',
        related_packages: [],
        status: 'pending',
      })
      .then(
        (res: { error: { message: string } | null }) => {
          if (res.error) console.warn('[escalation-cta] qa_inquiries:', res.error.message);
        },
        (e: unknown) => console.warn('[escalation-cta] qa_inquiries exception:', e),
      );
  }

  return NextResponse.json({ ok: true });
}
