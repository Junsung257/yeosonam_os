import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('approved destination media contract', () => {
  it('keeps draft metadata private and exposes only owner-approved rows', () => {
    const migration = read('supabase/migrations/20260730083620_create_destination_metadata.sql');
    expect(migration).toContain('enable row level security');
    expect(migration).toContain("to anon, authenticated");
    expect(migration).toContain('using (photo_approved = true)');
    expect(migration).toContain('destination_metadata_approved_photo_complete');
  });

  it('requires approval evidence and freezes media on travel_packages', () => {
    const migration = read(
      'supabase/migrations/20260730084337_add_approved_destination_media_to_travel_packages.sql',
    );
    expect(migration).toContain('photo_approved_at is not null');
    expect(migration).toContain('approved_destination_media jsonb');
    expect(migration).toContain('travel_packages_approved_destination_media_check');
    expect(migration).toContain("approved_destination_media ->> 'approval_source'");

    const provenanceMigration = read(
      'supabase/migrations/20260730091347_add_destination_media_source_license.sql',
    );
    expect(provenanceMigration).toContain('hero_image_provider');
    expect(provenanceMigration).toContain('hero_image_license_url');
    expect(provenanceMigration).toContain('destination_metadata_approved_provenance_check');
    expect(provenanceMigration).toContain("'wikimedia_commons'");
  });

  it('never treats a Pexels search result as customer-ready media', () => {
    const runner = read('src/lib/product-registration/upload-product-runner.ts');
    const loader = read('src/lib/product-registration/approved-destination-media.ts');
    expect(runner).toContain('loadApprovedDestinationMedia');
    expect(runner).not.toContain('searchPexelsPhotos');
    expect(runner).not.toContain('destToEnKeyword');
    expect(loader).toContain(".eq('photo_approved', true)");
    expect(loader).toContain(".eq('destination', destination)");
  });

  it('records source-page and approval timestamps through the admin flow', () => {
    const photoRoute = read('src/app/api/destinations/hero-photo/route.ts');
    const metadataRoute = read('src/app/api/destinations/[city]/route.ts');
    const metadataListRoute = read('src/app/api/destinations/meta-list/route.ts');
    const adminPage = read('src/app/admin/destinations/page.tsx');
    expect(photoRoute).toContain('hero_image_source_page_url');
    expect(photoRoute).toContain('hero_image_source_file_title');
    expect(photoRoute).toContain('hero_image_license_url');
    expect(photoRoute).toContain('photo_approved_at: null');
    expect(photoRoute).toContain("'upload.wikimedia.org'");
    expect(photoRoute).toContain('Image download redirected to an untrusted host.');
    expect(photoRoute).toContain('hasExpectedImageSignature');
    expect(photoRoute).toContain('buildDestinationMediaStoragePath');
    expect(metadataRoute).toContain('photo_approved_at');
    expect(metadataRoute).toContain('new Date().toISOString()');
    expect(metadataRoute).toContain(".eq('photo_approved', true)");
    expect(metadataRoute).toContain('requireAdminRequest(req)');
    expect(metadataListRoute).toContain('withAdminGuard');
    expect(metadataListRoute).toContain("'Cache-Control': 'private, no-store'");
    expect(adminPage).toContain('Object.entries(metaMap)');
    expect(adminPage).toContain("cache: 'no-store'");
    expect(adminPage).toContain('const payload = json?.data ?? json');
    expect(adminPage).toContain('isDestinationMediaApprovalReady');
  });
});
