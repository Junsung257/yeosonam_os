import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { recordPlatformLearningEvent } from '@/lib/platform-learning';
import { recordAgentIncident } from '@/lib/agent/tasking';
import {
  recordResponseFeedback,
  promoteToNegativeExample,
} from '@/lib/response-learning';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : null;
    const rating = body?.rating === 'down' ? 'down' : body?.rating === 'up' ? 'up' : null;
    const reason = typeof body?.reason === 'string' ? body.reason : null;
    const responseText = typeof body?.responseText === 'string' ? body.responseText : null;
    const raterType: 'customer' | 'admin' | 'partner' =
      body?.raterType === 'admin' ? 'admin'
      : body?.raterType === 'partner' ? 'partner'
      : 'customer';
    const destination = typeof body?.destination === 'string' ? body.destination : null;
    const promote = body?.promote === true;
    const leadSource: string =
      typeof body?.leadSource === 'string' ? body.leadSource : 'unknown';

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
          leadSource,
        },
      });

      // 새 response_feedback 테이블에 적재 (학습 신호 본체)
      void recordResponseFeedback({
        source: 'qa_chat',
        sessionId,
        conversationId: sessionId,
        reply: responseText ?? '',
        rating: rating === 'up' ? 1 : -1,
        raterType,
        reasonCategory: reason,
        metadata: { legacy: true, leadSource },
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

        // 어드민의 down + promote 옵션이면 즉시 negative example 박제
        if (raterType === 'admin' && promote && responseText) {
          void promoteToNegativeExample({
            destination,
            badReplyExcerpt: responseText,
            issueCategory: reason,
            severity: 'warn',
          });
        }
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

