import { describe, expect, it } from 'vitest';

import {
  classifyProductRegistrationV5Observation,
  extractProductRegistrationV5SnapshotHashFromHtml,
} from './convergence-observer';

const expected = 'a'.repeat(64);

describe('V5 cache convergence observer contracts', () => {
  it('extracts the lineage marker regardless of meta attribute order', () => {
    expect(extractProductRegistrationV5SnapshotHashFromHtml(
      `<html><head><meta content="${expected.toUpperCase()}" data-x="1" name="product-registration-v5-snapshot-hash"></head></html>`,
    )).toBe(expected);
    expect(extractProductRegistrationV5SnapshotHashFromHtml('<meta name="other" content="value">')).toBeNull();
  });

  it('converges only when an HTTP success returns the exact snapshot hash', () => {
    expect(classifyProductRegistrationV5Observation({
      expectedSnapshotHash: expected,
      httpStatus: 200,
      observedSnapshotHash: expected.toUpperCase(),
    })).toEqual({ status: 'converged', observedSnapshotHash: expected, errorDetail: null });
    expect(classifyProductRegistrationV5Observation({
      expectedSnapshotHash: expected,
      httpStatus: 200,
      observedSnapshotHash: 'b'.repeat(64),
    }).status).toBe('stale');
  });

  it('fails closed for missing markers and non-success responses', () => {
    expect(classifyProductRegistrationV5Observation({
      expectedSnapshotHash: expected,
      httpStatus: 200,
    })).toMatchObject({ status: 'failed', errorDetail: 'SNAPSHOT_MARKER_MISSING' });
    expect(classifyProductRegistrationV5Observation({
      expectedSnapshotHash: expected,
      httpStatus: 404,
      observedSnapshotHash: expected,
    })).toMatchObject({ status: 'failed', errorDetail: 'HTTP_404' });
  });
});
