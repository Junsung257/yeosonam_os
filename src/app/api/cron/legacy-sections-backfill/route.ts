/**
 * B5 — 옛 등록물 section backfill 야간 cron (2026-05-20 감사 RC3).
 *
 * 매일 1회 price_dates=0 / excludes 콤마-split 깨짐 패키지 최대 30건 자동 backfill.
 * SSOT: `src/lib/legacy-sections-backfill-batch.ts` → backfillSectionsByPackageId
 *
 * GET /api/cron/legacy-sections-backfill
 * GET /api/cron/legacy-sections-backfill?dry=1  (후보 목록만)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCronGuard } from '@/lib/cron-auth';
import { runLegacySectionsBackfillBatch } from '@/lib/legacy-sections-backfill-batch';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const getHandler = async (request: NextRequest) => {
  const start = Date.now();
  const dry = request.nextUrl.searchParams.get('dry') === '1';

  try {
    const batch = await runLegacySectionsBackfillBatch({ dryRun: dry });
    return NextResponse.json({
      ...batch,
      ok: true,
      dryRun: dry,
      elapsed_ms: Date.now() - start,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'legacy-sections-backfill 실패',
        elapsed_ms: Date.now() - start,
      },
      { status: 500 },
    );
  }
};

export const GET = withCronGuard(getHandler);
