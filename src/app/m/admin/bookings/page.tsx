import { MobileHeader } from '@/components/admin/mobile/MobileHeader';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import BookingsClient from './_client';
import {
  parseSort,
  SORT_LABELS,
  type MobileBookingRow,
  type SortMode,
} from './_types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const STATUS_TABS = [
  { key: 'all', label: '전체', filter: null as string | null },
  { key: 'pending', label: '대기', filter: 'pending' },
  { key: 'waiting_deposit', label: '계약금', filter: 'waiting_deposit' },
  { key: 'waiting_balance', label: '잔금', filter: 'waiting_balance' },
  { key: 'fully_paid', label: '완납', filter: 'fully_paid' },
  { key: 'cancelled', label: '취소', filter: 'cancelled' },
];

async function fetchBookings(opts: {
  status?: string;
  departureToday?: boolean;
  sort: SortMode;
}): Promise<MobileBookingRow[]> {
  if (!isSupabaseConfigured) return [];

  let query = supabaseAdmin
    .from('bookings')
    .select(
      'id, booking_no, status, package_title, departure_date, total_price, paid_amount, created_at, customers!lead_customer_id(name)'
    )
    .or('is_deleted.is.null,is_deleted.eq.false')
    .limit(200);

  if (opts.sort === 'dep_asc') {
    query = query.order('departure_date', { ascending: true, nullsFirst: false });
  } else if (opts.sort === 'dep_desc') {
    query = query.order('departure_date', { ascending: false, nullsFirst: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  if (opts.status) query = query.eq('status', opts.status);
  if (opts.departureToday) {
    const today = new Date().toISOString().slice(0, 10);
    query = query.eq('departure_date', today);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((row: any) => ({
    id: row.id,
    booking_no: row.booking_no,
    status: row.status,
    package_title: row.package_title,
    departure_date: row.departure_date,
    total_price: row.total_price,
    paid_amount: row.paid_amount,
    customer_name: row.customers?.name ?? null,
    created_at: row.created_at,
  }));
}

export default async function MobileBookingsPage({
  searchParams,
}: {
  searchParams: { tab?: string; departure?: string; sort?: string };
}) {
  const tab = searchParams.tab ?? 'all';
  const activeTab = STATUS_TABS.find(t => t.key === tab) ?? STATUS_TABS[0];
  const departureToday = searchParams.departure === 'today';
  const sort = parseSort(searchParams.sort);

  const initialRows = await fetchBookings({
    status: activeTab.filter ?? undefined,
    departureToday,
    sort,
  });

  return (
    <>
      <MobileHeader
        title="예약 관리"
        subtitle={
          departureToday
            ? '오늘 출발'
            : activeTab.key === 'all'
            ? `${SORT_LABELS[sort]} · 최근 200건`
            : `${activeTab.label} · ${SORT_LABELS[sort]}`
        }
      />
      <div
        className="sticky z-30 bg-slate-50 border-b border-slate-200"
        style={{ top: 'calc(3.5rem + env(safe-area-inset-top))' }}
      >
        <nav className="px-3 py-2 overflow-x-auto">
          <ul className="flex gap-1.5 min-w-max">
            {STATUS_TABS.map(t => {
              const active = t.key === activeTab.key;
              const query = new URLSearchParams();
              if (t.key !== 'all') query.set('tab', t.key);
              if (departureToday) query.set('departure', 'today');
              if (sort !== 'recent') query.set('sort', sort);
              const qs = query.toString();
              return (
                <li key={t.key}>
                  <a
                    href={`/m/admin/bookings${qs ? '?' + qs : ''}`}
                    className={`inline-block text-xs font-medium px-3 py-1.5 rounded-full transition ${
                      active
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-600 border border-slate-200'
                    }`}
                  >
                    {t.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      <BookingsClient
        initialRows={initialRows}
        sort={sort}
        tab={activeTab.key}
        departureToday={departureToday}
      />
    </>
  );
}
