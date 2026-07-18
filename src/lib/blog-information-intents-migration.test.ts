import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLOG_INFORMATION_INTENTS } from './blog-information-contract';

describe('blog information representative intent v2 migration', () => {
  const migration = readFileSync(join(
    process.cwd(),
    'supabase/migrations/20260715227500_blog_information_representative_intents.sql',
  ), 'utf8');

  it('matches the exact canonical ten-intent application contract', () => {
    for (const intent of BLOG_INFORMATION_INTENTS) expect(migration).toContain(`'${intent}'`);
    expect(BLOG_INFORMATION_INTENTS).toHaveLength(10);
    expect(migration).not.toMatch(/'family_itinerary'|'general'/);
  });

  it('does not mutate legacy rows and defers validation until reconciliation', () => {
    expect(migration).toContain('NOT VALID');
    expect(migration).not.toMatch(/UPDATE\s+public\.blog_information_representatives/i);
    expect(migration).not.toContain('VALIDATE CONSTRAINT');
  });
});
