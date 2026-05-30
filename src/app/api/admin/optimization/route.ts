import { type NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { withCronGuard } from '@/lib/cron-auth';
import { loadKeywords } from '@/lib/keyword-brain';
import { runDailyOptimization, isOverDailyLimit, emergencyBudgetPause } from '@/lib/optimization-loop';

export const dynamic = 'force-dynamic';

async function postHandler(_request: NextRequest) {
  try {
    const keywords = loadKeywords();
    if (keywords.length === 0) {
      return NextResponse.json({
        status: 'skipped',
        reason: 'No keywords loaded',
      });
    }

    const totalSpend = keywords.reduce((sum, keyword) => sum + keyword.spend, 0);
    if (isOverDailyLimit(totalSpend)) {
      await emergencyBudgetPause(keywords);
      return NextResponse.json({
        status: 'budget_pause',
        totalSpend,
        message: 'Daily budget exceeded. Paused risky keywords.',
      });
    }

    const result = await runDailyOptimization(keywords);
    return NextResponse.json({
      status: 'completed',
      ...result,
    });
  } catch (err) {
    console.error('[api/admin/optimization] failed:', err);
    return NextResponse.json(
      {
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

async function getHandler(_request: NextRequest) {
  return NextResponse.json({
    service: 'keyword-optimization-loop',
    version: 'phase-1',
    description: 'Runs daily search-term collection, negative keyword expansion, and bid optimization.',
    cronSchedule: '0 6 * * *',
  });
}

export const POST = withCronGuard(postHandler);
export const GET = withAdminGuard(getHandler);
