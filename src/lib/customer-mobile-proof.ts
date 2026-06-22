export type CustomerMobileProof = {
  status?: string | null;
  checked_at?: string | null;
  package_updated_at?: string | null;
  surfaces?: string[] | null;
};

export type CustomerMobileProofResult = {
  ok: boolean;
  reason: string;
  proof: CustomerMobileProof | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] | null {
  return Array.isArray(value)
    ? value.map(item => String(item ?? '').trim()).filter(Boolean)
    : null;
}

export function extractCustomerMobileProof(auditReport: unknown): CustomerMobileProof | null {
  const report = asRecord(auditReport);
  if (!report) return null;
  const rawProof = asRecord(report.mobile_browser_proof)
    ?? asRecord(report.customer_mobile_proof)
    ?? asRecord(report.mobile_landing_proof);
  if (!rawProof) return null;
  return {
    status: asString(rawProof.status),
    checked_at: asString(rawProof.checked_at),
    package_updated_at: asString(rawProof.package_updated_at),
    surfaces: asStringArray(rawProof.surfaces),
  };
}

export function evaluateCustomerMobileProof(input: {
  auditReport: unknown;
  packageUpdatedAt?: string | null;
}): CustomerMobileProofResult {
  const proof = extractCustomerMobileProof(input.auditReport);
  if (!proof) {
    return {
      ok: false,
      reason: 'actual /packages mobile browser proof is missing',
      proof: null,
    };
  }
  if (proof.status !== 'pass') {
    return {
      ok: false,
      reason: `actual /packages mobile browser proof status is ${proof.status ?? 'missing'}`,
      proof,
    };
  }
  if (!proof.checked_at) {
    return {
      ok: false,
      reason: 'actual /packages mobile browser proof checked_at is missing',
      proof,
    };
  }
  if (!proof.surfaces?.includes('packages')) {
    return {
      ok: false,
      reason: 'actual /packages mobile browser proof did not include the packages surface',
      proof,
    };
  }
  const packageUpdatedAt = input.packageUpdatedAt?.trim();
  if (packageUpdatedAt && proof.package_updated_at && proof.package_updated_at !== packageUpdatedAt) {
    return {
      ok: false,
      reason: 'actual /packages mobile browser proof is stale for the current saved package row',
      proof,
    };
  }
  return { ok: true, reason: 'actual /packages mobile browser proof passed', proof };
}
