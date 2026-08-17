type PackageLifecycleInput = {
  price_dates?: Array<{ date?: unknown }> | null;
  price_tiers?: Array<{
    departure_dates?: unknown;
    date_range?: { end?: unknown } | null;
  }> | null;
};

function sourceDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

/**
 * Product age is not a sales fact. A package is automatically archived only
 * when every source-backed departure/date-range end is in the past. Packages
 * without trustworthy departure dates stay unchanged and must be resolved by
 * the registration/publication workflow instead of a created_at TTL.
 */
export function automaticArchiveReason(
  pkg: PackageLifecycleInput,
  today: string,
): 'all_departures_past' | null {
  const referenceDate = sourceDate(today);
  if (!referenceDate) throw new Error(`INVALID_ARCHIVE_REFERENCE_DATE:${today}`);

  const priceDates = (pkg.price_dates ?? []).flatMap(item => {
    const date = sourceDate(item?.date);
    return date ? [date] : [];
  });
  const tierDates = (pkg.price_tiers ?? []).flatMap(tier => {
    const departures = Array.isArray(tier?.departure_dates)
      ? tier.departure_dates.flatMap(value => {
          const date = sourceDate(value);
          return date ? [date] : [];
        })
      : [];
    const end = sourceDate(tier?.date_range?.end);
    return end ? [...departures, end] : departures;
  });
  const relevantDates = [...priceDates, ...tierDates];
  if (relevantDates.length === 0) return null;
  return relevantDates.every(date => date < referenceDate) ? 'all_departures_past' : null;
}
