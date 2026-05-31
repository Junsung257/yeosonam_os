import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { runUploadVerify } from '@/lib/upload-verify';

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const { packageId } = await request.json();
    if (!packageId) return NextResponse.json({ error: 'packageId 필요' }, { status: 400 });

    const result = await runUploadVerify(packageId);
    if (!result) return NextResponse.json({ error: '검증 실패 — 상품 없음 또는 DB 오류' }, { status: 404 });

    const { data: latestLog } = await supabaseAdmin
      .from('ai_quality_log')
      .select('failed_checks')
      .eq('package_id', packageId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const qualityChecks = Array.isArray((latestLog as { failed_checks?: unknown[] } | null)?.failed_checks)
      ? ((latestLog as { failed_checks: Array<{ id?: string; severity?: string; message?: string; passed?: boolean }> }).failed_checks)
      : [];
    const failedQualityChecks = qualityChecks.filter(c => c && c.passed === false);
    if (failedQualityChecks.length === 0) return NextResponse.json(result);

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

    return NextResponse.json({
      ...result,
      checks,
      warnCount,
      failCount,
      status: failCount > 0 ? 'blocked' : warnCount > 0 ? 'warnings' : result.status,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '검증 실패' },
      { status: 500 },
    );
  }
};

export const POST = withAdminGuard(postHandler);
