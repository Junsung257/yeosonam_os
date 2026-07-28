import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLOG_INFORMATION_INTENTS } from './blog-information-contract';

describe('blog information representative intent v3 migration', () => {
  const migration = readFileSync(join(
    process.cwd(),
    'supabase/migrations/20260728223500_add_local_transport_information_intent.sql',
  ), 'utf8');

  it('matches the exact canonical eleven-intent application contract', () => {
    for (const intent of BLOG_INFORMATION_INTENTS) expect(migration).toContain(`'${intent}'`);
    expect(BLOG_INFORMATION_INTENTS).toHaveLength(11);
    expect(migration).not.toMatch(/'family_itinerary'|'general'/);
  });

  it('keeps representative validation deferred and updates the atomic publication guard', () => {
    expect(migration).toMatch(/\bnot valid\b/i);
    expect(migration).not.toMatch(/\bvalidate constraint\b/i);
    expect(migration).toContain('publish_blog_information_atomically');
    expect(migration).toContain('blog_information_cta_events_intent_v2_check');
  });
});
