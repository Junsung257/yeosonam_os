import { describe, expect, it } from 'vitest';

import {
  evaluatePublicPackageActivationReadiness,
  isPublicPackageCanaryAllowed,
  resolvePublicPackageEgressMode,
} from './rollout-mode';

describe('public package egress rollout mode', () => {
  it('defaults missing or unknown values to legacy instead of enforced', () => {
    expect(resolvePublicPackageEgressMode({}).mode).toBe('legacy');
    expect(resolvePublicPackageEgressMode({ PUBLIC_PACKAGE_EGRESS_MODE: 'oops' })).toMatchObject({
      mode: 'legacy',
      defaulted: true,
      canUseCustomerProjection: false,
    });
  });

  it('allows shadow reads to record diffs without changing customer responses', () => {
    expect(resolvePublicPackageEgressMode({ PUBLIC_PACKAGE_EGRESS_MODE: 'shadow' })).toMatchObject({
      mode: 'shadow',
      canUseCustomerProjection: false,
      canWriteShadowDiffs: true,
      requiresActivationEvidence: false,
    });
  });

  it('requires a canary allowlist before canary mode can pass activation checks', () => {
    expect(evaluatePublicPackageActivationReadiness({
      PUBLIC_PACKAGE_EGRESS_MODE: 'canary',
    })).toMatchObject({
      status: 'block',
      blockers: ['canary mode requires PUBLIC_PACKAGE_EGRESS_CANARY_PACKAGE_IDS'],
    });

    const env = {
      PUBLIC_PACKAGE_EGRESS_MODE: 'canary',
      PUBLIC_PACKAGE_EGRESS_CANARY_PACKAGE_IDS: 'pkg-1, pkg-2, pkg-1',
    };
    expect(evaluatePublicPackageActivationReadiness(env)).toMatchObject({ status: 'pass' });
    expect(isPublicPackageCanaryAllowed('pkg-1', env)).toBe(true);
    expect(isPublicPackageCanaryAllowed('pkg-3', env)).toBe(false);
  });

  it('blocks enforced mode until staging evidence and production safety metrics exist', () => {
    const result = evaluatePublicPackageActivationReadiness({
      PUBLIC_PACKAGE_EGRESS_MODE: 'enforced',
    });

    expect(result.status).toBe('block');
    expect(result.blockers).toContain('PUBLIC_PACKAGE_EGRESS_ACTIVATION_READY must be true');
    expect(result.blockers).toContain('snapshot rows must be greater than 0');
    expect(result.blockers).toContain('external raw fallback must be 0');
  });

  it('passes enforced mode only with complete activation evidence', () => {
    expect(evaluatePublicPackageActivationReadiness({
      PUBLIC_PACKAGE_EGRESS_MODE: 'enforced',
      PUBLIC_PACKAGE_EGRESS_ACTIVATION_READY: 'true',
      PUBLIC_PACKAGE_EGRESS_STAGING_GATE_ID: 'staging-gate-2026-07-17',
      PUBLIC_PACKAGE_EGRESS_SNAPSHOT_ROWS: '3',
      PUBLIC_PACKAGE_EGRESS_GATE_PASS_SNAPSHOTS: '3',
      PUBLIC_PACKAGE_EGRESS_FRESH_PROOFS: '6',
      PUBLIC_PACKAGE_EGRESS_PROJECTION_COVERAGE: '100',
      PUBLIC_PACKAGE_EGRESS_ACTIVE_POLLUTION: '0',
      PUBLIC_PACKAGE_EGRESS_EXTERNAL_RAW_FALLBACK: '0',
      PUBLIC_PACKAGE_EGRESS_BLOCKED_EXPOSURE: '0',
    })).toMatchObject({
      status: 'pass',
      mode: 'enforced',
      blockers: [],
    });
  });
});
