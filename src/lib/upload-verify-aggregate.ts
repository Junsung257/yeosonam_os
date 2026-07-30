import type { VerifyCheck, VerifyResult } from '@/lib/upload-verify';
import {
  buildRegistrationRemediationPlan,
  type RegistrationRemediationPlan,
} from '@/lib/product-registration/operator-remediation';

type UploadVerifyUiStatus = VerifyResult['status'] | 'error';

export type UploadVerifyPackageResult = {
  packageId: string;
  status: UploadVerifyUiStatus;
  checks: VerifyCheck[];
  fixable: string[];
  passCount: number;
  warnCount: number;
  failCount: number;
  remediation: RegistrationRemediationPlan;
  error?: string;
};

export type UploadVerifyAggregateResult = {
  status: UploadVerifyUiStatus;
  checks: VerifyCheck[];
  fixable: string[];
  passCount: number;
  warnCount: number;
  failCount: number;
  remediation: RegistrationRemediationPlan;
  packageResults: UploadVerifyPackageResult[];
};

export function toUploadVerifyPackageResult(
  packageId: string,
  result: VerifyResult,
): UploadVerifyPackageResult {
  return {
    packageId,
    status: result.status,
    checks: result.checks,
    fixable: result.fixable,
    passCount: result.passCount,
    warnCount: result.warnCount,
    failCount: result.failCount,
    remediation: buildRegistrationRemediationPlan(result.checks),
  };
}

export function uploadVerifyErrorResult(
  packageId: string,
  error: string,
): UploadVerifyPackageResult {
  const checks: VerifyCheck[] = [
    {
      id: 'upload_verify_error',
      label: '검증 오류',
      status: 'fail',
      detail: error,
    },
  ];
  return {
    packageId,
    status: 'error',
    checks,
    fixable: [],
    passCount: 0,
    warnCount: 0,
    failCount: 1,
    remediation: buildRegistrationRemediationPlan(checks),
    error,
  };
}

export function aggregateUploadVerifyResults(
  packageResults: UploadVerifyPackageResult[],
): UploadVerifyAggregateResult {
  const checks = packageResults.flatMap(result =>
    result.checks.map(check => ({
      ...check,
      id: `${result.packageId}:${check.id}`,
    })),
  );
  const fixable = [...new Set(packageResults.flatMap(result => result.fixable))];
  const passCount = packageResults.reduce((sum, result) => sum + result.passCount, 0);
  const warnCount = packageResults.reduce((sum, result) => sum + result.warnCount, 0);
  const failCount = packageResults.reduce((sum, result) => sum + result.failCount, 0);
  const remediation = buildRegistrationRemediationPlan(checks);

  const status: UploadVerifyUiStatus =
    packageResults.some(result => result.status === 'blocked')
      ? 'blocked'
      : packageResults.some(result => result.status === 'error')
        ? 'error'
        : packageResults.some(result => result.status === 'warnings')
          ? 'warnings'
          : packageResults.length > 0 && packageResults.every(result => result.status === 'skipped')
            ? 'skipped'
            : 'clean';

  return {
    status,
    checks,
    fixable,
    passCount,
    warnCount,
    failCount,
    remediation,
    packageResults,
  };
}
