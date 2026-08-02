export interface ScheduledClobeSyncWindow {
  mode: 'provider_id_backfill' | 'recent';
  from: string;
  to: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function kstDateKey(value: Date): string {
  const parts = KST_DATE_FORMATTER.formatToParts(value);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export function getScheduledClobeSyncWindow(input: {
  oldestMissingReceivedAt?: string | null;
  now?: Date;
}): ScheduledClobeSyncWindow {
  const now = input.now ?? new Date();
  const today = kstDateKey(now);
  const oldest = input.oldestMissingReceivedAt
    ? new Date(input.oldestMissingReceivedAt)
    : null;

  if (oldest && !Number.isNaN(oldest.getTime())) {
    const from = kstDateKey(oldest);
    return {
      mode: 'provider_id_backfill',
      from: from > today ? today : from,
      to: addDays(from, 13) > today ? today : addDays(from, 13),
    };
  }

  return {
    mode: 'recent',
    from: addDays(today, -29),
    to: today,
  };
}
