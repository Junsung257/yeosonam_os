import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function routeSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/api/v1/packages/route.ts'), 'utf8');
}

describe('public v1 packages API publication gate', () => {
  it('requires current public snapshots before returning customer package rows', () => {
    const source = routeSource();

    expect(source).toContain('fetchAndMergeCurrentPublicPackageCardSnapshots');
    expect(source).toContain('isPublicPublicationState');
    expect(source).toContain('function isCustomerPublicSnapshotCandidate');
    expect(source).toContain(".in('publication_state', ['approved', 'published'])");
    expect(source).toContain(').map(toPublicV1Package)');
  });

  it('returns a small customer projection instead of raw travel_packages rows', () => {
    const source = routeSource();
    const projectionIndex = source.indexOf('function toPublicV1Package');
    const getIndex = source.indexOf('export async function GET');
    const projectionSource = source.slice(projectionIndex, getIndex);

    expect(projectionIndex).toBeGreaterThan(0);
    expect(projectionSource).toContain('sanitizeCustomerPackageForClient');
    expect(projectionSource).not.toContain('row.product_summary');
    expect(projectionSource).not.toContain('row.summary');
    expect(projectionSource).not.toContain('audit_report');
    expect(projectionSource).not.toContain('optional_tours');
    expect(projectionSource).not.toContain('itinerary_data');
  });
});
