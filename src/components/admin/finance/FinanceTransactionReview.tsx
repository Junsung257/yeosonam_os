'use client';

import dynamic from 'next/dynamic';

const PaymentsPageClient = dynamic(
  () => import('@/app/admin/payments/PaymentsPageClient'),
  {
    ssr: false,
    loading: () => (
      <div className="h-96 animate-pulse rounded-admin-md border border-admin-border-mid bg-admin-surface-2" role="status" aria-label="Clobe 거래 검토 불러오는 중" />
    ),
  },
);

export default function FinanceTransactionReview({
  focusMode = false,
  initialQueue,
  closeMonth,
}: {
  focusMode?: boolean;
  initialQueue?: string;
  closeMonth?: string;
}) {
  return <PaymentsPageClient focusMode={focusMode} initialQueue={initialQueue} closeMonth={closeMonth} />;
}
