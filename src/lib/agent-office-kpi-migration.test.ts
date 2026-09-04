import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Agent Office KPI migration contract', () => {
  it('is invoker-only, bounded, read-only, and service-role gated', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260904010000_agent_office_kpi_lineage_v1.sql'),
      'utf8',
    );

    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).toContain("statement_timeout = '5000ms'");
    expect(sql).toContain("INTERVAL '366 days'");
    expect(sql).toContain('REVOKE ALL ON FUNCTION');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION');
    expect(sql).toContain('TO service_role');
    expect(sql).not.toContain('INSERT INTO');
    expect(sql).not.toContain('UPDATE ');
    expect(sql).not.toContain('DELETE FROM');
    expect(sql).not.toContain('agent_runs');
  });
});
