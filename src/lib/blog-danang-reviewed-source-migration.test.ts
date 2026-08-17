import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260816093000_add_danang_reviewed_research_sources.sql',
  ),
  'utf8',
);
const decisionSourceMigration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260817121500_add_danang_itinerary_decision_sources.sql',
  ),
  'utf8',
);

describe('Da Nang reviewed research source migration', () => {
  it('registers directly fetched official tourism authorities', () => {
    expect(migration).toContain("'vietnam.travel'");
    expect(migration).toContain("'danangfantasticity.com'");
    expect(migration).toContain("'official_tourism'");
    expect(migration).toContain("'official_primary'");
    expect(migration).toContain('direct fetch returned HTTP 200 on 2026-08-16');
  });

  it('scopes all source documents to the Da Nang itinerary intent', () => {
    expect(migration.match(/array\['itinerary'\]/g)).toHaveLength(4);
    expect(migration.match(/array\['다낭'\]/g)).toHaveLength(4);
    expect(migration).toContain(
      'https://www.vietnam.travel/places-to-go/central-vietnam/da-nang',
    );
    expect(migration).toContain(
      'https://vietnam.travel/things-to-do/must-visit-places-in-da-nang',
    );
  });

  it('adds decision-useful city sources without widening their destination scope', () => {
    expect(decisionSourceMigration).toContain(
      'https://danangfantasticity.com/en/new-tourism-products-in-da-nang-2026',
    );
    expect(decisionSourceMigration).toContain(
      'https://danangfantasticity.com/en/the-marble-mountains',
    );
    expect(decisionSourceMigration).toContain(
      'https://danangfantasticity.com/en/di-san-canh-quan/ban-dao-son-tra',
    );
    expect(decisionSourceMigration).toContain("array['itinerary']");
    expect(decisionSourceMigration).toContain("array['다낭']");
    expect(decisionSourceMigration).toContain('Dry-run verification (read-only)');
    expect(decisionSourceMigration).toContain('Rollback (manual');
  });
});
