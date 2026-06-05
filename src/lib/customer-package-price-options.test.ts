import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCustomerPriceOptionsForDate } from './customer-package-price-options';

describe('customer package price options', () => {
  it('uses only customer selling prices for selected-date options', () => {
    expect(getCustomerPriceOptionsForDate([
      { target_date: '2026-07-01', adult_selling_price: 1_290_000, note: 'A 호텔' },
      { target_date: '2026-07-01', adult_selling_price: 1_190_000, note: 'B 호텔' },
      { target_date: '2026-07-02', adult_selling_price: 990_000, note: '다른 날짜' },
      { target_date: '2026-07-01', adult_selling_price: null, note: '원가만 있는 행' },
      { target_date: '2026-07-01', adult_selling_price: 0, note: '0원 행' },
    ], '2026-07-01')).toEqual([
      { targetDate: '2026-07-01', label: 'B 호텔', price: 1_190_000 },
      { targetDate: '2026-07-01', label: 'A 호텔', price: 1_290_000 },
    ]);
  });

  it('falls back to a neutral customer label when the row has no display note', () => {
    expect(getCustomerPriceOptionsForDate([
      { target_date: '2026-07-01', adult_selling_price: 1_290_000, note: '   ' },
    ], '2026-07-01')).toEqual([
      { targetDate: '2026-07-01', label: '요금 옵션', price: 1_290_000 },
    ]);
  });

  it('keeps the customer package detail query away from internal net prices', () => {
    const pageSource = readFileSync(join(process.cwd(), 'src/app/packages/[id]/page.tsx'), 'utf8');

    expect(pageSource).toContain(".select('target_date, adult_selling_price, note')");
    expect(pageSource).not.toContain(".select('target_date, net_price, note')");
    expect(pageSource).not.toMatch(/from\('product_prices'\)[\s\S]{0,240}\.select\([^)]*net_price/);
  });
});
