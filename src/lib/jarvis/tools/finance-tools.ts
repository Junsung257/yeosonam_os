// ─── Finance Tools: 통계, 대량 처리 ──────────────────────────────────────────

import { getDashboardStats } from '@/lib/supabase';
import { processBulkReservations, type BulkItem } from '@/lib/bulk-reservations';

// ─── get_booking_stats ────────────────────────────────────────────────────────
export async function handleGetBookingStats() {
  const stats = await getDashboardStats();
  if (!stats) return { result: { error: '통계 조회 실패' } };

  return {
    result: {
      이번달_총판매가: `${(stats.totalSales / 10000).toFixed(0)}만원 (${stats.totalMonthBookings}건)`,
      입금완료액: `${(stats.totalPaid / 10000).toFixed(0)}만원`,
      미수금_잔금: `${(stats.totalOutstanding / 10000).toFixed(0)}만원`,
      순마진_결제완료기준: `${(stats.margin / 10000).toFixed(0)}만원`,
      진행중예약: `${stats.activeBookings}건`,
      // 원시 숫자도 포함 (프론트 활용)
      raw: {
        totalSales: stats.totalSales,
        totalPaid: stats.totalPaid,
        totalOutstanding: stats.totalOutstanding,
        margin: stats.margin,
        activeBookings: stats.activeBookings,
        totalMonthBookings: stats.totalMonthBookings,
      },
    },
  };
}

// ─── bulk_process_reservations ────────────────────────────────────────────────
export async function handleBulkProcessReservations(args: Record<string, unknown>) {
  const result = await processBulkReservations(args.items as BulkItem[]);
  const actions = result.success_list.map(b => ({ type: 'booking_created', data: b }));
  return { result, actions };
}
