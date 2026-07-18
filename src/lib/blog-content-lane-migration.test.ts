import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blog queue content-lane migration', () => {
  const migration = readFileSync(join(
    process.cwd(),
    'supabase/migrations/20260715224000_blog_queue_content_lane.sql',
  ), 'utf8');

  it('persists a generated lane based on identifiers as well as source', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS content_lane text');
    expect(migration).toContain('GENERATED ALWAYS AS');
    expect(migration).toContain("WHEN source = 'card_news' THEN 'card_news_bridge'");
    expect(migration).toContain("WHEN product_id IS NOT NULL OR source = 'product' THEN 'product'");
    expect(migration).toContain("ELSE 'informational'");
  });

  it('constrains the discriminator to the three supported writer lanes', () => {
    expect(migration).toContain('blog_topic_queue_content_lane_check');
    expect(migration).toContain("CHECK (content_lane IN ('informational', 'product', 'card_news_bridge'))");
  });
});
