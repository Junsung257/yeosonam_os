import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function routeSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/api/v1/packages/route.ts'), 'utf8');
}

describe('public v1 packages API publication gate', () => {
  it('requires current public snapshots before returning customer package rows', () => {
    const source = routeSource();

    expect(source).toContain('listCurrentPublicPackageCardSnapshots');
    expect(source).toContain("channel: 'b2b'");
    expect(source).not.toContain(".from('travel_packages')");
    expect(source).toContain('.map(toPublicV1Package)');
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

  it('enforces the published API contract and emits only redacted structured logs', () => {
    const source = routeSource();

    expect(source).toContain('V1PackageSearchQuerySchema.safeParse');
    expect(source).toContain('V1PackageRecommendationBodySchema.safeParse');
    expect(source).toContain('V1PackageListResponseSchema.parse');
    expect(source).toContain('observeApiRequest');
    expect(source).not.toContain('console.warn');
  });

  it('reports total matches before applying pagination', () => {
    const source = routeSource();

    expect(source).toContain('pagination: { total: matchingData.length, limit, offset }');
    expect(source).toContain('pagination: { total: matchingData.length, limit: 10, offset: 0 }');
  });
});
