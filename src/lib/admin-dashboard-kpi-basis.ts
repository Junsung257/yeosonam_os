/**
 * Shared date and amount rules for the /admin dashboard.
 *
 * Keep browser month selection and server-side booking queries on the same
 * Asia/Seoul calendar. SQL equivalents live in the forward-only dashboard RPC
 * migration and are covered by the dashboard KPI contract tests.
 */

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const formatUtcDate = (date: Date): string =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

export const toKstCalendar = (date: Date): Date => new Date(date.getTime() + KST_OFFSET_MS);

export const toKstDate = (date: Date): string => formatUtcDate(toKstCalendar(date));

export const kstMonthStart = (date: Date, monthOffset = 0): string => {
  const kst = toKstCalendar(date);
  return formatUtcDate(new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + monthOffset, 1)));
};

export const addCalendarDays = (date: string, days: number): string =>
  formatUtcDate(new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86400000));

export const kstMonthKeysFor = (months: number, date = new Date()): string[] => {
  const now = toKstCalendar(date);
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
};

export const getKstCurrentAndPreviousMonthKeys = (date = new Date()): {
  current: string;
  previous: string;
} => {
  const [previous, current] = kstMonthKeysFor(2, date);
  return { current, previous };
};

export const nonNegativeOutstanding = (
  totalPrice: number | null | undefined,
  paidAmount: number | null | undefined,
): number => Math.max(0, (totalPrice || 0) - (paidAmount || 0));
