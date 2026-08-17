import { describe, expect, it } from 'vitest';

import { PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION } from '@/lib/product-registration-v4/canonical-worker';
import { PRODUCT_REGISTRATION_V4_PARSER_VERSION } from '@/lib/product-registration-v4/types';

import { PRODUCT_REGISTRATION_V6_POLICY_VERSION, PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION } from './types';
import {
  assertProductRegistrationEngineReleaseManifest,
  productRegistrationEngineReleaseHash,
  type ProductRegistrationEngineReleaseManifest,
} from './engine-release-manifest';

const manifest: ProductRegistrationEngineReleaseManifest = {
  schemaVersion: 'product-registration-engine-release-1',
  gitCommit: 'a'.repeat(40),
  parserVersion: PRODUCT_REGISTRATION_V4_PARSER_VERSION,
  normalizationVersion: PRODUCT_REGISTRATION_V4_NORMALIZATION_VERSION,
  workflowVersion: PRODUCT_REGISTRATION_V6_WORKFLOW_VERSION,
  policyVersion: PRODUCT_REGISTRATION_V6_POLICY_VERSION,
  termsPolicyHash: 'c'.repeat(64),
  supplierProfileVersion: 'supplier-profile-registry-empty-1',
  referenceDate: '2026-08-16',
  corpusHash: 'b'.repeat(64),
};

describe('product registration engine release manifest', () => {
  it('pins every input that can change a benchmark result', () => {
    expect(() => assertProductRegistrationEngineReleaseManifest(manifest)).not.toThrow();
    expect(productRegistrationEngineReleaseHash(manifest)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('rejects a stale normalization version', () => {
    expect(() => assertProductRegistrationEngineReleaseManifest({ ...manifest, normalizationVersion: 'stale' }))
      .toThrow('PRODUCT_REGISTRATION_RELEASE_NORMALIZATION_MISMATCH');
  });
});
