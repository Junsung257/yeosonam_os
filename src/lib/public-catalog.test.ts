import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { getPublicCatalogDetail, listPublicCatalog } from './public-catalog';
import { PUBLIC_CATALOG_EGRESS_SURFACES } from './public-catalog-egress';

function queryResult(rows: unknown[]) {
  const result = Promise.resolve({ data: rows, error: null });
  const query = {
    select: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    ilike: vi.fn(),
    in: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    then: result.then.bind(result),
  };
  for (const method of ['select', 'order', 'limit', 'ilike', 'in', 'eq'] as const) {
    query[method].mockReturnValue(query);
  }
  query.maybeSingle.mockResolvedValue({ data: rows[0] ?? null, error: null });
  return query;
}

const row = {
  tenant_id: '00000000-0000-4000-8000-000000000000',
  id: '00000000-0000-4000-8000-000000000001',
  catalog_product_id: '00000000-0000-4000-8000-000000000002',
  slug: 'danang-four-days',
  product_kind: 'package',
  title: '부산 출발 다낭 3박 4일',
  destination: '다낭',
  country: '베트남',
  departure_airport: '김해국제공항',
  duration: 4,
  nights: 3,
  price: 899000,
  price_display: '899,000원부터',
  hero_image: 'https://example.com/danang.jpg',
  badges: ['가격 확인'],
  available_dates: [{ date: '2099-09-01', price: 899000, confirmed: true }],
  booking_mode: 'inquiry',
  last_verified_at: '2026-08-24T00:00:00.000Z',
  snapshot_id: '00000000-0000-4000-8000-000000000003',
  snapshot_hash: 'a'.repeat(64),
  revision_id: '00000000-0000-4000-8000-000000000004',
  pointer_version: 4,
  public_detail: { package: { id: '00000000-0000-4000-8000-000000000001', title: '부산 출발 다낭 3박 4일' } },
};

describe('public catalog', () => {
  it('normalizes the public list DTO without returning internal snapshot fields', async () => {
    const query = queryResult([row]);
    const supabase = { from: vi.fn(() => query) };
    const items = await listPublicCatalog(supabase as never, { limit: 12 });
    expect(items).toEqual([expect.objectContaining({
      id: row.id,
      title: row.title,
      bookingMode: 'inquiry',
      availableDates: [{ date: '2099-09-01', price: 899000, confirmed: true }],
    })]);
    expect(items[0]).not.toHaveProperty('snapshotHash');
    expect(items[0]).not.toHaveProperty('catalogProductId');
  });

  it('returns only the exact customer snapshot for detail rendering', async () => {
    const query = queryResult([row]);
    const supabase = { from: vi.fn(() => query) };
    const detail = await getPublicCatalogDetail(supabase as never, row.id);
    expect(detail?.package).toEqual(row.public_detail.package);
    expect(detail?.lineage.snapshotHash).toBe(row.snapshot_hash);
  });

  it('bounds arbitrary downstream candidates to exact public catalog ids', async () => {
    const query = queryResult([row]);
    const supabase = { from: vi.fn(() => query) };
    const items = await listPublicCatalog(supabase as never, {
      ids: [row.id, row.id, '  '],
      limit: 20,
    });
    expect(query.in).toHaveBeenCalledWith('id', [row.id]);
    expect(items.map((item) => item.id)).toEqual([row.id]);
  });

  it('does not interpolate an untrusted route ref into a PostgREST or filter', async () => {
    const query = queryResult([]);
    const supabase = { from: vi.fn(() => query) };
    await getPublicCatalogDetail(supabase as never, 'slug,marketing_eligible.eq.false');
    expect(query.eq).toHaveBeenCalledWith('id', 'slug,marketing_eligible.eq.false');
    expect(query.eq).toHaveBeenCalledWith('slug', 'slug,marketing_eligible.eq.false');
  });

  it('keeps every registered customer egress on the exact public catalog boundary', () => {
    const ids = new Set<string>();
    for (const surface of PUBLIC_CATALOG_EGRESS_SURFACES) {
      expect(ids.has(surface.id), `duplicate egress id: ${surface.id}`).toBe(false);
      ids.add(surface.id);
      const source = readFileSync(join(process.cwd(), surface.source), 'utf8');
      expect(source, surface.source).toContain(surface.requiredMarker);
    }
  });
});
