import { describe, expect, it } from 'vitest';

import { getPublishedMarketingPackage } from './read-model';

function clientWith(rows: Array<Record<string, unknown>>) {
  const query = {
    select() { return query; },
    in() { return Promise.resolve({ data: rows, error: null }); },
  };
  return { from: () => query } as never;
}

describe('published package read model', () => {
  it('returns a marketing package only with complete immutable provenance', async () => {
    const pkg = await getPublishedMarketingPackage(clientWith([{
      package_id: '11111111-1111-4111-8111-111111111111',
      published_snapshot_id: '22222222-2222-4222-8222-222222222222',
      snapshot_hash: 'snapshot-hash',
      snapshot_schema_version: 'public-package-snapshot-v2',
      source_evidence_digest: 'evidence-hash',
      published_at: '2026-07-15T00:00:00.000Z',
      marketing_projection: {
        id: '11111111-1111-4111-8111-111111111111',
        title: '연길·백두산 노옵션 4박5일',
        destination: '연길·백두산',
        duration: 5,
        nights: 4,
        price: 599000,
        claims: ['노옵션'],
      },
    }]), '11111111-1111-4111-8111-111111111111');

    expect(pkg).toMatchObject({
      title: '연길·백두산 노옵션 4박5일',
      product_highlights: ['노옵션'],
      _public_snapshot: {
        id: '22222222-2222-4222-8222-222222222222',
        hash: 'snapshot-hash',
        source_evidence_digest: 'evidence-hash',
      },
    });
  });

  it('fails closed when snapshot provenance is incomplete', async () => {
    const pkg = await getPublishedMarketingPackage(clientWith([{
      package_id: '11111111-1111-4111-8111-111111111111',
      published_snapshot_id: null,
      snapshot_hash: 'snapshot-hash',
      snapshot_schema_version: 'public-package-snapshot-v2',
      source_evidence_digest: 'evidence-hash',
      marketing_projection: { title: '노출되면 안 되는 제목' },
    }]), '11111111-1111-4111-8111-111111111111');

    expect(pkg).toBeNull();
  });
});
