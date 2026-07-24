import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REVIEWED_WMO_FALLBACK_DESTINATIONS } from './blog-research-fallback-catalog';

describe('reviewed WMO fallback catalog', () => {
  it('keeps the runtime allowlist aligned with the reviewed migration catalog', () => {
    const migration = readFileSync(join(
      process.cwd(),
      'supabase/migrations/20260724113000_scope_official_research_documents_by_destination.sql',
    ), 'utf8');
    const valuesBlock = migration.slice(
      migration.indexOf('WITH reviewed_wmo_city'),
      migration.indexOf('reviewed_documents AS'),
    );
    const migrationDestinations = [...valuesBlock.matchAll(/\('([^']+)',\s*\d+\)/g)]
      .map((match) => match[1]);

    expect(migrationDestinations).toEqual([...REVIEWED_WMO_FALLBACK_DESTINATIONS]);
    expect(new Set(migrationDestinations).size).toBe(migrationDestinations.length);
    for (const destination of migrationDestinations) {
      expect(migration).toContain(`ARRAY[document.destination]`);
      expect(destination.trim()).toBe(destination);
    }
  });
});
