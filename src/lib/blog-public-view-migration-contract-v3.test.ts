import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260811132017_blog_quality_v3_policy.sql',
), 'utf8');

describe('Blog Quality V3 public view migration contract', () => {
  it('preserves the deployed view ordinals before appending V3 fields', () => {
    const projection = migration.slice(
      migration.indexOf('create or replace view public.public_blog_content_creatives'),
      migration.indexOf('from public.content_creatives c'),
    );

    expect(projection).not.toMatch(/select\s+c\.\*/i);
    expect(projection.indexOf('c.metrics')).toBeLessThan(
      projection.indexOf('policy.lane as public_eligibility_lane'),
    );
    expect(projection.indexOf('policy.lane as public_eligibility_lane')).toBeLessThan(
      projection.indexOf('c.title'),
    );
    expect(projection.indexOf('c.author_profile_id')).toBeLessThan(
      projection.indexOf('policy.reason as public_eligibility_reason'),
    );
  });
});
