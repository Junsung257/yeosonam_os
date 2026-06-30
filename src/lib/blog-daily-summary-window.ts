export const DAILY_SUMMARY_CLOSE_MINUTE_KST = (22 * 60) + 12;

export function getKstDayRange(offsetDays = 0, now = new Date()): { start: Date; end: Date; dayKey: string } {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(kst.getUTCDate() + offsetDays);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth();
  const date = kst.getUTCDate();
  const start = new Date(Date.UTC(year, month, date, -9, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, date + 1, -9, 0, 0, 0));
  return {
    start,
    end,
    dayKey: `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`,
  };
}

export function getClosedKstDailySummaryRange(now = new Date()): {
  start: Date;
  end: Date;
  dayKey: string;
  closed: boolean;
  usedPreviousDay: boolean;
  closeMinuteKst: number;
} {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const minuteOfDay = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const usedPreviousDay = minuteOfDay < DAILY_SUMMARY_CLOSE_MINUTE_KST;
  return {
    ...getKstDayRange(usedPreviousDay ? -1 : 0, now),
    closed: true,
    usedPreviousDay,
    closeMinuteKst: DAILY_SUMMARY_CLOSE_MINUTE_KST,
  };
}
