import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('admin keyword stats schema contract', () => {
  const route = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');

  it('uses the deployed keyword column names and server-side aggregates', () => {
    expect(route).toContain("rpc('get_keyword_performance_admin_summary'");
    expect(route).toContain("from('v_keyword_performance_summary')");
    expect(route).toContain("query.gte('impressions'");
    expect(route).toContain(".order('impressions'");
    expect(route).not.toContain("query.ilike('keyword'");
    expect(route).not.toContain("query.gte('total_impressions'");
  });

  it('keeps ROAS value-based rather than conversion-count divided by spend', () => {
    const sql = readFileSync(
      new URL('../../../../../supabase/migrations/20260723124500_keyword_stats_accuracy.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toContain('SUM(total_revenue)::numeric / SUM(total_spend)::numeric');
    expect(sql).not.toContain('SUM(conversions)::numeric / SUM(total_spend)::numeric');
    expect(sql).toContain('ALTER VIEW public.v_keyword_performance_summary SET (security_invoker = on)');
    expect(sql).toContain('TO service_role');
  });
});
