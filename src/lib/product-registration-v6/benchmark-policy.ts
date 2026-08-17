import type { RegistrationTermsPolicySnapshot } from '@/lib/standard-terms-client';
import { hasValidRegistrationTermsPolicyHash } from '@/lib/standard-terms';

export type ApprovedBenchmarkCancellationPolicy = RegistrationTermsPolicySnapshot & {
  approval: {
    source: 'operational_current_template';
    approvedAt: string;
    approvedBy: string;
  };
};

export function assertApprovedBenchmarkCancellationPolicy(
  value: unknown,
): asserts value is ApprovedBenchmarkCancellationPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('BENCHMARK_CANCELLATION_POLICY_SNAPSHOT_REQUIRED');
  }
  const snapshot = value as Partial<ApprovedBenchmarkCancellationPolicy>;
  if (snapshot.policy_version !== 'registration-terms-policy-v1' || snapshot.surface !== 'mobile') {
    throw new Error('BENCHMARK_CANCELLATION_POLICY_VERSION_INVALID');
  }
  if (!snapshot.has_cancellation_policy) {
    throw new Error('BENCHMARK_CANCELLATION_POLICY_COVERAGE_MISSING');
  }
  if (!Array.isArray(snapshot.notices) || snapshot.notices.length === 0
    || !Array.isArray(snapshot.template_refs) || snapshot.template_refs.length === 0) {
    throw new Error('BENCHMARK_CANCELLATION_POLICY_LINEAGE_MISSING');
  }
  if (!snapshot.approval
    || snapshot.approval.source !== 'operational_current_template'
    || !snapshot.approval.approvedAt
    || !snapshot.approval.approvedBy) {
    throw new Error('BENCHMARK_CANCELLATION_POLICY_APPROVAL_MISSING');
  }
  const { approval: _approval, ...policy } = snapshot;
  if (!hasValidRegistrationTermsPolicyHash(policy as RegistrationTermsPolicySnapshot)) {
    throw new Error('BENCHMARK_CANCELLATION_POLICY_HASH_MISMATCH');
  }
}

