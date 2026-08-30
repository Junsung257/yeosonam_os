import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Guam transportation reviewed source migration', () => {
  it('scopes the official tourism page to Guam airport transport', () => {
    const migration = readFileSync(resolve(
      process.cwd(),
      'supabase/migrations/20260831123000_add_visit_guam_transportation_research_source.sql',
    ), 'utf8');

    expect(migration).toContain('https://www.visitguam.com/planning/transportation/');
    expect(migration).toContain("array['airport_transport']");
    expect(migration).toContain("array['괌', 'guam']");
    expect(migration).toContain("source_type = 'official_tourism'");
    expect(migration).toContain('on conflict (official_source_registry_id, source_url) do update');
  });
});
