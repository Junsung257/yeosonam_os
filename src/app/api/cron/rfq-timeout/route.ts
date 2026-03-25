import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  getExpiredBids,
  updateRfqBid,
  updateTenantReliability,
  createRfqMessage,
} from '@/lib/supabase';

// Vercel Cron: 매 10분마다 실행 (vercel.json에 설정 필요)
// {
//   "crons": [{ "path": "/api/cron/rfq-timeout", "schedule": "*/10 * * * *" }]
// }

export async function GET(_request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  try {
    const expiredBids = await getExpiredBids();

    if (expiredBids.length === 0) {
      return NextResponse.json({ processed: 0, timeout_bids: [] });
    }

    const timeoutBidIds: string[] = [];

    await Promise.all(
      expiredBids.map(async bid => {
        try {
          // 1. 입찰 상태를 timeout으로 변경 + 패널티 적용
          await updateRfqBid(bid.id, {
            status: 'timeout',
            is_penalized: true,
            penalty_reason: '3시간 내 미제출',
          });

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
          console.error(`입찰 타임아웃 처리 실패 (bid.id: ${bid.id}):`, bidError);
        }
      })
    );

    console.log(`[cron/rfq-timeout] ${timeoutBidIds.length}건 타임아웃 처리 완료`);

    return NextResponse.json({
      processed: timeoutBidIds.length,
      timeout_bids: timeoutBidIds,
    });
  } catch (error) {
    console.error('RFQ 타임아웃 크론 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '타임아웃 처리에 실패했습니다.' },
      { status: 500 }
    );
  }
}
