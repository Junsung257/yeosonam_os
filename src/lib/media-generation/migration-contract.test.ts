import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const baseSql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260828063117_media_assets_v1.sql'),
  'utf8',
);
const workerSql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260828090056_media_codex_worker_v1.sql'),
  'utf8',
);
const sql = `${baseSql}\n${workerSql}`;

describe('media assets migration contract', () => {
  it('keeps the provenance ledger server-only and status-constrained', () => {
    expect(sql).toContain('ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON TABLE public.media_assets FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.media_assets TO service_role');
    expect(sql).toMatch(/status text NOT NULL[\s\S]*?'superseded'/);
    expect(sql).toContain('idempotency_key text NOT NULL UNIQUE');
    expect(sql).toContain('superseded_by uuid NULL REFERENCES public.media_assets(id)');
    expect(workerSql).toContain("'generating'");
    expect(workerSql).toContain("'codex_builtin'");
    expect(workerSql).toContain('lease_expires_at timestamptz');
  });

  it('creates only a bounded public WebP delivery bucket', () => {
    expect(sql).toContain("'media-assets'");
    expect(sql).toContain('6291456');
    expect(sql).toContain("ARRAY['image/webp']::text[]");
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]+storage\.objects/i);
  });
});
