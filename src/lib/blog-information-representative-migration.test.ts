import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blog information representative migration', () => {
  const source = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260715084845_blog_information_representatives.sql'),
    'utf8',
  );

  it('creates one unique representative per destination, intent, audience, and locale', () => {
    expect(source).toContain('create table if not exists public.blog_information_representatives');
    expect(source).toContain('unique (destination_id, intent, audience, locale)');
    expect(source).toContain('representative_key text primary key');
  });

  it('keeps the registry server-only with RLS and no browser grants', () => {
    expect(source).toContain('alter table public.blog_information_representatives enable row level security');
    expect(source).toContain('from public, anon, authenticated');
    expect(source).toContain('to service_role');
  });

  it('does not backfill, redirect, merge, or modify existing public rows', () => {
    expect(source).not.toMatch(/update\s+public\.content_creatives/i);
    expect(source).not.toMatch(/delete\s+from|redirect|merge/i);
  });
});
