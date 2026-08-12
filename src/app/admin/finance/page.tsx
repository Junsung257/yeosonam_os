import Link from 'next/link';
import {
  ArrowLeft,
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
import FinancePrivacyBoundary from '@/components/admin/finance/FinancePrivacyBoundary';
import FinanceTaxPanel from '@/components/admin/finance/FinanceTaxPanel';
import FinanceTodayWorkbench from '@/components/admin/finance/FinanceTodayWorkbench';
import FinanceTransactionReview from '@/components/admin/finance/FinanceTransactionReview';
import { isFinanceYearMonth } from '@/lib/finance-tax-months';
import { formatKstDate } from '@/lib/kst-date';

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
  searchParams: Promise<{ tab?: string; month?: string; q?: string; view?: string; focus?: string; return?: string }>;
}) {
  const params = await searchParams;
  const activeTab: FinanceTab = isFinanceTab(params.tab) ? params.tab : 'home';
  const taxMonth = isFinanceYearMonth(params.month) ? params.month : formatKstDate().slice(0, 7);

  return (
    <FinancePrivacyBoundary>
    <div className="space-y-4 sm:space-y-5">
      <header className="relative overflow-hidden rounded-admin-lg border border-slate-200 bg-[linear-gradient(120deg,#f7faf7_0%,#ffffff_48%,#f4f8fb_100%)] px-4 py-4 shadow-admin-xs sm:px-7 sm:py-5">
        <div className="absolute -right-12 -top-20 hidden h-44 w-44 rounded-full border-[26px] border-emerald-100/50 sm:block" aria-hidden="true" />
        <div className="relative flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="hidden text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 sm:block">Finance control room</p>
            <h1 className="text-xl font-bold tracking-tight text-slate-950 sm:mt-1 sm:text-2xl">정산센터</h1>
            <p className="mt-1 text-xs text-slate-600 sm:text-sm">Clobe 통장부터 예약 수익과 월 마감까지 한 흐름으로 확인합니다.</p>
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
                className={`inline-flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-medium transition-colors sm:gap-2 sm:px-3.5 sm:text-sm ${
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

      {params.return === 'today' && activeTab !== 'home' ? (
        <div className="flex justify-start">
          <Link href="/admin/finance" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" /> 오늘 정산으로 돌아가기
          </Link>
        </div>
      ) : null}

      {activeTab === 'home' ? (params.view === 'overview' ? <FinanceCenterHome /> : <FinanceTodayWorkbench />) : null}
      {activeTab === 'review' ? <FinanceTransactionReview /> : null}
      {activeTab === 'bookings' ? <FinanceBookingsTable initialMonth={params.month} initialQuery={params.q} initialFocus={params.focus} returnToToday={params.return === 'today'} /> : null}
      {activeTab === 'periods' ? <FinancePeriods initialMonth={params.month} /> : null}
      {activeTab === 'expenses' ? <FinanceClassifications /> : null}
      {activeTab === 'tax' ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-admin-md border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-950 sm:flex-row sm:items-center sm:justify-between">
            <p><strong>수치 기준 안내</strong> 아래 예상 수익은 예약 판매가와 예정 원가 기준입니다. 실제 확정 수익은 정산 홈·월 마감의 Clobe 현금 마진을 기준으로 확인합니다.</p>
            <Link href="/admin/invoice" className="rounded-lg border border-admin-border-strong bg-white px-3 py-2 text-xs font-semibold text-admin-text-2 hover:bg-admin-bg">증빙 파일 파싱</Link>
          </div>
          <FinanceTaxPanel initialMonth={taxMonth} />
        </div>
      ) : null}
    </div>
    </FinancePrivacyBoundary>
  );
}
