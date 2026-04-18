import { MobileHeader } from '@/components/admin/mobile/MobileHeader';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import PaymentsClient from './_client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export interface MobilePaymentRow {
  id: string;
  transaction_type: string;
  amount: number;
  counterparty_name: string | null;
  received_at: string | null;
  match_status: string;
  match_confidence: number | null;
  memo: string | null;
  matched_booking: null | {
    id: string;
    booking_no: string | null;
    customer_name: string | null;
    package_title: string | null;
  };
}

const TABS = [
  { key: 'review', label: '검토', filter: ['review'] },
  { key: 'unmatched', label: '미매칭', filter: ['unmatched'] },
  { key: 'auto', label: '자동', filter: ['auto', 'manual'] },
  { key: 'all', label: '전체', filter: null as string[] | null },
];

async function fetchTransactions(match: string[] | null): Promise<MobilePaymentRow[]> {
  if (!isSupabaseConfigured) return [];
  let query = supabaseAdmin
    .from('bank_transactions')
    .select(
      'id, transaction_type, amount, counterparty_name, received_at, match_status, match_confidence, memo, bookings!booking_id(id, booking_no, package_title, customers!lead_customer_id(name))'
    )
    .eq('transaction_type', '입금')
    .neq('status', 'excluded')
    .order('received_at', { ascending: false })
    .limit(80);

  if (match && match.length > 0) query = query.in('match_status', match);

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((row: any) => ({
    id: row.id,
    transaction_type: row.transaction_type,
    amount: row.amount,
    counterparty_name: row.counterparty_name,
    received_at: row.received_at,
    match_status: row.match_status,
    match_confidence: row.match_confidence,
    memo: row.memo,
    matched_booking: row.bookings
      ? {
          id: row.bookings.id,
          booking_no: row.bookings.booking_no,
          customer_name: row.bookings.customers?.name ?? null,
          package_title: row.bookings.package_title,
        }
      : null,
  }));
}

export default async function MobilePaymentsPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const tab = searchParams.tab ?? 'review';
  const activeTab = TABS.find(t => t.key === tab) ?? TABS[0];
  const rows = await fetchTransactions(activeTab.filter);

  return (
    <>
      <MobileHeader
        title="입금 매칭"
        subtitle={`${activeTab.label} · 최근 80건`}
      />
      <div
        className="sticky z-30 bg-slate-50 border-b border-slate-200"
        style={{ top: 'calc(3.5rem + env(safe-area-inset-top))' }}
      >
        <nav className="px-3 py-2 overflow-x-auto">
          <ul className="flex gap-1.5">
            {TABS.map(t => {
              const active = t.key === activeTab.key;
              return (
                <li key={t.key}>
                  <a
                    href={`/m/admin/payments?tab=${t.key}`}
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
      <PaymentsClient rows={rows} />
    </>
  );
}
