import { NextRequest } from 'next/server';
import {
  isSupabaseConfigured,
  getVouchersForReviewNotification,
  updateVoucher,
} from '@/lib/supabase';
import { sendReviewRequestAlimtalk } from '@/lib/kakao';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';

/**
 * GET /api/cron/post-travel
 *
 * 사후 관리 스케줄러 — 여행 종료 +1일 후 만족도 조사 알림톡 자동 발송
 *
 * 처리 흐름:
 *   1. vouchers 테이블에서 end_date <= yesterday AND review_notified = false 조회
 *   2. 각 voucher에 대해 sendReviewRequestAlimtalk() 호출
 *   3. 발송 완료 후 review_notified = true 업데이트
 */
export const dynamic = 'force-dynamic';

const handlePostTravel = async (request: NextRequest) => {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }
  if (!isSupabaseConfigured) {
    return { ok: true, processed: 0, mock: true, message: 'Supabase 미설정', errors: [] as string[] };
  }

  const vouchers = await getVouchersForReviewNotification();
  if (vouchers.length === 0) {
    return { ok: true, processed: 0, message: '발송 대상 없음' };
  }

  const errors: string[] = [];
  let sentCount = 0;

  for (const voucher of vouchers) {
    try {
      const customerName = voucher.parsed_data?.customer?.name ?? '고객';
      const productTitle = voucher.parsed_data?.travel?.product_title ?? '여행 상품';

      const phone = voucher.customer_phone;
      if (!phone) {
        errors.push(`voucher ${voucher.id}: 전화번호 없음 — 건너뜀`);
        continue;
      }

      await sendReviewRequestAlimtalk({
        phone,
        name: customerName,
        productTitle,
        bookingId: voucher.booking_id ?? voucher.id,
      });

      await updateVoucher(voucher.id, { review_notified: true });
      sentCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '알 수 없는 오류';
      errors.push(`voucher ${voucher.id}: ${msg}`);
      console.error(`[post-travel] voucher ${voucher.id} 처리 실패`, err);
    }
  }

  return {
    ok: true,
    processed: vouchers.length,
    sent: sentCount,
    failed: errors.length,
    errors,
  };
};

export const GET = withCronLogging('post-travel', handlePostTravel);
