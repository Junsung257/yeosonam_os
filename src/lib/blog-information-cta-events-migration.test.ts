import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260715229000_blog_information_cta_events.sql',
), 'utf8');
const route = fs.readFileSync(path.join(
  process.cwd(),
  'src/app/api/blog-information-cta-events/route.ts',
), 'utf8');
const generalTracker = fs.readFileSync(path.join(process.cwd(), 'src/components/BlogTracker.tsx'), 'utf8');
const informationalHub = fs.readFileSync(path.join(process.cwd(), 'src/components/blog/InformationalCtaHub.tsx'), 'utf8');
const middleware = fs.readFileSync(path.join(process.cwd(), 'src/middleware.ts'), 'utf8');

describe('minimal informational CTA event persistence', () => {
  it('stores only fixed anonymous dimensions and hashes the ephemeral idempotency key', () => {
    const tableDefinition = migration.slice(
      migration.indexOf('CREATE TABLE IF NOT EXISTS public.blog_information_cta_events'),
      migration.indexOf('CREATE INDEX IF NOT EXISTS idx_blog_information_cta_events_rollup'),
    );
    expect(migration).toContain('event_key_hash char(64) NOT NULL UNIQUE');
    expect(migration).toContain("extensions.digest(p_event_key, 'sha256')");
    expect(tableDefinition).not.toMatch(/session_id|user_id|visitor|email|phone|ip_address|user_agent|utm_|event_payload|cta_href/i);
  });

  it('deduplicates, rate limits, and accepts only canonical public information representatives', () => {
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('v_count >= 120');
    expect(migration).toContain("creative.public_eligibility_lane = 'information_v2'");
    expect(migration).toContain("representative.status = 'active'");
    expect(migration).toContain('ON CONFLICT (event_key_hash) DO NOTHING');
  });

  it('blocks cross-site/server-render traffic and isolates telemetry failure from navigation', () => {
    expect(route).toContain('isAllowedBlogInformationEventOrigin');
    expect(route).toContain("status: 403");
    expect(route).toContain("status: 202");
    expect(route).toContain("ok: true, skipped: true");
    expect(informationalHub).toContain('trackBlogInformationalCtaEvent');
    expect(informationalHub).not.toContain('trackEngagement');
    expect(generalTracker).toContain("link.dataset.informationalCta === 'true'");
    expect(middleware).toContain("'/api/blog-information-cta-events'");
  });
});
