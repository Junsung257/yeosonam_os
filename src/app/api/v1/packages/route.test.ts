import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function routeSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/api/v1/packages/route.ts'), 'utf8');
}

describe('public v1 packages API publication gate', () => {
  it('requires the public API projection before returning package rows', () => {
    const source = routeSource();

    expect(source).toContain('getPublishedPackagePublicApi');
    expect(source).not.toContain('fetchAndMergeCurrentPublicPackageCardSnapshots');
    expect(source).not.toContain('function isCustomerPublicSnapshotCandidate');
    expect(source).not.toContain('toPublicV1Package');
  });

  it('returns a small customer projection instead of raw travel_packages rows', () => {
    const source = routeSource();
    expect(source).toContain(".select('id')");
    expect(source).not.toContain(".select('*')");
    expect(source).not.toContain('sanitizeCustomerPackageForClient');
    expect(source).not.toContain('optional_tours');
    expect(source).not.toContain('itinerary_data');
  });
});
