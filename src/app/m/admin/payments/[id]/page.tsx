import { notFound } from 'next/navigation';
import Link from 'next/link';
import { MobileHeader } from '@/components/admin/mobile/MobileHeader';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { fmtK, fmtDate } from '@/lib/admin-utils';
import {
  matchPaymentToBookings,
  applyDuplicateNameGuard,
  classifyMatch,
  type BookingCandidate,
} from '@/lib/payment-matcher';
import PaymentActions from './_actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function fetchTransaction(id: string) {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabaseAdmin
    .from('bank_transactions')
    .select(
      'id, transaction_type, amount, counterparty_name, memo, received_at, match_status, match_confidence, matched_by, matched_at, is_refund, is_fee, booking_id, bookings!booking_id(id, booking_no, package_title, total_price, paid_amount, customers!lead_customer_id(name))'
    )
    .eq('id', id)
    .maybeSingle();
  return data;
}

async function fetchActiveBookings(): Promise<BookingCandidate[]> {
  if (!isSupabaseConfigured) return [];
  const { data } = await supabaseAdmin
    .from('bookings')
    .select(
      'id, booking_no, package_title, total_price, total_cost, paid_amount, total_paid_out, status, payment_status, actual_payer_name, customers!lead_customer_id(name)'
    )
    .in('status', ['pending', 'confirmed']);

  return ((data as any[]) || []).map((b: any) => ({
    id: b.id,
    booking_no: b.booking_no,
    package_title: b.package_title,
    total_price: b.total_price,
    total_cost: b.total_cost,
    paid_amount: b.paid_amount,
    total_paid_out: b.total_paid_out,
    status: b.status,
    payment_status: b.payment_status,
    actual_payer_name: b.actual_payer_name,
    customer_name: b.customers?.name,
  }));
}

export default async function MobilePaymentDetail({
  params,
}: {
  params: { id: string };
}) {
  const tx = (await fetchTransaction(params.id)) as any;
  if (!tx) notFound();

  // unmatched/review 일 때만 후보 계산
  let candidates: Array<{
    booking: BookingCandidate;
    confidence: number;
    reasons: string[];
    matchClass: 'auto' | 'review' | 'unmatched';
  }> = [];
  if (tx.match_status === 'unmatched' || tx.match_status === 'review') {
    const allBookings = await fetchActiveBookings();
    const rawResults = matchPaymentToBookings({
      amount: tx.amount,
      senderName: tx.counterparty_name ?? '',
      bookings: allBookings,
    });
    const guarded = applyDuplicateNameGuard(rawResults);
    candidates = guarded.slice(0, 5).map(r => ({
      booking: r.booking,
      confidence: r.confidence,
      reasons: r.reasons,
      matchClass: classifyMatch(r.confidence),
    }));
  }

  return (
    <>
      <MobileHeader
        title={tx.transaction_type === '입금' ? '입금 상세' : '출금 상세'}
        subtitle={tx.counterparty_name ?? '상대방 미상'}
        showBack
        backHref="/m/admin/payments"
      />
      <main className="px-4 py-4 space-y-4 pb-8">
        <section className="bg-white border border-slate-200 rounded-2xl px-4 py-4">
          <div className="text-xs text-slate-500">금액</div>
          <div className="text-3xl font-bold tabular-nums text-emerald-700 mt-1">
            +{fmtK(tx.amount)}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            {tx.received_at
              ? new Date(tx.received_at).toLocaleString('ko-KR', {
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '시각 미상'}
          </div>
          {tx.memo && (
            <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600 whitespace-pre-wrap">
              메모: {tx.memo}
            </div>
          )}
        </section>

        {tx.bookings ? (
          <section className="bg-white border border-emerald-200 rounded-2xl px-4 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-emerald-700">
                현재 매칭된 예약
              </h3>
              <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                {tx.match_status === 'auto' ? '자동' : '수동'}
              </span>
            </div>
            <Link
              href={`/m/admin/bookings/${tx.bookings.id}`}
              className="block"
            >
              <div className="text-sm font-semibold text-slate-900">
                {tx.bookings.booking_no} · {tx.bookings.customers?.name ?? ''}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {tx.bookings.package_title}
              </div>
              <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                판매가 {fmtK(tx.bookings.total_price ?? 0)} · 입금{' '}
                {fmtK(tx.bookings.paid_amount ?? 0)}
              </div>
            </Link>
          </section>
        ) : candidates.length > 0 ? (
          <section className="bg-white border border-slate-200 rounded-2xl px-4 py-4 space-y-3">
            <h3 className="text-xs font-semibold text-slate-500">
              매칭 후보 · 상위 {candidates.length}건
            </h3>
            <PaymentActions
              transactionId={tx.id}
              candidates={candidates.map(c => ({
                bookingId: c.booking.id,
                booking_no: c.booking.booking_no ?? null,
                customer_name: c.booking.customer_name ?? null,
                package_title: c.booking.package_title ?? null,
                total_price: c.booking.total_price ?? null,
                paid_amount: c.booking.paid_amount ?? null,
                departure_date: null,
                confidence: c.confidence,
                reasons: c.reasons,
                matchClass: c.matchClass,
              }))}
              currentStatus={tx.match_status}
              hasMatch={false}
            />
          </section>
        ) : (
          <section className="bg-white border border-slate-200 rounded-2xl px-4 py-6 text-center text-sm text-slate-500">
            일치하는 예약 후보를 찾지 못했습니다.
            <PaymentActions
              transactionId={tx.id}
              candidates={[]}
              currentStatus={tx.match_status}
              hasMatch={false}
            />
          </section>
        )}

        {tx.bookings && (
          <PaymentActions
            transactionId={tx.id}
            candidates={[]}
            currentStatus={tx.match_status}
            hasMatch={true}
          />
        )}
      </main>
    </>
  );
}
