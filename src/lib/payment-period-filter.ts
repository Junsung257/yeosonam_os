export type PaymentPeriodFilter = '이번 달' | '지난 달' | '3개월' | '전체';

const KST_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function kstDateKey(date: Date): string {
  const parts = KST_DATE_FORMATTER.formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function shiftMonth(monthKey: string, offset: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function matchesPaymentPeriod(
  value: string | null | undefined,
  filter: PaymentPeriodFilter,
  now = new Date(),
): boolean {
  if (filter === '전체') return true;
  if (!value) return false;
  const dateOnlyMatch = /^(\d{4}-\d{2}-\d{2})$/.exec(value);
  const parsed = dateOnlyMatch ? null : new Date(value);
  if (!dateOnlyMatch && Number.isNaN(parsed?.getTime())) return false;

  const dateKey = dateOnlyMatch?.[1] ?? kstDateKey(parsed as Date);
  const currentMonth = kstDateKey(now).slice(0, 7);
  let from = currentMonth;
  const to = shiftMonth(currentMonth, 1);

  if (filter === '지난 달') {
    from = shiftMonth(currentMonth, -1);
    return dateKey >= `${from}-01` && dateKey < `${currentMonth}-01`;
  } else if (filter === '3개월') {
    from = shiftMonth(currentMonth, -2);
  }

  return dateKey >= `${from}-01` && dateKey < `${to}-01`;
}
