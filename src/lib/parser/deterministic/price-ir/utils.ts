import type { MatrixPriceRow, PriceTier } from './types.ts';

export function normalizeDepartureDays(value?: string | string[] | null): string[] | null {
  if (!value) return null;
  if (Array.isArray(value)) return value.filter(Boolean);
  return value
    .split(/[,，/·\s]+/)
    .map(part => part.trim())
    .filter(Boolean);
}

export function rowsToTiers(rows: MatrixPriceRow[]): PriceTier[] {
  const byKey = new Map<string, {
    price: number;
    listPrice: number | null;
    minTravelers: number | null;
    maxTravelers: number | null;
    priceRelation: MatrixPriceRow['price_relation'];
    note: string | null;
    weekday: number | null;
    dates: string[];
    status: PriceTier['status'];
  }>();
  for (const row of rows) {
    if (!row.date || !row.adult_price || row.adult_price <= 0) continue;
    const status: PriceTier['status'] = row.status === 'soldout'
      ? 'soldout'
      : row.status === 'tentative'
        ? 'tentative'
        : 'available';
    const key = [
      row.adult_price,
      row.list_price ?? '',
      row.min_travelers ?? '',
      row.max_travelers ?? '',
      row.price_relation ?? '',
      row.note ?? '',
      row.weekday ?? '',
      status,
    ].join('|');
    const group = byKey.get(key) ?? {
      price: row.adult_price,
      listPrice: row.list_price ?? null,
      minTravelers: row.min_travelers ?? null,
      maxTravelers: row.max_travelers ?? null,
      priceRelation: row.price_relation ?? null,
      note: row.note ?? null,
      weekday: row.weekday ?? null,
      dates: [],
      status,
    };
    group.dates.push(row.date);
    byKey.set(key, group);
  }

  return [...byKey.values()].map(group => ({
    period_label: group.note ?? `${group.dates.length}일`,
    departure_dates: [...new Set(group.dates)].sort(),
    departure_day_of_week: group.weekday == null
      ? null
      : ['\uC77C', '\uC6D4', '\uD654', '\uC218', '\uBAA9', '\uAE08', '\uD1A0'][group.weekday] ?? null,
    date_range: null,
    adult_price: group.price,
    child_price: null,
    list_price: group.listPrice,
    min_travelers: group.minTravelers,
    max_travelers: group.maxTravelers,
    price_relation: group.priceRelation,
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
        weekday: tier.departure_day_of_week
          ? ({ '\uC77C': 0, '\uC6D4': 1, '\uD654': 2, '\uC218': 3, '\uBAA9': 4, '\uAE08': 5, '\uD1A0': 6 } as Record<string, number>)[tier.departure_day_of_week] ?? null
          : null,
        adult_price: tier.adult_price,
        child_price: tier.child_price ?? null,
        list_price: tier.list_price ?? null,
        min_travelers: tier.min_travelers ?? null,
        max_travelers: tier.max_travelers ?? null,
        price_relation: tier.price_relation ?? null,
        note: tier.note ?? tier.period_label ?? null,
        status: tier.status ?? 'available',
      });
    }
  }
  return rows;
}
