import { describe, expect, it } from 'vitest';

import { buildCustomerPackageMobileProofInputHash, buildProofInputHash, hashAssetManifest } from './proof-input';

describe('proof input hash', () => {
  const base = {
    publicSnapshotHash: 'snapshot',
    sourceEvidenceDigest: 'evidence',
    renderContractHash: 'render',
    assetManifestHash: 'assets',
    routeConfigHash: 'routes',
    viewportProfileVersion: 'mobile-v1',
    locale: 'ko-KR',
    featureFlagDigest: 'flags',
  };

  it('is stable for the same customer-visible inputs', () => {
    expect(buildProofInputHash(base)).toBe(buildProofInputHash({ ...base }));
  });

  it('invalidates when an asset or render contract changes', () => {
    expect(buildProofInputHash(base)).not.toBe(buildProofInputHash({ ...base, assetManifestHash: 'changed' }));
    expect(buildProofInputHash(base)).not.toBe(buildProofInputHash({ ...base, renderContractHash: 'changed' }));
  });

  it('normalizes asset order and duplicates', () => {
    expect(hashAssetManifest(['b', 'a', 'a'])).toBe(hashAssetManifest(['a', 'b']));
  });

  it('uses one canonical contract for customer package mobile proof inputs', () => {
    const first = buildCustomerPackageMobileProofInputHash({
      publicSnapshotHash: 'snapshot',
      sourceEvidenceDigest: 'evidence',
      assetUrls: ['https://cdn.example.com/b.jpg', 'https://cdn.example.com/a.jpg'],
      appBuildId: 'build-1',
    });
    const second = buildCustomerPackageMobileProofInputHash({
      publicSnapshotHash: 'snapshot',
      sourceEvidenceDigest: 'evidence',
      assetUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
      appBuildId: 'build-1',
    });
    expect(first).toBe(second);
  });
});
