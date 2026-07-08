export type CustomerMobileProof = {
  status?: string | null;
  checked_at?: string | null;
  package_updated_at?: string | null;
  source?: string | null;
  screen_hash?: string | null;
  customer_visible_hash?: string | null;
  surfaces?: string[] | null;
  surface_results?: Array<{
    surface?: string | null;
    status?: string | null;
    screen_hash?: string | null;
    customer_visible_hash?: string | null;
    checks?: Array<{
      name?: string | null;
      ok?: boolean | null;
      detail?: string | null;
    }> | null;
  }> | null;
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

function extractSurfaceResults(value: unknown): NonNullable<CustomerMobileProof['surface_results']> | null {
  if (!Array.isArray(value)) return null;
  const results: NonNullable<CustomerMobileProof['surface_results']> = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const rawChecks = Array.isArray(record.checks) ? record.checks : [];
    results.push({
      surface: asString(record.surface),
      status: asString(record.status),
      screen_hash: asString(record.screen_hash),
      customer_visible_hash: asString(record.customer_visible_hash),
      checks: rawChecks
        .map(check => {
          const checkRecord = asRecord(check);
          if (!checkRecord) return null;
          return {
            name: asString(checkRecord.name),
            ok: typeof checkRecord.ok === 'boolean' ? checkRecord.ok : null,
            detail: asString(checkRecord.detail),
          };
        })
        .filter((check): check is { name: string | null; ok: boolean | null; detail: string | null } => Boolean(check)),
    });
  }
  return results;
}

const REQUIRED_PROOF_CHECKS_BY_SURFACE: Record<string, string[]> = {
  packages: [
    'packages_reservation_cta_visible',
    'packages_reservation_sheet_opens',
    'packages_reservation_sheet_has_product_context',
  ],
  lp: [
    'lp_lead_cta_visible',
    'lp_lead_sheet_opens',
    'lp_lead_sheet_has_customer_copy',
  ],
};

function missingRequiredProofChecks(
  surface: string,
  surfaceResult: NonNullable<CustomerMobileProof['surface_results']>[number],
): string[] {
  const checks = new Map((surfaceResult.checks ?? [])
    .filter(check => check.name)
    .map(check => [check.name as string, check.ok === true]));
  return (REQUIRED_PROOF_CHECKS_BY_SURFACE[surface] ?? [])
    .filter(name => checks.get(name) !== true);
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function isAuditOnlyProofStaleness(input: {
  auditReport: unknown;
  packageUpdatedAt: string;
  proof: CustomerMobileProof;
}): boolean {
  const report = asRecord(input.auditReport);
  const autopilot = asRecord(report?.upload_to_open_autopilot);
  const reasons = Array.isArray(autopilot?.reasons)
    ? autopilot.reasons.map(item => String(item ?? ''))
    : [];
  const staleOnlyPreviousAutopilotBlock = reasons.length > 0 && reasons.every(reason =>
    /mobile_proof:actual \/packages mobile browser proof is stale|quality_scorecard:(?:packages_mobile|lp_mobile): actual \/packages mobile browser proof is stale/.test(reason)
  );
  const autopilotCheckedAt = parseTime(asString(autopilot?.checked_at));
  const packageUpdatedAt = parseTime(input.packageUpdatedAt);
  const proofCheckedAt = parseTime(input.proof.checked_at);
  const proofPackageUpdatedAt = parseTime(input.proof.package_updated_at);
  if (!autopilotCheckedAt || !packageUpdatedAt || !proofCheckedAt || !proofPackageUpdatedAt) return false;
  if (proofCheckedAt < proofPackageUpdatedAt) return false;
  return staleOnlyPreviousAutopilotBlock || Math.abs(packageUpdatedAt - autopilotCheckedAt) <= 5000;
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
    source: asString(rawProof.source),
    screen_hash: asString(rawProof.screen_hash),
    customer_visible_hash: asString(rawProof.customer_visible_hash),
    surfaces: asStringArray(rawProof.surfaces),
    surface_results: extractSurfaceResults(rawProof.surface_results),
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
  if (proof.source !== 'hwp-mobile-browser-proof') {
    return {
      ok: false,
      reason: `actual customer mobile browser proof source is ${proof.source ?? 'missing'}`,
      proof,
    };
  }
  if (!proof.screen_hash || !proof.customer_visible_hash) {
    return {
      ok: false,
      reason: 'actual customer mobile browser proof hashes are missing',
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
  const surfaces = new Set(proof.surfaces ?? []);
  const surfaceResultByName = new Map<string, NonNullable<CustomerMobileProof['surface_results']>[number]>();
  for (const surfaceResult of proof.surface_results ?? []) {
    if (surfaceResult.surface) surfaces.add(surfaceResult.surface);
    if (surfaceResult.surface) surfaceResultByName.set(surfaceResult.surface, surfaceResult);
    if (surfaceResult.status && surfaceResult.status !== 'pass') {
      return {
        ok: false,
        reason: `actual customer mobile browser proof ${surfaceResult.surface ?? 'surface'} status is ${surfaceResult.status}`,
        proof,
      };
    }
    if (!surfaceResult.screen_hash || !surfaceResult.customer_visible_hash) {
      return {
        ok: false,
        reason: `actual customer mobile browser proof ${surfaceResult.surface ?? 'surface'} hashes are missing`,
        proof,
      };
    }
  }
  if (!surfaces.has('lp')) {
    return {
      ok: false,
      reason: 'actual customer mobile browser proof did not include the lp surface',
      proof,
    };
  }
  for (const requiredSurface of ['packages', 'lp']) {
    const surfaceResult = surfaceResultByName.get(requiredSurface);
    if (!surfaceResult) {
      return {
        ok: false,
        reason: `actual customer mobile browser proof ${requiredSurface} surface result is missing`,
        proof,
      };
    }
    if (surfaceResult.status !== 'pass') {
      return {
        ok: false,
        reason: `actual customer mobile browser proof ${requiredSurface} status is ${surfaceResult.status ?? 'missing'}`,
        proof,
      };
    }
    if (!surfaceResult.screen_hash || !surfaceResult.customer_visible_hash) {
      return {
        ok: false,
        reason: `actual customer mobile browser proof ${requiredSurface} hashes are missing`,
        proof,
      };
    }
    const missingChecks = missingRequiredProofChecks(requiredSurface, surfaceResult);
    if (missingChecks.length > 0) {
      return {
        ok: false,
        reason: `actual customer mobile browser proof ${requiredSurface} CTA checks are missing or failed: ${missingChecks.join(', ')}`,
        proof,
      };
    }
  }
  const packageUpdatedAt = input.packageUpdatedAt?.trim();
  if (packageUpdatedAt && proof.package_updated_at && proof.package_updated_at !== packageUpdatedAt) {
    if (isAuditOnlyProofStaleness({ auditReport: input.auditReport, packageUpdatedAt, proof })) {
      return { ok: true, reason: 'actual /packages and /lp mobile browser proof passed', proof };
    }
    return {
      ok: false,
      reason: 'actual /packages mobile browser proof is stale for the current saved package row',
      proof,
    };
  }
  return { ok: true, reason: 'actual /packages and /lp mobile browser proof passed', proof };
}
