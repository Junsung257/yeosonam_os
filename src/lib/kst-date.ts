export function formatKstDate(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10);
}

export function compareKstDate(a: string | null | undefined, b: string | null | undefined): number {
  const left = String(a ?? '');
  const right = String(b ?? '');
  if (!isValidIsoDateKst(left) || !isValidIsoDateKst(right)) return 0;
  return left.localeCompare(right);
}

export function isValidIsoDateKst(date: string | null | undefined): date is string {
  const value = String(date ?? '');
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year
    && utc.getUTCMonth() === month - 1
    && utc.getUTCDate() === day;
}

export function isUpcomingKstDate(date: string | null | undefined, today: string = formatKstDate()): boolean {
  return isValidIsoDateKst(date) && isValidIsoDateKst(today) && compareKstDate(date, today) >= 0;
}
