import Link from 'next/link';
import {
  Building2,
  Calendar,
  Banknote,
  ListChecks,
  Receipt,
  Wallet,
} from 'lucide-react';

import FinanceBookingsTable from '@/components/admin/finance/FinanceBookingsTable';
import FinanceClassifications from '@/components/admin/finance/FinanceClassifications';
import FinanceCenterHome from '@/components/admin/finance/FinanceCenterHome';
import FinancePeriods from '@/components/admin/finance/FinancePeriods';
import FinanceTransactionReview from '@/components/admin/finance/FinanceTransactionReview';
import TaxPage from '@/app/admin/tax/page';

export const dynamic = 'force-dynamic';

const TABS = [
  { id: 'home', label: '정산 홈', icon: Banknote },
  { id: 'review', label: '거래 검토', icon: ListChecks },
  { id: 'bookings', label: '예약별 정산', icon: Wallet },
  { id: 'periods', label: '월 마감', icon: Calendar },
  { id: 'expenses', label: '회사 경비', icon: Building2 },
  { id: 'tax', label: '세금·증빙', icon: Receipt },
] as const;

type FinanceTab = typeof TABS[number]['id'];

function isFinanceTab(value: string | undefined): value is FinanceTab {
  return TABS.some(tab => tab.id === value);
}

export default async function FinanceCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const activeTab: FinanceTab = isFinanceTab(params.tab) ? params.tab : 'home';

  return (
    <div className="space-y-5">
      <header className="relative overflow-hidden rounded-admin-lg border border-slate-200 bg-[linear-gradient(120deg,#f7faf7_0%,#ffffff_48%,#f4f8fb_100%)] px-5 py-5 shadow-admin-xs sm:px-7">
        <div className="absolute -right-12 -top-16 h-44 w-44 rounded-full border-[26px] border-emerald-100/50" aria-hidden="true" />
        <div className="relative flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Finance control room</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">정산센터</h1>
            <p className="mt-1 text-sm text-slate-600">신한 4128 통장부터 예약 마진, 회사 경비, 월 잠금까지 한 흐름으로 관리합니다.</p>
          </div>
          <div className="text-xs text-slate-500">기준 시간은 모두 한국시간(KST)</div>
        </div>
      </header>

      <nav aria-label="정산센터 메뉴" className="overflow-x-auto rounded-admin-md border border-admin-border-mid bg-admin-surface p-1 shadow-admin-xs">
        <div className="flex min-w-max gap-1">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <Link
                key={tab.id}
                href={`/admin/finance?tab=${tab.id}`}
                aria-current={selected ? 'page' : undefined}
                className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors ${
                  selected
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-admin-muted hover:bg-admin-bg hover:text-admin-text-2'
                }`}
              >
                <Icon className="h-4 w-4" /> {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {activeTab === 'home' ? <FinanceCenterHome /> : null}
      {activeTab === 'review' ? <FinanceTransactionReview /> : null}
      {activeTab === 'bookings' ? <FinanceBookingsTable /> : null}
      {activeTab === 'periods' ? <FinancePeriods /> : null}
      {activeTab === 'expenses' ? <FinanceClassifications /> : null}
      {activeTab === 'tax' ? (
        <div className="space-y-4">
          <div className="flex justify-end gap-2">
            <Link href="/admin/invoice" className="rounded-lg border border-admin-border-strong bg-white px-3 py-2 text-xs font-semibold text-admin-text-2 hover:bg-admin-bg">증빙 파일 파싱</Link>
          </div>
          <TaxPage />
        </div>
      ) : null}
    </div>
  );
}
