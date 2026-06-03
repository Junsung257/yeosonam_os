import { buildDanangAdOsE2ESmoke } from '@/lib/ad-os-v301-v320';

export type AdOsStagingSmokeStatus = 'pass' | 'fail';

export type AdOsStagingSmokeSummary = {
  status: AdOsStagingSmokeStatus;
  passed_assertions: number;
  failed_assertions: number;
  next_action: string;
  counts: ReturnType<typeof buildDanangAdOsE2ESmoke>['counts'];
  assertions: ReturnType<typeof buildDanangAdOsE2ESmoke>['assertions'];
  evidence: {
    package_id: string;
    tenant_id: string;
    destination: string;
    platform_job_status: string;
    platform_job_type: string;
    conversion_upload_status: string;
    conversion_platform: string;
    external_api_write_zero: boolean;
  };
  safety: {
    read_only: true;
    external_api_write: false;
    database_mutation: false;
    fixture_only: true;
  };
};

export function buildAdOsStagingSmokeSummary(): AdOsStagingSmokeSummary {
  const smoke = buildDanangAdOsE2ESmoke();
  const assertionValues = Object.values(smoke.assertions);
  const failedAssertions = Object.entries(smoke.assertions)
    .filter(([, passed]) => !passed)
    .map(([key]) => key);

  return {
    status: failedAssertions.length === 0 ? 'pass' : 'fail',
    passed_assertions: assertionValues.filter(Boolean).length,
    failed_assertions: failedAssertions.length,
    next_action: failedAssertions.length === 0
      ? 'Staging smoke passes. Use this as a read-only regression gate before running DB-backed staging flows.'
      : `Fix failed smoke assertions before claiming Ad OS staging readiness: ${failedAssertions.join(', ')}`,
    counts: smoke.counts,
    assertions: smoke.assertions,
    evidence: {
      package_id: smoke.package.id,
      tenant_id: smoke.package.tenant_id || 'tenant-smoke',
      destination: smoke.package.destination || 'Danang',
      platform_job_status: smoke.platformJob.status,
      platform_job_type: smoke.platformJob.job_type,
      conversion_upload_status: smoke.conversionUploadJob.status,
      conversion_platform: smoke.conversionUploadJob.platform,
      external_api_write_zero: smoke.assertions.external_api_write_zero,
    },
    safety: {
      read_only: true,
      external_api_write: false,
      database_mutation: false,
      fixture_only: true,
    },
  };
}
