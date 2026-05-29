import { getBookings } from '@/lib/supabase';
import BookingsPageClient from './BookingsPageClient';

// Windows 로컬: force-dynamic (chunk race 회피)
// Vercel(Linux): auto → 서버 pre-fetch 후 클라이언트에 전달
export const dynamic = 'auto'; // Next 15: 조건부 평가 미지원.

export default async function BookingsPage() {
  // 감사(2026-05-11): lite=true — 110+ 컬럼 → 어드민 목록용 50개. 페이로드 50%+ 감소.
  const initialBookings = await getBookings(undefined, undefined, { lite: true });
  return <BookingsPageClient initialBookings={initialBookings as unknown as Array<{ id: string; booking_no?: string; package_title?: string; product_id?: string; lead_customer_id: string; adult_count: number; child_count: number; adult_cost: number; adult_price: number; child_cost: number; child_price: number; fuel_surcharge: number; total_cost?: number; total_price?: number; paid_amount?: number; total_paid_out?: number; margin?: number; payment_status?: string; status: string; cancelled_at?: string | null; cancellation_reason?: string | null; refund_settled_at?: string | null; net_cashflow?: number | null; settlement_confirmed_at?: string | null; settlement_confirmed_by?: string | null; settlement_mode?: 'accrual' | 'cash' | null; commission_rate?: number | null; commission_amount?: number | null; departure_date?: string; departure_region?: string; booking_date?: string; land_operator?: string | null; land_operator_id?: string | null; departing_location_id?: string | null; manager_name?: string; payment_date?: string; notes?: string; is_deleted?: boolean; has_sent_docs?: boolean; metadata?: Record<string, unknown>; created_at: string; customers?: { id: string; name: string; phone?: string }; }>} />;
}
