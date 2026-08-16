import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blog generation attempt finish reason migration', () => {
  it('adds an additive provider completion audit field with rollback SQL', () => {
    const sql = readFileSync(join(
      process.cwd(),
      'supabase/migrations/20260816094500_blog_generation_attempt_finish_reason.sql',
    ), 'utf8');

    expect(sql).toContain('add column if not exists finish_reason text');
    expect(sql).toContain('drop column if exists finish_reason');
    expect(sql).not.toMatch(/update\s+public\.content_creatives/i);
  });
});
