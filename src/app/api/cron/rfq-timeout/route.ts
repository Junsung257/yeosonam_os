import { NextRequest } from 'next/server';
import { withCronGuard } from '@/lib/cron-auth';
import {
  isSupabaseConfigured,
} from '@/lib/supabase';
import {
  getExpiredBids,
  claimExpiredRfqBidTimeout,
  updateTenantReliability,
  createRfqMessage,
} from '@/lib/db/rfq-server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

// Vercel Cron: 매 10분마다 실행 (vercel.json에 설정 필요)
// {
//   "crons": [{ "path": "/api/cron/rfq-timeout", "schedule": "*/10 * * * *" }]
// }

export const dynamic = 'force-dynamic';
const getHandler = async (_request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase not configured' }, { status: 503 });
  }

  try {
    const expiredBids = await getExpiredBids();

    if (expiredBids.length === 0) {
      return apiResponse({ processed: 0, timeout_bids: [] });
    }

    const timeoutBidIds: string[] = [];

    await Promise.all(
      expiredBids.map(async bid => {
        try {
          // 1. locked + expired 상태를 조건부로 선점한다. 겹친 cron은 false를 받고 부수효과를 건너뛴다.
          const claimed = await claimExpiredRfqBidTimeout(bid.id);
          if (!claimed) return;

          // 2. 테넌트 신뢰도 점수 차감
          await updateTenantReliability(bid.tenant_id, -5);

          // 3. 시스템 메시지 생성 (어드민용)
          await createRfqMessage({
            rfq_id: bid.rfq_id,
            sender_type: 'system',
            raw_content: `입찰 참여권이 자동 회수되었습니다. (테넌트 ID: ${bid.tenant_id}, 입찰 ID: ${bid.id}) — 3시간 내 제안서 미제출로 인한 자동 처리`,
            processed_content: `입찰 참여권이 자동 회수되었습니다. (테넌트 ID: ${bid.tenant_id}, 입찰 ID: ${bid.id}) — 3시간 내 제안서 미제출로 인한 자동 처리`,
            pii_detected: false,
            pii_blocked: false,
            recipient_type: 'admin',
            is_visible_to_customer: false,
            is_visible_to_tenant: false,
          });

          timeoutBidIds.push(bid.id);
        } catch (bidError) {
          console.error(`입찰 타임아웃 처리 실패 (bid.id: ${bid.id}):`, sanitizeDbError(bidError));
        }
      })
    );

    console.log(`[cron/rfq-timeout] ${timeoutBidIds.length}건 타임아웃 처리 완료`);

    return apiResponse({
      processed: timeoutBidIds.length,
      timeout_bids: timeoutBidIds,
    });
  } catch (error) {
    const message = sanitizeDbError(error, 'RFQ timeout failed');
    console.error('RFQ 타임아웃 크론 오류:', message);
    return apiResponse(
      { error: message },
      { status: 500 }
    );
  }
}

export const GET = withCronGuard(getHandler);
