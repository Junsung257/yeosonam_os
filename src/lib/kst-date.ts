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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(left) || !/^\d{4}-\d{2}-\d{2}$/.test(right)) return 0;
  return left.localeCompare(right);
}

export function isUpcomingKstDate(date: string | null | undefined, today: string = formatKstDate()): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '')) && compareKstDate(date, today) >= 0;
}
