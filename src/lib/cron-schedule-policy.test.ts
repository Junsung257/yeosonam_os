import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

type ScheduledCron = {
  path: string;
  schedule: string;
};

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const vercelConfig = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../vercel.json', import.meta.url)), 'utf8'),
) as { crons?: ScheduledCron[] };

const EXPECTED_ACTIVE_CRONS: ScheduledCron[] = [
  { path: '/api/cron/blog-scheduler', schedule: '50 23 * * *' },
  { path: '/api/cron/blog-generate', schedule: '5 16,17,18,19,20,21 * * *' },
  { path: '/api/cron/blog-publication-controller', schedule: '5 0,3,6,9,12 * * *' },
  { path: '/api/cron/blog-regenerate-zero-click', schedule: '45 12 * * *' },
  { path: '/api/cron/rank-tracking', schedule: '0 3 * * *' },
  { path: '/api/cron/blog-daily-summary', schedule: '45 13 * * *' },
  { path: '/api/cron/blog-data-readiness', schedule: '15 0 * * *' },
  { path: '/api/cron/blog-analytics-canary', schedule: '25 0 * * *' },
];

describe('scheduled cron policy', () => {
  it('keeps Vercel scheduling on the reviewed active allowlist', () => {
    const crons = vercelConfig.crons ?? [];

    expect(crons).toEqual(EXPECTED_ACTIVE_CRONS);
    expect(crons).toHaveLength(8);
    expect(new Set(crons.map(cron => cron.path)).size).toBe(crons.length);
    expect(crons.every(cron => cron.path.startsWith('/api/cron/'))).toBe(true);
  });

  it('does not restore retired no-op GitHub schedulers', () => {
    for (const retiredWorkflow of [
      '.github/workflows/high-freq-crons.yml',
      '.github/workflows/baseline-refresh.yml',
      '.github/workflows/ota-alias-enrichment.yml',
    ]) {
      expect(existsSync(`${repositoryRoot}${retiredWorkflow}`)).toBe(false);
    }
  });

  it('retires the authority-blocked Supabase expiry job through migration', () => {
    const migration = readFileSync(
      `${repositoryRoot}supabase/migrations/20260901091853_retire_broken_expire_products_cron.sql`,
      'utf8',
    );

    expect(migration).toContain("WHERE jobname = 'expire-products-daily'");
    expect(migration).toContain('cron.alter_job(job_id := v_job_id, active := false)');
  });

  it('marks orphaned database cron policy metadata inactive', () => {
    const migration = readFileSync(
      `${repositoryRoot}supabase/migrations/20260901092023_deactivate_orphaned_cron_policies.sql`,
      'utf8',
    );

    expect(migration).toContain("WHERE trigger_type = 'cron'");
    expect(migration).toContain('is_active = false');
    expect(migration).toContain("action_type = 'deactivate_expired'");
    expect(migration).toContain("action_type = 'slack_notify'");
  });
});
