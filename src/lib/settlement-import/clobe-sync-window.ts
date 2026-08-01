export interface ClobeSyncWindow {
  from: string;
  to: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Clobe sync date must use YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Clobe sync date is invalid');
  }
  return date;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function splitClobeSyncWindow(from: string, to: string): ClobeSyncWindow[] {
  let cursor = parseDate(from);
  const end = parseDate(to);
  if (cursor.getTime() > end.getTime()) throw new Error('Clobe sync start date must not be after end date');

  const windows: ClobeSyncWindow[] = [];
  while (cursor.getTime() <= end.getTime()) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const twoWeekEnd = new Date(cursor.getTime() + 13 * DAY_MS);
    const chunkEnd = [monthEnd, twoWeekEnd, end]
      .reduce((earliest, candidate) => candidate.getTime() < earliest.getTime() ? candidate : earliest);
    windows.push({ from: formatDate(cursor), to: formatDate(chunkEnd) });
    cursor = new Date(chunkEnd.getTime() + DAY_MS);
  }
  return windows;
}
