import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Phone } from 'lucide-react';
import { MobileHeader } from '@/components/admin/mobile/MobileHeader';
import { MobileStatusBadge } from '@/components/admin/mobile/MobileStatusBadge';
import {
  JOURNEY_STEPS,
  getStepIndex,
  ALLOWED_TRANSITIONS,
} from '@/lib/booking-state-machine';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { fmtDate, fmtK, getBalance } from '@/lib/admin-utils';
import BookingActions from './_actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function fetchBooking(id: string) {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabaseAdmin
    .from('bookings')
    .select(
      'id, booking_no, status, package_title, departure_date, total_price, total_cost, paid_amount, total_paid_out, adult_count, child_count, memo, special_requests, customers!lead_customer_id(name, phone)'
    )
    .eq('id', id)
    .maybeSingle();
  return data;
}

async function fetchRecentLogs(bookingId: string) {
  if (!isSupabaseConfigured) return [];
  const { data } = await supabaseAdmin
    .from('message_logs')
    .select('id, event_type, title, content, log_type, created_at')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(3);
  return data ?? [];
}

function ProgressBar({ status }: { status: string }) {
  const currentStep = getStepIndex(status);
  const cancelled = status === 'cancelled';
  return (
    <div className="flex items-center gap-1">
      {JOURNEY_STEPS.map(step => {
        const done = !cancelled && currentStep >= step.step;
        const active = !cancelled && currentStep === step.step;
        return (
          <div key={step.status} className="flex-1">
            <div
              className={`h-1.5 rounded-full ${
                cancelled
                  ? 'bg-red-200'
                  : done
                  ? 'bg-emerald-500'
                  : 'bg-slate-200'
              } ${active ? 'ring-2 ring-emerald-300 ring-offset-1' : ''}`}
            />
            <div
              className={`text-[10px] mt-1.5 text-center ${
                done ? 'text-slate-700 font-medium' : 'text-slate-400'
              }`}
            >
              {step.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default async function MobileBookingDetail({
  params,
}: {
  params: { id: string };
}) {
  const booking = await fetchBooking(params.id);
  if (!booking) notFound();

  const logs = await fetchRecentLogs(params.id);

  const customer = (booking as any).customers as
    | { name?: string; phone?: string }
    | null
    | undefined;

  const balance = getBalance({
    total_price: (booking as any).total_price ?? 0,
    paid_amount: (booking as any).paid_amount ?? 0,
  });
  const margin =
    ((booking as any).total_price ?? 0) - ((booking as any).total_cost ?? 0);

  const transitions =
    ALLOWED_TRANSITIONS[(booking as any).status as string] ?? [];

  return (
    <>
      <MobileHeader
        title={(booking as any).booking_no ?? '예약 상세'}
        subtitle={(booking as any).package_title ?? ''}
        showBack
        backHref="/m/admin/bookings"
        rightSlot={<MobileStatusBadge status={(booking as any).status} size="md" />}
      />
      <main className="px-4 py-4 space-y-4 pb-24">
        <section className="bg-white border border-slate-200 rounded-2xl px-4 py-4">
          <ProgressBar status={(booking as any).status} />
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl px-4 py-3 space-y-2">
          <h3 className="text-xs font-semibold text-slate-500">고객</h3>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {customer?.name ?? '예약자 미지정'}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                성인 {(booking as any).adult_count ?? 0}명 · 아동{' '}
                {(booking as any).child_count ?? 0}명
              </div>
            </div>
            {customer?.phone && (
              <a
                href={`tel:${customer.phone.replace(/-/g, '')}`}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-medium active:scale-95"
              >
                <Phone size={14} />
                전화
              </a>
            )}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl px-4 py-3 space-y-2">
          <h3 className="text-xs font-semibold text-slate-500">일정</h3>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">출발일</span>
            <span className="font-semibold text-slate-900">
              {fmtDate((booking as any).departure_date ?? undefined) || '미정'}
            </span>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl px-4 py-3 space-y-2">
          <h3 className="text-xs font-semibold text-slate-500">금액</h3>
          <dl className="text-sm divide-y divide-slate-100">
            <div className="flex justify-between py-1.5">
              <dt className="text-slate-600">판매가</dt>
              <dd className="font-semibold tabular-nums">
                {fmtK((booking as any).total_price ?? 0)}
              </dd>
            </div>
            <div className="flex justify-between py-1.5">
              <dt className="text-slate-600">원가</dt>
              <dd className="tabular-nums text-slate-500">
                {fmtK((booking as any).total_cost ?? 0)}
              </dd>
            </div>
            <div className="flex justify-between py-1.5">
              <dt className="text-slate-600">입금액</dt>
              <dd className="tabular-nums text-emerald-600 font-medium">
                {fmtK((booking as any).paid_amount ?? 0)}
              </dd>
            </div>
            <div className="flex justify-between py-1.5">
              <dt className="text-slate-600">미수금</dt>
              <dd
                className={`tabular-nums font-semibold ${
                  balance > 0 ? 'text-rose-600' : 'text-slate-500'
                }`}
              >
                {fmtK(balance)}
              </dd>
            </div>
            <div className="flex justify-between py-1.5">
              <dt className="text-slate-600">마진</dt>
              <dd
                className={`tabular-nums font-semibold ${
                  margin >= 0 ? 'text-slate-900' : 'text-rose-600'
                }`}
              >
                {fmtK(margin)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-500">최근 이벤트</h3>
            <Link
              href={`/m/admin/timeline/${params.id}`}
              className="text-[11px] text-slate-500 underline underline-offset-2"
            >
              전체 보기
            </Link>
          </div>
          {logs.length === 0 ? (
            <div className="text-xs text-slate-400 py-2">기록 없음</div>
          ) : (
            <ul className="space-y-2">
              {logs.map((log: any) => (
                <li
                  key={log.id as string}
                  className="text-xs border-l-2 border-slate-200 pl-3 py-0.5"
                >
                  <div className="font-medium text-slate-700">{log.title as string}</div>
                  <div className="text-slate-400 mt-0.5">
                    {log.created_at
                      ? new Date(log.created_at as string).toLocaleString('ko-KR', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {((booking as any).memo || (booking as any).special_requests) && (
          <section className="bg-white border border-slate-200 rounded-2xl px-4 py-3 space-y-2">
            <h3 className="text-xs font-semibold text-slate-500">메모</h3>
            {(booking as any).memo && (
              <p className="text-xs text-slate-700 whitespace-pre-wrap">
                {(booking as any).memo}
              </p>
            )}
            {(booking as any).special_requests && (
              <p className="text-xs text-slate-500 whitespace-pre-wrap">
                요청: {(booking as any).special_requests}
              </p>
            )}
          </section>
        )}
      </main>

      <BookingActions
        bookingId={params.id}
        status={(booking as any).status}
        transitions={transitions}
      />
    </>
  );
}
