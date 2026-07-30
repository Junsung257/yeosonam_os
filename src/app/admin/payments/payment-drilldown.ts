export const PAYMENT_TABS = ['outstanding', 'review', 'matched', 'unmatched', 'outflow'] as const;

export type PaymentTab = (typeof PAYMENT_TABS)[number];

export const PAYMENT_DATE_FILTERS = ['이번 달', '지난 달', '3개월', '전체'] as const;
export type PaymentDateFilter = (typeof PAYMENT_DATE_FILTERS)[number];

export function parsePaymentTab(searchParams: Pick<URLSearchParams, 'get'>): PaymentTab {
  const filter = searchParams.get('filter');
  if (filter === 'outstanding') return 'outstanding';
  if (filter === 'unmatched') return 'unmatched';

  const tab = searchParams.get('tab');
  return PAYMENT_TABS.includes(tab as PaymentTab) ? tab as PaymentTab : 'review';
}

export function paymentTabHref(
  pathname: string,
  searchParams: Pick<URLSearchParams, 'toString'>,
  tab: PaymentTab,
): string {
  const next = new URLSearchParams(searchParams.toString());
  next.delete('filter');
  next.delete('tx');
  next.delete('booking');
  next.set('tab', tab);
  return `${pathname}?${next.toString()}`;
}

export function transactionMatchesDateFilter(
  receivedAt: string,
  filter: PaymentDateFilter,
  now = new Date(),
): boolean {
  if (filter === '전체') return true;
  const received = new Date(receivedAt);
  if (Number.isNaN(received.getTime())) return false;

  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  if (filter === '이번 달') return received >= currentMonthStart;

  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  if (filter === '지난 달') return received >= previousMonthStart && received < currentMonthStart;

  const threeMonthStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  return received >= threeMonthStart;
}
