const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function bounded(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.floor(value!)))
    : fallback;
}

export interface BlogGscCollectionPlanV3 {
  latestAvailableDate: string;
  windowStartDate: string;
  catchupDates: string[];
  backfillDates: string[];
  requestedDates: string[];
  backfillComplete: boolean;
  nextBackfillEndDate: string | null;
}

export function readBlogGscBackfillCursorV3(rows: readonly unknown[]): string | null {
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const summary = (raw as Record<string, unknown>).summary;
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) continue;
    const collection = (summary as Record<string, unknown>).gsc_collection;
    if (!collection || typeof collection !== 'object' || Array.isArray(collection)) continue;
    const cursor = (collection as Record<string, unknown>).nextBackfillEndDate;
    if (cursor === null) return null;
    if (typeof cursor === 'string' && ISO_DATE_RE.test(cursor)) return cursor;
  }
  return null;
}

export function buildBlogGscCollectionPlanV3(input: {
  now?: Date;
  catchupDays?: number;
  backfillDays?: number;
  backfillChunkDays?: number;
  previousBackfillEndDate?: string | null;
  hasPreviousState?: boolean;
} = {}): BlogGscCollectionPlanV3 {
  const now = input.now ?? new Date();
  const catchupDays = bounded(input.catchupDays, 7, 1, 7);
  const backfillDays = bounded(input.backfillDays, 90, 7, 90);
  const backfillChunkDays = bounded(input.backfillChunkDays, 7, 1, 7);
  const latest = new Date(now);
  latest.setUTCDate(latest.getUTCDate() - 2);
  const latestAvailableDate = isoDate(latest);
  const windowStartDate = shiftDate(latestAvailableDate, -(backfillDays - 1));
  const catchupStart = shiftDate(latestAvailableDate, -(catchupDays - 1));
  const catchupDates = Array.from({ length: catchupDays }, (_, index) => shiftDate(catchupStart, index));

  let backfillEndDate: string | null;
  if (input.hasPreviousState) {
    backfillEndDate = input.previousBackfillEndDate ?? null;
  } else {
    backfillEndDate = shiftDate(catchupStart, -1);
  }
  if (backfillEndDate && backfillEndDate < windowStartDate) backfillEndDate = null;

  const backfillDates: string[] = [];
  if (backfillEndDate) {
    for (let index = backfillChunkDays - 1; index >= 0; index -= 1) {
      const candidate = shiftDate(backfillEndDate, -index);
      if (candidate >= windowStartDate && candidate < catchupStart) backfillDates.push(candidate);
    }
  }
  const nextBackfillEndDate = backfillDates.length > 0
    ? (shiftDate(backfillDates[0]!, -1) >= windowStartDate ? shiftDate(backfillDates[0]!, -1) : null)
    : null;
  return {
    latestAvailableDate,
    windowStartDate,
    catchupDates,
    backfillDates,
    requestedDates: [...new Set([...catchupDates, ...backfillDates])].sort(),
    backfillComplete: backfillDates.length === 0,
    nextBackfillEndDate,
  };
}
