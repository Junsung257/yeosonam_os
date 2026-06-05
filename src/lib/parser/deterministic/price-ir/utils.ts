import type { MatrixPriceRow, PriceTier } from './types';

export function normalizeDepartureDays(value?: string | string[] | null): string[] | null {
  if (!value) return null;
  if (Array.isArray(value)) return value.filter(Boolean);
  return value
    .split(/[,，/·\s]+/)
    .map(part => part.trim())
    .filter(Boolean);
}

export function rowsToTiers(rows: MatrixPriceRow[]): PriceTier[] {
  const byKey = new Map<string, { price: number; note: string | null; dates: string[]; status: PriceTier['status'] }>();
  for (const row of rows) {
    if (!row.date || !row.adult_price || row.adult_price <= 0) continue;
    const status: PriceTier['status'] = row.status === 'soldout'
      ? 'soldout'
      : row.status === 'tentative'
        ? 'tentative'
        : 'available';
    const key = `${row.adult_price}|${row.note ?? ''}|${status}`;
    const group = byKey.get(key) ?? {
      price: row.adult_price,
      note: row.note ?? null,
      dates: [],
      status,
    };
    group.dates.push(row.date);
    byKey.set(key, group);
  }

  return [...byKey.values()].map(group => ({
    period_label: group.note ?? `${group.dates.length}일`,
    departure_dates: [...new Set(group.dates)].sort(),
    departure_day_of_week: null,
    date_range: null,
    adult_price: group.price,
    child_price: null,
    status: group.status,
    note: group.note,
  }));
}

export function tiersToRows(tiers: PriceTier[]): MatrixPriceRow[] {
  const rows: MatrixPriceRow[] = [];
  for (const tier of tiers) {
    for (const date of tier.departure_dates ?? []) {
      if (!date || !tier.adult_price || tier.adult_price <= 0) continue;
      rows.push({
        date,
        adult_price: tier.adult_price,
        child_price: tier.child_price ?? null,
        note: tier.note ?? tier.period_label ?? null,
        status: tier.status ?? 'available',
      });
    }
  }
  return rows;
}
