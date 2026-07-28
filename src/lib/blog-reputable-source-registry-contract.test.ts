import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blog reputable source registry migration', () => {
  it('covers the failed non-weather intents with reviewed, limitation-labelled sources', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'supabase',
        'migrations',
        '20260727223855_expand_blog_research_source_registry.sql',
      ),
      'utf8',
    );

    for (const hostname of [
      'numbeo.com',
      'budgetyourtrip.com',
      'rome2rio.com',
      'wikivoyage.org',
    ]) {
      expect(migration).toContain(`'${hostname}'`);
    }
    expect(migration).toContain("'airport_transport'");
    expect(migration).toContain("'food_budget'");
    expect(migration).toContain("'hotel_areas'");
    expect(migration).toContain("'itinerary'");
    expect(migration).toContain("'shopping_souvenirs'");
    expect(migration).toContain('never a guaranteed live price');
    expect(migration).toContain('Require a second domain');
  });

  it('revokes sources that fail production direct-fetch and expands only corroboration-safe intent coverage', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'supabase',
        'migrations',
        '20260727232255_correct_blog_research_source_availability.sql',
      ),
      'utf8',
    );

    expect(migration).toContain("status = 'revoked'");
    expect(migration).toContain("where hostname = 'budgetyourtrip.com'");
    expect(migration).toContain("array['food_budget']");
    expect(migration).toContain("where hostname = 'wikivoyage.org'");
    expect(migration).toContain('requires a second reviewed domain');
  });

  it('persists destination-scoped direct research pages and high-risk insurer sources', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'supabase',
        'migrations',
        '20260727233256_add_curated_reputable_research_documents.sql',
      ),
      'utf8',
    );

    expect(migration).toContain('research_urls text[]');
    expect(migration).toContain('research_destinations text[]');
    expect(migration).toContain('rootzguam.com');
    expect(migration).toContain('nanascafeguam.com');
    expect(migration).toContain('hiltonguamresort.com');
    expect(migration).toContain('grta_bus_pass_sales_information_sheet.pdf');
    expect(migration).toContain('master_-_fixed_route_schedule_updated112625.pdf');
    expect(migration).toContain('direct.samsungfire.com');
    expect(migration).toContain('internet_15310.pdf');
    expect(migration).toContain('Human review remains mandatory');
    expect(migration).toContain("where hostname = 'rome2rio.com'");
  });

  it('adds directly retrievable Guam lodging, family, itinerary, and souvenir evidence', () => {
    const lodgingMigration = readFileSync(
      join(
        process.cwd(),
        'supabase',
        'migrations',
        '20260728000500_add_guam_family_hotel_research_document.sql',
      ),
      'utf8',
    );
    const experienceMigration = readFileSync(
      join(
        process.cwd(),
        'supabase',
        'migrations',
        '20260728002000_add_guam_family_itinerary_shopping_documents.sql',
      ),
      'utf8',
    );

    expect(lodgingMigration).toContain('https://www.booking.com/family/country/gu.ko.html');
    expect(lodgingMigration).toContain("'family_budget'");
    expect(experienceMigration).toContain('https://www.visitguam.com/things-to-do/family-fun/');
    expect(experienceMigration).toContain('%EC%96%B8%EB%8D%94%EC%9B%8C%ED%84%B0');
    expect(experienceMigration).toContain('memoriesofguam.com');
    expect(experienceMigration).toContain('guamroute.com');
    expect(experienceMigration).toContain('checked-date product samples');
  });

  it('persists a directly reviewed second hotel-area source for cross-domain checks', () => {
    const hotelAreaMigration = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260728005000_add_guam_hotel_area_document.sql',
      ),
      'utf8',
    );

    expect(hotelAreaMigration).toContain(
      'https://www.agoda.com/ko-kr/travel-guides/guam/where-to-stay-in-guam-best-hotels/',
    );
    expect(hotelAreaMigration).toContain("array['hotel_areas']");
    expect(hotelAreaMigration).toContain("array['괌']");
    expect(hotelAreaMigration).toContain("where hostname = 'agoda.com'");
  });

  it('adds a directly retrievable Guam breakfast menu with explicit dollar prices', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'supabase',
        'migrations',
        '20260728003500_add_guam_breakfast_menu_document.sql',
      ),
      'utf8',
    );

    expect(migration).toContain('chinfe.menuguam.com');
    expect(migration).toContain("'food_budget'");
    expect(migration).toContain('explicit breakfast prices and hours');
    expect(migration).toContain('checked-date restaurant sample');
  });
});
