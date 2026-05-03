import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getStatusLabel } from '@/lib/booking-state-machine';
import { resolveGuestPortalBookingId, touchGuestPortalToken } from '@/lib/booking-guest-token';

export const dynamic = 'force-dynamic';

export default async function GuestTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured || !token?.trim()) notFound();

  const resolved = await resolveGuestPortalBookingId(token.trim());
  if (!resolved) notFound();

  await touchGuestPortalToken(resolved.tokenRowId).catch(() => {});

  const { data: booking, error } = await supabaseAdmin
    .from('bookings')
    .select(
      'booking_no, package_title, status, departure_date, total_price, paid_amount, deposit_amount, adult_count, child_count',
    )
    .eq('id', resolved.bookingId)
    .maybeSingle();

  if (error || !booking) notFound();

  const b = booking as {
    booking_no?: string;
    package_title?: string;
    status: string;
    departure_date?: string;
    total_price?: number;
    paid_amount?: number;
    deposit_amount?: number;
    adult_count?: number;
    child_count?: number;
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 text-slate-800 px-4 py-10">
      <div className="max-w-md mx-auto">
        <div className="rounded-2xl bg-white shadow-lg ring-1 ring-slate-200/80 overflow-hidden">
          <div className="bg-slate-800 px-5 py-4">
            <p className="text-[11px] font-semibold tracking-widest text-slate-400 uppercase">예약 요약</p>
            <h1 className="text-lg font-bold text-white mt-1">여소남 여행 예약</h1>
          </div>
          <div className="p-5 space-y-4 text-[14px]">
            <div className="flex justify-between gap-3 border-b border-slate-100 pb-3">
              <span className="text-slate-500">예약번호</span>
              <span className="font-mono font-semibold text-slate-900">{b.booking_no ?? '—'}</span>
            </div>
            <div className="flex justify-between gap-3 border-b border-slate-100 pb-3">
              <span className="text-slate-500">상품</span>
              <span className="font-medium text-right text-slate-900">{b.package_title ?? '—'}</span>
            </div>
            <div className="flex justify-between gap-3 border-b border-slate-100 pb-3">
              <span className="text-slate-500">진행 단계</span>
              <span className="font-semibold text-emerald-700">{getStatusLabel(b.status)}</span>
            </div>
            {b.departure_date && (
              <div className="flex justify-between gap-3 border-b border-slate-100 pb-3">
                <span className="text-slate-500">출발일</span>
                <span className="font-medium">{b.departure_date}</span>
              </div>
            )}
            <div className="flex justify-between gap-3 border-b border-slate-100 pb-3">
              <span className="text-slate-500">인원</span>
              <span className="font-medium">
                성인 {b.adult_count ?? 0}
                {(b.child_count ?? 0) > 0 ? ` · 아동 ${b.child_count}` : ''}
              </span>
            </div>
            <div className="flex justify-between gap-3 border-b border-slate-100 pb-3">
              <span className="text-slate-500">총 금액</span>
              <span className="font-bold tabular-nums">{(b.total_price ?? 0).toLocaleString()}원</span>
            </div>
            {(b.deposit_amount ?? 0) > 0 && (
              <div className="flex justify-between gap-3 border-b border-slate-100 pb-3">
                <span className="text-slate-500">계약금 기준</span>
                <span className="font-medium tabular-nums">{(b.deposit_amount ?? 0).toLocaleString()}원</span>
              </div>
            )}
            <div className="flex justify-between gap-3 pb-1">
              <span className="text-slate-500">납부 합계</span>
              <span className="font-semibold tabular-nums text-blue-700">
                {(b.paid_amount ?? 0).toLocaleString()}원
              </span>
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-[12px] text-slate-500 leading-relaxed">
          세부 안내·변경은 카카오톡 채널로 연락 주시면 빠르게 도와드립니다.
          <br />
          링크는 본인만 사용해 주세요.
        </p>
        <div className="mt-4 text-center">
          <Link
            href="/"
            className="text-[13px] text-blue-600 hover:text-blue-800 font-medium underline underline-offset-2"
          >
            홈으로
          </Link>
        </div>
      </div>
    </main>
  );
}
