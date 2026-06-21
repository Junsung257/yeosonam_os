import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const calls: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];
  const responses: unknown[][] = [];

  class QueryBuilder {
    filters: Array<[string, string, unknown]> = [];

    constructor(private readonly table: string) {}

    select() { return this; }
    eq(column: string, value: unknown) {
      this.filters.push(['eq', column, value]);
      return this;
    }
    in(column: string, value: unknown) {
      this.filters.push(['in', column, value]);
      return this;
    }
    neq(column: string, value: unknown) {
      this.filters.push(['neq', column, value]);
      return this;
    }
    gte(column: string, value: unknown) {
      this.filters.push(['gte', column, value]);
      return this;
    }
    lt(column: string, value: unknown) {
      this.filters.push(['lt', column, value]);
      return this;
    }
    limit() {
      calls.push({ table: this.table, filters: this.filters });
      return Promise.resolve({ data: responses.shift() ?? [], error: null });
    }
  }

  return {
    calls,
    responses,
    supabaseAdmin: {
      from: vi.fn((table: string) => new QueryBuilder(table)),
    },
  };
});

vi.mock('./supabase', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));

import { checkDuplicate } from './blog-quality-gate';

describe('checkDuplicate', () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.responses.length = 0;
    mocks.supabaseAdmin.from.mockClear();
  });

  it('does not block unrelated posts just because they share a generic travel-guide prefix', async () => {
    mocks.responses.push([]);

    const gate = await checkDuplicate({
      blog_html: '# 괌 여행',
      slug: 'travel-guide-q1234',
      blog_type: 'info',
    });

    expect(gate.passed).toBe(true);
    expect(mocks.calls).toHaveLength(1);
    expect(mocks.calls[0].filters).toContainEqual(['eq', 'slug', 'travel-guide-q1234']);
  });

  it('does not block product posts because a recent info post used the same destination and angle', async () => {
    mocks.responses.push([], []);

    const gate = await checkDuplicate({
      blog_html: '# 푸꾸옥 패키지',
      slug: 'phuquoc-family-package',
      destination: '푸꾸옥',
      angle_type: 'value',
      blog_type: 'product',
      category: 'product_intro',
      content_type: 'package_intro',
      product_id: 'pkg-1',
    });

    expect(gate.passed).toBe(true);
    expect(mocks.calls).toHaveLength(2);
    expect(mocks.calls.flatMap((call) => call.filters)).not.toContainEqual(['eq', 'angle_type', 'value']);
    expect(mocks.calls.flatMap((call) => call.filters)).not.toContainEqual(['eq', 'travel_packages.destination', '푸꾸옥']);
  });

  it('still blocks info posts with a recent same destination and angle', async () => {
    mocks.responses.push([], [], [{ id: 'old-1', slug: 'clark-old-guide' }]);

    const gate = await checkDuplicate({
      blog_html: '# 클락 날씨',
      slug: 'clark-weather-guide',
      destination: '클락',
      angle_type: 'value',
      blog_type: 'info',
      category: 'local_info',
    });

    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain('최근 14일 내 클락 + value');
  });
});
