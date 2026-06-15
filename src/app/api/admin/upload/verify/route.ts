import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { runUploadVerify, type VerifyResult } from '@/lib/upload-verify';
import {
  aggregateUploadVerifyResults,
  toUploadVerifyPackageResult,
  uploadVerifyErrorResult,
  type UploadVerifyPackageResult,
} from '@/lib/upload-verify-aggregate';

type UploadVerifyRequestBody = {
  packageId?: unknown;
  packageIds?: unknown;
};

type QualityFailedCheck = {
  id?: string;
  severity?: string;
  message?: string;
  passed?: boolean;
};

const MAX_VERIFY_PACKAGE_IDS = 50;

function normalizePackageIds(body: UploadVerifyRequestBody): string[] {
  const rawIds = Array.isArray(body.packageIds) ? body.packageIds : [body.packageId];
  return [...new Set(
    rawIds
      .filter((value): value is string => typeof value === 'string')
      .map(value => value.trim())
      .filter(Boolean),
  )];
}

async function mergeQualityLogChecks(packageId: string, result: VerifyResult): Promise<VerifyResult> {
  const { data: latestLog } = await supabaseAdmin
    .from('ai_quality_log')
    .select('failed_checks')
    .eq('package_id', packageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const qualityChecks = Array.isArray((latestLog as { failed_checks?: unknown[] } | null)?.failed_checks)
    ? ((latestLog as { failed_checks: QualityFailedCheck[] }).failed_checks)
    : [];
  const failedQualityChecks = qualityChecks.filter(c => c && c.passed === false);
  if (failedQualityChecks.length === 0) return result;

  const existingIds = new Set(result.checks.map(c => c.id));
  const mergedQualityChecks = failedQualityChecks
    .filter(c => !existingIds.has(`quality_${c.id ?? 'unknown'}`))
    .map(c => ({
      id: `quality_${c.id ?? 'unknown'}`,
      label: '품질 로그',
      status: c.severity === 'critical' ? 'fail' as const : 'warn' as const,
      detail: c.message ?? c.id ?? '품질 로그 경고',
    }));

  const checks = [...result.checks, ...mergedQualityChecks];
  const warnCount = checks.filter(c => c.status === 'warn').length;
  const failCount = checks.filter(c => c.status === 'fail').length;

  return {
    ...result,
    checks,
    warnCount,
    failCount,
    status: failCount > 0 ? 'blocked' : warnCount > 0 ? 'warnings' : result.status,
  };
}

async function verifyOnePackage(packageId: string): Promise<UploadVerifyPackageResult> {
  try {
    const result = await runUploadVerify(packageId);
    if (!result) {
      return uploadVerifyErrorResult(packageId, '검증 실패 - 상품 없음 또는 DB 오류');
    }

    const mergedResult = await mergeQualityLogChecks(packageId, result);
    return toUploadVerifyPackageResult(packageId, mergedResult);
  } catch (error) {
    return uploadVerifyErrorResult(
      packageId,
      error instanceof Error ? `검증 실패 - ${error.message}` : '검증 실패 - 알 수 없는 오류',
    );
  }
}

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json() as UploadVerifyRequestBody;
    const packageIds = normalizePackageIds(body);
    if (packageIds.length === 0) return NextResponse.json({ error: 'packageId 또는 packageIds 필요' }, { status: 400 });
    if (packageIds.length > MAX_VERIFY_PACKAGE_IDS) {
      return NextResponse.json(
        { error: `한 번에 검증 가능한 상품은 최대 ${MAX_VERIFY_PACKAGE_IDS}개입니다.` },
        { status: 413 },
      );
    }

    const packageResults = await Promise.all(packageIds.map(verifyOnePackage));
    const aggregate = aggregateUploadVerifyResults(packageResults);

    if (packageIds.length === 1) {
      const [single] = packageResults;
      if (single.status === 'error') return NextResponse.json({ error: single.error, packageResults }, { status: 404 });
      return NextResponse.json({
        ...single,
        packageResults,
      });
    }

    return NextResponse.json({
      ...aggregate,
      ok: aggregate.status !== 'blocked' && aggregate.status !== 'error',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '검증 실패' },
      { status: 500 },
    );
  }
};

export const POST = withAdminGuard(postHandler);
