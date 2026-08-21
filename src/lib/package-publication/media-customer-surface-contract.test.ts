import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return fs.readFileSync(`${process.cwd()}/${path}`, 'utf8');
}

describe('public media customer surface contract', () => {
  it('does not infer reference-image status from a provider URL', () => {
    const detail = source('src/app/packages/[id]/DetailClient.tsx');
    const landing = source('src/app/lp/[id]/LandingClient.tsx');
    expect(detail).not.toContain('pexels\\.com');
    expect(detail).not.toContain('unsplash\\.com');
    expect(landing).not.toContain('pexels\\.com');
    expect(landing).not.toContain('unsplash\\.com');
    expect(detail).toContain('activeHeroMedia?.reference_only === true');
    expect(landing).toContain('heroMedia?.reference_only === true');
  });

  it('shows the structured customer label and source attribution', () => {
    const detail = source('src/app/packages/[id]/DetailClient.tsx');
    const landing = source('src/app/lp/[id]/LandingClient.tsx');
    const card = source('src/components/customer/PackageCard.tsx');
    for (const surface of [detail, landing]) {
      expect(surface).toContain('attribution_text');
      expect(surface).toContain('attribution_url');
      expect(surface).toContain('license_url');
      expect(surface).toContain('license_code');
    }
    expect(card).toContain('media?.reference_only');
    expect(card).toContain('{media.label}');
  });

  it('keeps the broad attraction photo resolver out of immutable public snapshots', () => {
    const loader = source('src/lib/load-lp-package.ts');
    expect(loader).toContain('fetchPublicPackageSnapshotById');
    expect(loader).toContain('getCurrentPublicPackage');
    expect(loader).not.toContain('resolveLpHeroPhotoUrl');
    expect(loader).not.toContain("from('travel_packages')");
  });
});
