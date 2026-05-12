/**
 * 게스트 예약 조회 페이지 — `/m/booking/[id]`.
 *
 * 동작:
 *   1. magic-session 쿠키 검증 (POST-confirm 후 발급된 것)
 *   2. URL bookingId 와 쿠키의 bid 일치 확인 (defense in depth)
 *   3. booking 요약 + 일정 + 상태 카드 표시
 *   4. "자비스에게 물어보기" 버튼으로 /m/chat/[token] 진입
 *
 * RLS 우회: supabaseAdmin 사용 (service_role). 페이지 자체가 magic-session 으로 인증됨.
 */

import { cookies } from 'next/headers';
import { MAGIC_SESSION_COOKIE, verifyMagicSessionToken } from '@/lib/magic-session';
import { supabaseAdmin } from '@/lib/supabase';
import JarvisSidekick from '@/components/jarvis/JarvisSidekick';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: '내 예약 정보',
  robots: { index: false, follow: false },
};

type PageParams = { params: Promise<{ id: string }> };

interface BookingRow {
  id: string;
  booking_no: string | null;
  destination: string | null;
  departure_date: string | null;
  return_date: string | null;
  status: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  total_amount: number | null;
  paid_amount: number | null;
  itinerary_data: unknown;
  customers?: { name?: string | null } | null;
}

export default async function GuestBookingPage({ params }: PageParams) {
  const { id: bookingIdFromUrl } = await params;

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(MAGIC_SESSION_COOKIE)?.value;
  const session = verifyMagicSessionToken(sessionCookie);

  if (!session.ok) return <AccessError reason="session_required" />;
  if (session.payload.bid !== bookingIdFromUrl) return <AccessError reason="mismatch" />;
  if (!session.payload.scope.includes('booking:read')) {
    return <AccessError reason="no_scope" />;
  }

  const { data } = await supabaseAdmin
    .from('bookings')
    .select(
      'id, booking_no, destination, departure_date, return_date, status, adults, children, infants, total_amount, paid_amount, itinerary_data, customers:lead_customer_id(name)',
    )
    .eq('id', bookingIdFromUrl)
    .limit(1);
  const booking = (data?.[0] as BookingRow | undefined) ?? null;

  if (!booking) return <AccessError reason="not_found" />;

  return (
    <main className="min-h-screen bg-gray-50 pb-24">
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="text-xs text-gray-500 mb-1">예약번호</div>
        <div className="text-lg font-bold text-gray-900">{booking.booking_no ?? '—'}</div>
      </header>

      <section className="bg-white mt-2 px-4 py-5">
        <div className="text-xs text-gray-500 mb-1">여행지</div>
        <div className="text-xl font-bold text-gray-900 mb-3">{booking.destination ?? '—'}</div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <Field label="출발일" value={formatDate(booking.departure_date)} />
          <Field label="귀국일" value={formatDate(booking.return_date)} />
          <Field label="인원" value={formatPax(booking)} />
          <Field label="예약 상태" value={<StatusBadge status={booking.status} />} />
        </div>
      </section>

      <section className="bg-white mt-2 px-4 py-5">
        <div className="text-xs text-gray-500 mb-2">결제 현황</div>
        <div className="text-sm text-gray-900 mb-1">
          총 금액 <span className="font-semibold ml-2">{formatKRW(booking.total_amount)}</span>
        </div>
        <div className="text-sm text-gray-600">
          입금 완료 <span className="font-medium ml-2">{formatKRW(booking.paid_amount)}</span>
        </div>
        {(booking.total_amount ?? 0) > (booking.paid_amount ?? 0) && (
          <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5 leading-relaxed">
            잔금 안내가 발송되면 별도 결제 링크로 진행 부탁드려요.
          </div>
        )}
      </section>

      <ItineraryBlock data={booking.itinerary_data} />

      {/* 자비스 사이드킥 — Booking.com Smart Messenger / Trip.com TripGenie 패턴 */}
      <JarvisSidekick
        context={{
          bookingNo: booking.booking_no,
          bookingDestination: booking.destination,
          bookingDepartureDate: booking.departure_date,
          customerName: booking.customers?.name ?? null,
          actionLabel: '예약 정보 상담',
          actionType: 'booking_portal',
        }}
        quickReplies={['일정 자료 다시 받기', '준비물 알려줘', '환불·변경 가능한가요']}
      />
    </main>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-medium text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const label = STATUS_LABELS[status ?? ''] ?? status ?? '—';
  return (
    <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
      {label}
    </span>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending: '확정 대기',
  waiting_deposit: '예약금 안내',
  deposit_paid: '예약금 완료',
  confirmed: '예약 확정',
  balance_paid: '잔금 완료',
  traveling: '여행 중',
  completed: '여행 완료',
  cancelled: '취소',
};

function ItineraryBlock({ data }: { data: unknown }) {
  const days = extractDays(data);
  if (!days.length) return null;

  return (
    <section className="bg-white mt-2 px-4 py-5">
      <div className="text-xs text-gray-500 mb-3">여행 일정</div>
      <ol className="space-y-3">
        {days.map((d, i) => (
          <li key={i} className="border-l-2 border-gray-200 pl-3">
            <div className="text-sm font-semibold text-gray-900">{i + 1}일차</div>
            {d.title && <div className="text-sm text-gray-700 mt-0.5">{d.title}</div>}
            {d.schedule && <div className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{d.schedule}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function extractDays(data: unknown): { title?: string; schedule?: string }[] {
  if (!data || typeof data !== 'object') return [];
  const obj = data as { days?: unknown; itinerary?: unknown };
  const raw = (obj.days ?? obj.itinerary ?? []) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 30).map((d) => {
    if (typeof d === 'string') return { schedule: d };
    if (d && typeof d === 'object') {
      const r = d as Record<string, unknown>;
      return {
        title: typeof r.title === 'string' ? r.title : typeof r.name === 'string' ? r.name : undefined,
        schedule:
          typeof r.schedule === 'string'
            ? r.schedule
            : typeof r.activities === 'string'
              ? r.activities
              : Array.isArray(r.activities)
                ? r.activities.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join('\n')
                : undefined,
      };
    }
    return {};
  });
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    const parsed = new Date(d);
    if (isNaN(parsed.getTime())) return d;
    return parsed.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  } catch {
    return d;
  }
}

function formatKRW(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return `${n.toLocaleString('ko-KR')}원`;
}

function formatPax(b: BookingRow): string {
  const parts: string[] = [];
  if (b.adults) parts.push(`성인 ${b.adults}명`);
  if (b.children) parts.push(`아동 ${b.children}명`);
  if (b.infants) parts.push(`유아 ${b.infants}명`);
  return parts.join(' · ') || '—';
}

function AccessError({ reason }: { reason: 'session_required' | 'mismatch' | 'no_scope' | 'not_found' }) {
  const messages: Record<typeof reason, { title: string; body: string }> = {
    session_required: {
      title: '안내 페이지 접근',
      body: '안내 메시지의 링크를 직접 눌러 다시 들어와 주세요.',
    },
    mismatch: {
      title: '잘못된 접근',
      body: '다른 예약의 링크로 들어오신 것 같아요. 받으신 링크를 다시 확인해 주세요.',
    },
    no_scope: {
      title: '조회 권한 없음',
      body: '이 링크로는 예약 정보를 볼 수 없어요. 담당자에게 문의해 주세요.',
    },
    not_found: {
      title: '예약을 찾을 수 없어요',
      body: '예약 정보가 변경되었거나 삭제되었을 수 있어요. 담당자에게 문의해 주세요.',
    },
  };
  const m = messages[reason];
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8 text-center">
        <div className="mb-2 text-sm font-medium text-gray-500">여소남</div>
        <h1 className="text-xl font-bold text-gray-900 mb-3">{m.title}</h1>
        <p className="text-sm text-gray-600 leading-relaxed">{m.body}</p>
      </div>
    </main>
  );
}
