/**
 * 2026-05-20 박제 (ERR-legacy-package-broken-sections):
 *   5/15 이전 옛 등록물의 7 도메인 (price_dates / hero / inclusions / excludes / notices)
 *   결함을 backfill 로 일괄 정정하는 어드민 엔드포인트.
 *
 * 이미 박혀있는 인프라:
 *   - upload/route.ts G2 → 신규 등록 시 fire-and-forget backfill (force=false)
 *   - section-extractors.ts → audit 자동 정정 + dev/prod revalidate
 *
 * 누락된 경로 (이 엔드포인트):
 *   - 옛 등록물에 대한 ad-hoc 재추출 트리거 (어드민 버튼 또는 cron rescue)
 *   - force=true 옵션 (깨진 inclusions/excludes 통째 재추출)
 *
 * 사용:
 *   curl -X POST -H "x-admin-token: $ADMIN_API_TOKEN" \
 *     -H "Content-Type: application/json" \
 *     -d '{"force":true}' \
 *     http://localhost:3000/api/admin/packages/<id>/backfill-sections
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = withAdminGuard(async (req: NextRequest, ctx?: { params?: Promise<{ id: string }> }) => {
  const params = await ctx?.params;
  const packageId = params?.id;
  if (!packageId) return NextResponse.json({ error: 'missing_id' }, { status: 400 });

  let body: { force?: boolean; refreshOnly?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  const { backfillSectionsByPackageId, refreshAuditAfterBackfill } = await import('@/lib/parser/llm/section-extractors');
  const { revalidatePackagePaths } = await import('@/lib/revalidate-helper');

  // refreshOnly: backfill skip, audit 재계산 + revalidate 만 (수동 DB UPDATE 후 동기화용)
  if (body.refreshOnly === true) {
    await refreshAuditAfterBackfill(packageId);
    try { await revalidatePackagePaths(packageId, { alsoServerContext: true }); } catch { /* no-op */ }
    return NextResponse.json({ ok: true, refreshedOnly: true });
  }

  const result = await backfillSectionsByPackageId(packageId, { force: body.force === true });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
});
