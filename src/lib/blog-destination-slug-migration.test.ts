import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260730152000_repair_dubai_weather_slug.sql'),
  'utf8',
);

describe('Dubai destination slug repair migration', () => {
  it('moves the canonical slug and queues the corrected URL atomically', () => {
    expect(migration).toContain("v_old_slug constant text := 'weather-checklist-july'");
    expect(migration).toContain("v_new_slug constant text := 'dubai-july-weather-preparation'");
    expect(migration).toContain('update public.blog_information_representatives');
    expect(migration).toContain('insert into public.blog_indexing_jobs');
    expect(migration).toContain("'canonical_slug_repair'");
    expect(migration.trim().startsWith('-- Repair')).toBe(true);
    expect(migration.trim().endsWith('commit;')).toBe(true);
  });
});
