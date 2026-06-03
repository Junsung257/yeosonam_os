import type { AdOsOperatingInventory } from '@/lib/ad-os-v581-v600';
import type { LiveSpendPreflightResult } from '@/lib/ad-os-v601-v620';
import type { LearningEvidenceSummary } from '@/lib/ad-os-v621-v640';
import type { AdOsStagingSmokeSummary } from '@/lib/ad-os-v541-v560';

export type AdOsStagingValidationStatus = 'pass' | 'warn' | 'fail';
export type AdOsStagingValidationGate =
  | 'read_only_smoke'
  | 'db_backed_summary'
  | 'operating_inventory'
  | 'live_spend_preflight'
  | 'learning_evidence'
  | 'external_write_safety'
  | 'full_auto_safety';

export type AdOsStagingValidationCheck = {
  id: AdOsStagingValidationGate;
  label: string;
  status: AdOsStagingValidationStatus;
  evidence: string;
  next_action: string;
};

export type AdOsStagingValidationPackage = {
  status: AdOsStagingValidationStatus;
  readiness_score: number;
  passed: number;
  warnings: number;
  failed: number;
  checks: AdOsStagingValidationCheck[];
  gates: Record<AdOsStagingValidationGate, AdOsStagingValidationStatus>;
  top_blocker: string | null;
  next_action: string;
  safety: {
    read_only: true;
    database_mutation: false;
    external_api_write: false;
    live_spend_krw: 0;
    full_auto_allowed: false;
  };
};

type CompletionAuditLike = {
  status?: string | null;
  failed?: number | null;
  warnings?: number | null;
  passed?: number | null;
};

type EnterpriseLayerLike = {
  platform_job_queue?: { external_api_write_count?: number | null } | null;
  runtime_execution?: { external_api_write_count?: number | null } | null;
  channel_adapters?: { external_api_write_count?: number | null } | null;
  execution_gates?: { external_api_write_count?: number | null } | null;
  limited_write_pilot?: {
    external_api_write_count?: number | null;
    live_external_write_enabled?: number | null;
  } | null;
  saas_packaging?: { full_auto_enabled?: number | boolean | null } | null;
};

export type AdOsStagingValidationInput = {
  completionAudit?: CompletionAuditLike | null;
  stagingSmoke?: AdOsStagingSmokeSummary | null;
  operatingInventory?: AdOsOperatingInventory | null;
  liveSpendPreflight?: LiveSpendPreflightResult | null;
  learningEvidence?: LearningEvidenceSummary | null;
  enterpriseLayer?: EnterpriseLayerLike | null;
};

function numberValue(value: unknown): number {
  return Number(value || 0);
}

function booleanish(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return Number(value || 0) > 0;
}

function check(input: AdOsStagingValidationCheck): AdOsStagingValidationCheck {
  return input;
}

function summarizeStatus(checks: AdOsStagingValidationCheck[]): AdOsStagingValidationStatus {
  if (checks.some((row) => row.status === 'fail')) return 'fail';
  if (checks.some((row) => row.status === 'warn')) return 'warn';
  return 'pass';
}

function externalWriteCount(enterprise?: EnterpriseLayerLike | null): number {
  const layer = enterprise || {};
  return (
    numberValue(layer.platform_job_queue?.external_api_write_count) +
    numberValue(layer.runtime_execution?.external_api_write_count) +
    numberValue(layer.channel_adapters?.external_api_write_count) +
    numberValue(layer.execution_gates?.external_api_write_count) +
    numberValue(layer.limited_write_pilot?.external_api_write_count)
  );
}

export function buildAdOsStagingValidationPackage(
  input: AdOsStagingValidationInput,
): AdOsStagingValidationPackage {
  const completion = input.completionAudit;
  const smoke = input.stagingSmoke;
  const inventory = input.operatingInventory;
  const preflight = input.liveSpendPreflight;
  const learning = input.learningEvidence;
  const enterprise = input.enterpriseLayer || {};
  const writes = externalWriteCount(enterprise);
  const fullAutoEnabled =
    booleanish(enterprise.saas_packaging?.full_auto_enabled) ||
    Boolean(preflight?.safety.full_auto_allowed);
  const liveSpendAllowed = Boolean(preflight?.live_write_allowed);
  const liveSafetyClear = preflight
    ? preflight.live_write_allowed === false &&
      preflight.safety.external_api_write === false &&
      preflight.safety.live_spend_krw === 0 &&
      preflight.safety.full_auto_allowed === false
    : false;
  const smokeAssertionsTotal = numberValue(smoke?.passed_assertions) + numberValue(smoke?.failed_assertions);

  const checks = [
    check({
      id: 'read_only_smoke',
      label: 'Read-only staging smoke',
      status: smoke?.status === 'pass' && smoke.evidence.external_api_write_zero ? 'pass' : 'fail',
      evidence: `smoke ${smoke?.status || 'missing'}, assertions ${smoke?.passed_assertions || 0}/${smokeAssertionsTotal}, external writes ${smoke?.evidence.external_api_write_zero ? 0 : 1}`,
      next_action: smoke?.status === 'pass'
        ? 'Keep this smoke as the first staging check before DB-backed or platform dry-run checks.'
        : 'Recover the read-only Danang E2E smoke before staging validation is trusted.',
    }),
    check({
      id: 'db_backed_summary',
      label: 'DB-backed summary',
      status: completion ? numberValue(completion.failed) > 0 ? 'fail' : numberValue(completion.warnings) > 0 ? 'warn' : 'pass' : 'fail',
      evidence: `completion ${completion?.status || 'missing'}, failed ${numberValue(completion?.failed)}, warnings ${numberValue(completion?.warnings)}`,
      next_action: completion
        ? 'Use completion audit failures as the source of staging repair work.'
        : 'Recover /api/admin/ad-os/summary JSON before validating Ad OS runtime readiness.',
    }),
    check({
      id: 'operating_inventory',
      label: 'Operating inventory',
      status: inventory ? inventory.blocked > 0 ? 'warn' : inventory.partial > 0 ? 'warn' : 'pass' : 'fail',
      evidence: `inventory ${inventory?.status || 'missing'}, operational ${inventory?.operational || 0}, partial ${inventory?.partial || 0}, blocked ${inventory?.blocked || 0}`,
      next_action: inventory?.blocked
        ? inventory.next_action
        : 'Keep credentials, campaigns, budgets, tenants, jobs, conversion quality, and learning evidence visible in one operator flow.',
    }),
    check({
      id: 'live_spend_preflight',
      label: 'Live-spend preflight safety',
      status: liveSafetyClear ? 'pass' : 'fail',
      evidence: `preflight ${preflight?.status || 'missing'}, live write ${liveSpendAllowed ? 1 : 0}, blockers ${preflight?.blockers.length || 0}`,
      next_action: liveSafetyClear
        ? 'Treat blocked paid execution as a safety pass until a separately approved tenant budget pilot is enabled.'
        : 'Disable live writes and recover the guarded preflight before any external publisher action.',
    }),
    check({
      id: 'learning_evidence',
      label: 'Learning evidence',
      status: learning ? learning.status === 'ready' ? 'pass' : 'warn' : 'fail',
      evidence: `learning ${learning?.status || 'missing'}, facts ${learning?.facts || 0}, score ${learning?.readiness_score || 0}`,
      next_action: learning?.next_action || 'Recover learning evidence so CPA, ROAS, margin, CTA, bounce, and booking facts feed the approval queue.',
    }),
    check({
      id: 'external_write_safety',
      label: 'External write zero',
      status: writes === 0 && !liveSpendAllowed ? 'pass' : 'fail',
      evidence: `external writes ${writes}, live write allowed ${liveSpendAllowed ? 1 : 0}`,
      next_action: writes === 0 && !liveSpendAllowed
        ? 'Continue treating all platform work as read-only, draft, dry-run, or paused until explicit approvals pass.'
        : 'Stop staging validation and audit all platform write paths before continuing.',
    }),
    check({
      id: 'full_auto_safety',
      label: 'Full-auto disabled',
      status: fullAutoEnabled ? 'fail' : 'pass',
      evidence: `full auto enabled ${fullAutoEnabled ? 1 : 0}`,
      next_action: fullAutoEnabled
        ? 'Turn full auto off; keep recommend -> approve -> limited dry-run as the default operating mode.'
        : 'Keep full auto behind tenant policy, separate approval, experiment confidence, and kill-switch clearance.',
    }),
  ];
  const status = summarizeStatus(checks);
  const passed = checks.filter((row) => row.status === 'pass').length;
  const warnings = checks.filter((row) => row.status === 'warn').length;
  const failed = checks.filter((row) => row.status === 'fail').length;
  const readinessScore = Math.max(0, Math.min(100, Math.round((passed / checks.length) * 100 - warnings * 4 - failed * 10)));
  const topBlocker = checks.find((row) => row.status === 'fail') || checks.find((row) => row.status === 'warn') || null;

  return {
    status,
    readiness_score: readinessScore,
    passed,
    warnings,
    failed,
    checks,
    gates: checks.reduce<Record<AdOsStagingValidationGate, AdOsStagingValidationStatus>>((acc, row) => {
      acc[row.id] = row.status;
      return acc;
    }, {} as Record<AdOsStagingValidationGate, AdOsStagingValidationStatus>),
    top_blocker: topBlocker?.label || null,
    next_action: topBlocker?.next_action || 'Staging validation is clean. Continue with operator browser QA and merge gating.',
    safety: {
      read_only: true,
      database_mutation: false,
      external_api_write: false,
      live_spend_krw: 0,
      full_auto_allowed: false,
    },
  };
}
