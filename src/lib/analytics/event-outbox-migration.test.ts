import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260811210920_blog_quality_v3_reliability_followup.sql',
), 'utf8').toLowerCase();

describe('analytics event outbox migration', () => {
  it('enqueues generate_lead inside the lead insert transaction', () => {
    expect(migration).toContain('after insert on public.leads');
    expect(migration).toContain("'lead:' || new.id::text");
    expect(migration).toContain('on conflict (idempotency_key) do nothing');
    expect(migration).toContain("#- '{firsttouch,term}'");
    expect(migration).toContain("#- '{lasttouch,term}'");
  });

  it('keeps the outbox private and service-role only', () => {
    expect(migration).toContain('alter table public.analytics_server_event_outbox enable row level security');
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('to service_role');
    expect(migration).not.toContain('grant select on table public.analytics_server_event_outbox to anon');
  });
});
