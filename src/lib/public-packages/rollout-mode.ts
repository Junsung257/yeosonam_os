export const PUBLIC_PACKAGE_EGRESS_MODES = ['legacy', 'shadow', 'canary', 'enforced'] as const;
export type PublicPackageEgressMode = typeof PUBLIC_PACKAGE_EGRESS_MODES[number];

export const CANARY_FAILURE_POLICIES = ['fallback_legacy', 'fail_closed'] as const;
export type PublicPackageCanaryFailurePolicy = typeof CANARY_FAILURE_POLICIES[number];

export type PublicPackageRolloutEnv = Partial<Record<string, string | undefined>>;

export type PublicPackageRolloutDecision = {
  mode: PublicPackageEgressMode;
  requestedMode: string | null;
  defaulted: boolean;
  canUseCustomerProjection: boolean;
  canWriteShadowDiffs: boolean;
  requiresActivationEvidence: boolean;
  canaryPackageIds: string[];
  canaryFailurePolicy: PublicPackageCanaryFailurePolicy;
};

function normalizeMode(value: string | undefined): PublicPackageEgressMode | null {
  const normalized = value?.trim().toLowerCase();
  return PUBLIC_PACKAGE_EGRESS_MODES.includes(normalized as PublicPackageEgressMode)
    ? normalized as PublicPackageEgressMode
    : null;
}

function normalizeCanaryFailurePolicy(value: string | undefined): PublicPackageCanaryFailurePolicy {
  const normalized = value?.trim().toLowerCase();
  return CANARY_FAILURE_POLICIES.includes(normalized as PublicPackageCanaryFailurePolicy)
    ? normalized as PublicPackageCanaryFailurePolicy
    : 'fallback_legacy';
}

function parseCanaryPackageIds(value: string | undefined): string[] {
  return [...new Set(
    (value ?? '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean),
  )];
}

export function resolvePublicPackageEgressMode(
  env: PublicPackageRolloutEnv = process.env,
): PublicPackageRolloutDecision {
  const requestedMode = env.PUBLIC_PACKAGE_EGRESS_MODE?.trim() || null;
  const mode = normalizeMode(requestedMode ?? undefined) ?? 'legacy';
  const defaulted = mode === 'legacy' && requestedMode !== 'legacy';
  const canaryPackageIds = parseCanaryPackageIds(env.PUBLIC_PACKAGE_EGRESS_CANARY_PACKAGE_IDS);
  const canaryFailurePolicy = normalizeCanaryFailurePolicy(env.PUBLIC_PACKAGE_EGRESS_CANARY_FAILURE_POLICY);

  return {
    mode,
    requestedMode,
    defaulted,
    canUseCustomerProjection: mode === 'canary' || mode === 'enforced',
    canWriteShadowDiffs: mode === 'shadow' || mode === 'canary' || mode === 'enforced',
    requiresActivationEvidence: mode === 'enforced',
    canaryPackageIds,
    canaryFailurePolicy,
  };
}

export function isPublicPackageCanaryAllowed(
  packageId: string,
  env: PublicPackageRolloutEnv = process.env,
): boolean {
  const decision = resolvePublicPackageEgressMode(env);
  return decision.mode === 'canary' && decision.canaryPackageIds.includes(packageId);
}

function positiveInteger(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function zeroInteger(value: string | undefined): boolean {
  return Number(value) === 0;
}

function coverageIsComplete(value: string | undefined): boolean {
  return Number(value) >= 100;
}

export type PublicPackageActivationCheck = {
  status: 'pass' | 'block';
  mode: PublicPackageEgressMode;
  blockers: string[];
};

export function evaluatePublicPackageActivationReadiness(
  env: PublicPackageRolloutEnv = process.env,
): PublicPackageActivationCheck {
  const decision = resolvePublicPackageEgressMode(env);
  const blockers: string[] = [];

  if (decision.mode === 'canary' && decision.canaryPackageIds.length === 0) {
    blockers.push('canary mode requires PUBLIC_PACKAGE_EGRESS_CANARY_PACKAGE_IDS');
  }

  if (decision.mode === 'enforced') {
    if (env.PUBLIC_PACKAGE_EGRESS_ACTIVATION_READY !== 'true') {
      blockers.push('PUBLIC_PACKAGE_EGRESS_ACTIVATION_READY must be true');
    }
    if (!env.PUBLIC_PACKAGE_EGRESS_STAGING_GATE_ID?.trim()) {
      blockers.push('PUBLIC_PACKAGE_EGRESS_STAGING_GATE_ID is required');
    }
    if (!env.PUBLIC_PACKAGE_EGRESS_STAGING_GATE_EVIDENCE?.trim()) {
      blockers.push('PUBLIC_PACKAGE_EGRESS_STAGING_GATE_EVIDENCE is required');
    }
    if (positiveInteger(env.PUBLIC_PACKAGE_EGRESS_SNAPSHOT_ROWS) === 0) {
      blockers.push('snapshot rows must be greater than 0');
    }
    if (positiveInteger(env.PUBLIC_PACKAGE_EGRESS_GATE_PASS_SNAPSHOTS) === 0) {
      blockers.push('gate-pass snapshots must be greater than 0');
    }
    if (positiveInteger(env.PUBLIC_PACKAGE_EGRESS_FRESH_PROOFS) === 0) {
      blockers.push('fresh exact proofs must be greater than 0');
    }
    if (!coverageIsComplete(env.PUBLIC_PACKAGE_EGRESS_PROJECTION_COVERAGE)) {
      blockers.push('projection coverage must be 100');
    }
    if (!zeroInteger(env.PUBLIC_PACKAGE_EGRESS_ACTIVE_POLLUTION)) {
      blockers.push('active unresolved pollution must be 0');
    }
    if (!zeroInteger(env.PUBLIC_PACKAGE_EGRESS_EXTERNAL_RAW_FALLBACK)) {
      blockers.push('external raw fallback must be 0');
    }
    if (!zeroInteger(env.PUBLIC_PACKAGE_EGRESS_BLOCKED_EXPOSURE)) {
      blockers.push('blocked external exposure must be 0');
    }
  }

  return {
    status: blockers.length === 0 ? 'pass' : 'block',
    mode: decision.mode,
    blockers,
  };
}
