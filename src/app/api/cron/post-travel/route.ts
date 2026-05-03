import { NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  getVouchersForReviewNotification,
  updateVoucher,
} from '@/lib/supabase';
import { sendReviewRequestAlimtalk } from '@/lib/kakao';

/**
 * GET /api/cron/post-travel
 *
 * 사후 관리 스케줄러 — 여행 종료 +1일 후 만족도 조사 알림톡 자동 발송
 *
 * 호출 방법:
 *   1. Vercel Cron (vercel.json에 "crons" 등록):
 *      { "path": "/api/cron/post-travel", "schedule": "0 9 * * *" }  ← 매일 오전 9시
 *
 *   2. 또는 외부 cron 서비스 (GitHub Actions, EasyCron 등):
 *      curl https://yeosonam.com/api/cron/post-travel
 *      (Authorization: Bearer CRON_SECRET 헤더 검증 권장)
 *
 * 처리 흐름:
 *   1. vouchers 테이블에서 end_date <= yesterday AND review_notified = false 조회
 *   2. 각 voucher에 대해 sendReviewRequestAlimtalk() 호출
 *   3. 발송 완료 후 review_notified = true 업데이트
 *
 * ── 스케줄러 확장 아이디어 (주석) ──────────────────────────────
 *
 * // TODO: 출발 D-7 준비물 안내 알림톡
 * // vouchers WHERE departure_date = today + 7 days AND d7_notified = false
 * // → sendPreparationGuide() 호출
 *
 * // TODO: 잔금 납부 D-3 알림톡
 * // bookings WHERE payment_due_date = today + 3 days AND balance_notified = false
 * // → sendBalanceNotice() 호출
 *
 * // TODO: 여권 만료 임박 알림톡
 * // customers WHERE passport_expiry BETWEEN today AND today + 180 days
 * //   AND passport_warning_sent = false
 * // → sendPassportExpiryNotice() 호출
 *
 * // TODO: C2C 공유 전환율 집계
 * // 알림톡 공유 링크 클릭 후 신규 예약 연결 → 추천인 보상(마일리지) 지급
 */
export const dynamic = 'force-dynamic';
export async function GET(): Promise<NextResponse> {
  // ── 간단한 Cron Secret 검증 (선택사항, 보안 강화 시 활성화) ──
  // const authHeader = request.headers.get('authorization');
  // if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // }

  if (!isSupabaseConfigured) {
    console.log('[post-travel cron] Supabase 미설정 — Mock 실행');
    return NextResponse.json({
      ok: true,
      processed: 0,
      mock: true,
      message: 'Supabase 미설정 환경에서는 실제 발송하지 않습니다',
    });
  }

  // ── 만족도 조사 대상 확정서 조회 ─────────────────────────────
  const vouchers = await getVouchersForReviewNotification();

  if (vouchers.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: '발송 대상 없음' });
  }

  const results: { id: string; status: 'sent' | 'failed'; reason?: string }[] = [];

  for (const voucher of vouchers) {
    try {
      // 고객 연락처는 parsed_data 또는 별도 customers 테이블 조회 필요
      // 여기서는 parsed_data에서 고객명을 가져오고, 전화번호는 customers 테이블 JOIN 필요
      // (현재 구조상 customer_phone이 vouchers 테이블에 없으므로 실제 운영 시 조인 쿼리 추가)

      const customerName = voucher.parsed_data?.customer?.name ?? '고객';
      const productTitle = voucher.parsed_data?.travel?.product_title ?? '여행 상품';

      // TODO: 실제 운영 시 아래 주석 해제 후 customers 테이블에서 phone 조회
      // const customer = await getCustomer(voucher.customer_id!);
      // if (!customer?.phone) throw new Error('연락처 없음');
      // await sendReviewRequestAlimtalk({
      //   phone: customer.phone,
      //   name: customerName,
      //   productTitle,
      //   bookingId: voucher.booking_id ?? voucher.id,
      // });

      // 개발 단계: 로그만 출력
      await sendReviewRequestAlimtalk({
        phone: 'PLACEHOLDER',  // 실제 운영 전 교체 필요
        name: customerName,
        productTitle,
        bookingId: voucher.booking_id ?? voucher.id,
      });

      // 발송 완료 → review_notified = true
      await updateVoucher(voucher.id, { review_notified: true });

      results.push({ id: voucher.id, status: 'sent' });
    } catch (err) {
      console.error(`[post-travel cron] voucher ${voucher.id} 처리 실패`, err);
      results.push({
        id: voucher.id,
        status: 'failed',
        reason: err instanceof Error ? err.message : '알 수 없는 오류',
      });
    }
  }

  const sentCount = results.filter((r) => r.status === 'sent').length;
  const failedCount = results.filter((r) => r.status === 'failed').length;

  console.log(`[post-travel cron] 완료 — 발송: ${sentCount}, 실패: ${failedCount}`);

  return NextResponse.json({
    ok: true,
    processed: vouchers.length,
    sent: sentCount,
    failed: failedCount,
    results,
  });
}
