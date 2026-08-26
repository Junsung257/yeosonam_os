const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function isoDateUtcMs(value: string | null | undefined): number | null {
  const dateKey = String(value ?? '').slice(0, 10);
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);
  const parsed = new Date(utcMs);

  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return utcMs;
}

/**
 * A server-pinned instant converted to the Korea business calendar.
 * UTC getters are deliberate: the +09:00 shift must behave identically in
 * Vercel's UTC runtime and in an operator's browser.
 */
export function getKstDateKey(referenceNowMs: number): string {
  if (!Number.isFinite(referenceNowMs)) return '1970-01-01';
  return new Date(referenceNowMs + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Calendar-day offset from a KST reference date.
 *  0 = today, 1 = tomorrow, -7 = seven calendar days ago.
 */
export function getBookingDayOffset(
  departureDate: string | null | undefined,
  referenceDateKst: string,
): number | null {
  const departureUtcMs = isoDateUtcMs(departureDate);
  const referenceUtcMs = isoDateUtcMs(referenceDateKst);
  if (departureUtcMs === null || referenceUtcMs === null) return null;
  return Math.round((departureUtcMs - referenceUtcMs) / DAY_MS);
}

/** Stable Korean display for a YYYY-MM-DD booking date. */
export function formatBookingDateKo(value: string | null | undefined): string {
  if (!value) return '-';
  const dateKey = value.slice(0, 10);
  const utcMs = isoDateUtcMs(dateKey);
  if (utcMs === null) return dateKey;

  const date = new Date(utcMs);
  const daysKo = ['일', '월', '화', '수', '목', '금', '토'];
  return `${dateKey.slice(2)} (${daysKo[date.getUTCDay()]})`;
}
