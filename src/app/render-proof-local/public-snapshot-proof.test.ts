import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('offline render proof public snapshot contract', () => {
  it('renders the proof-bound customer snapshot instead of the raw fixture package', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/render-proof-local/[surface]/[id]/page.tsx'),
      'utf8',
    );

    expect(source).toContain('buildCandidatePublicPackageForProof(fixture.package)');
    expect(source).toContain('const proofPackage = proofCandidate.package');
    expect(source).toContain('proofCandidate.snapshot.public_notices');
    expect(source).toContain('initialNotices={initialNotices}');
    expect(source).toContain('mapTravelPackageToLandingData(proofPackage, frozenHero)');
    expect(source).toContain("initialPackage={proofPackage as unknown as DetailProps['initialPackage']}");
    expect(source).not.toContain('mapTravelPackageToLandingData(fixture.package');
    expect(source).not.toContain("initialPackage={fixture.package as unknown as DetailProps['initialPackage']}");
  });
});
