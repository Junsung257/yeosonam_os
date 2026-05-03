import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { recordPlatformLearningEvent } from '@/lib/platform-learning';
import { recordAgentIncident } from '@/lib/agent/tasking';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : null;
    const rating = body?.rating === 'down' ? 'down' : body?.rating === 'up' ? 'up' : null;
    const reason = typeof body?.reason === 'string' ? body.reason : null;
    const responseText = typeof body?.responseText === 'string' ? body.responseText : null;

    if (!rating) {
      return NextResponse.json({ error: 'rating 값이 필요합니다. (up/down)' }, { status: 400 });
    }

    if (isSupabaseConfigured) {
      recordPlatformLearningEvent({
        source: 'qa_chat',
        sessionId,
        affiliateId: null,
        tenantId: null,
        userMessage: responseText,
        payload: {
          event: 'feedback',
          rating,
          reason,
        },
      });

      if (rating === 'down') {
        await recordAgentIncident({
          sessionId,
          severity: 'warn',
          category: 'unknown',
          message: '사용자 부정 피드백 수집',
          details: { reason, responseText },
          detectedBy: 'qa-feedback',
        });
      }

    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '피드백 저장 실패' },
      { status: 500 },
    );
  }
}

