import { describe, expect, it } from 'vitest';
import { scopeQaPackagesToExplicitProduct } from './qa-product-scope';

const rows = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Phu Quoc no-option package 3 nights 5 days',
    destination: 'Phu Quoc',
    internal_code: 'PUS-ETC-PQC-05-0027',
    short_code: 'ETC-PQC-05-27',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Phu Quoc premium resort package 4 nights 6 days',
    display_title: 'Phu Quoc premium resort package 4 nights 6 days',
    destination: 'Phu Quoc',
    internal_code: 'PUS-ETC-PQC-06-0033',
    short_code: 'ETC-PQC-06-33',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Nha Trang Dalat 5-star hotel package 3 nights 5 days',
    destination: 'Nha Trang',
    internal_code: 'PUS-ETC-CXR-05-0044',
    short_code: 'ETC-CXR-05-44',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    title: 'Phu Quoc no-option package 4 nights 6 days',
    destination: 'Phu Quoc',
    internal_code: 'PUS-ETC-PQC-05-0027-2',
    short_code: 'ETC-PQC-05-27-2',
  },
];

describe('scopeQaPackagesToExplicitProduct', () => {
  it('pins context to a package link id', () => {
    const scoped = scopeQaPackagesToExplicitProduct(
      rows,
      '/packages/22222222-2222-4222-8222-222222222222 inclusion details please',
    );

    expect(scoped.mode).toBe('explicit_product');
    expect(scoped.reason).toBe('package_id_or_link');
    expect(scoped.selectedIds).toEqual(['22222222-2222-4222-8222-222222222222']);
    expect(scoped.packages).toHaveLength(1);
  });

  it('pins context to exact internal or short code mentions', () => {
    const scoped = scopeQaPackagesToExplicitProduct(rows, 'ETC-PQC-05-27 free day options?');

    expect(scoped.mode).toBe('explicit_product');
    expect(scoped.reason).toBe('product_code');
    expect(scoped.selectedIds).toEqual(['11111111-1111-4111-8111-111111111111']);
  });

  it('does not match a shorter code as a substring of a longer code', () => {
    const scoped = scopeQaPackagesToExplicitProduct(rows, 'ETC-PQC-05-27-2 departure dates?');

    expect(scoped.mode).toBe('explicit_product');
    expect(scoped.reason).toBe('product_code');
    expect(scoped.selectedIds).toEqual(['44444444-4444-4444-8444-444444444444']);
  });

  it('does not mix similar destination products when an exact title is quoted', () => {
    const scoped = scopeQaPackagesToExplicitProduct(
      rows,
      '"Phu Quoc premium resort package 4 nights 6 days" child price?',
    );

    expect(scoped.mode).toBe('explicit_product');
    expect(scoped.packages.map((row) => row.id)).toEqual(['22222222-2222-4222-8222-222222222222']);
  });

  it('supports Korean-style corner quotes around an exact product title', () => {
    const scoped = scopeQaPackagesToExplicitProduct(
      rows,
      '「Phu Quoc premium resort package 4 nights 6 days」 cancellation terms?',
    );

    expect(scoped.mode).toBe('explicit_product');
    expect(scoped.reason).toBe('exact_title');
    expect(scoped.selectedIds).toEqual(['22222222-2222-4222-8222-222222222222']);
  });

  it('marks duplicate exact titles as ambiguous instead of mixing product facts', () => {
    const duplicateTitleRows = [
      rows[0],
      { ...rows[3], title: rows[0].title },
    ];
    const scoped = scopeQaPackagesToExplicitProduct(
      duplicateTitleRows,
      '"Phu Quoc no-option package 3 nights 5 days" price and inclusions?',
    );

    expect(scoped.mode).toBe('ambiguous_product');
    expect(scoped.reason).toBe('ambiguous_exact_title');
    expect(scoped.selectedIds).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '44444444-4444-4444-8444-444444444444',
    ]);
  });

  it('leaves broad destination questions unpinned', () => {
    const scoped = scopeQaPackagesToExplicitProduct(rows, 'Recommend a Phu Quoc package');

    expect(scoped.mode).toBe('destination_or_general');
    expect(scoped.packages).toHaveLength(4);
  });
});
