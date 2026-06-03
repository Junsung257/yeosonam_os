import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { withCronGuard } from '@/lib/cron-auth';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { loadKeywords } from '@/lib/keyword-brain';
import { emergencyBudgetPause, isOverDailyLimit, runDailyOptimization } from '@/lib/optimization-loop';

export const dynamic = 'force-dynamic';

async function postHandler(_request: NextRequest) {
  try {
    const keywords = loadKeywords();
    if (keywords.length === 0) {
      return apiResponse({
        status: 'skipped',
        reason: 'No keywords loaded',
      });
    }

    const totalSpend = keywords.reduce((sum, keyword) => sum + keyword.spend, 0);
    if (isOverDailyLimit(totalSpend)) {
      await emergencyBudgetPause(keywords);
      return apiResponse({
        status: 'budget_pause',
        totalSpend,
        message: 'Daily budget exceeded. Paused risky keywords.',
      });
    }

    const result = await runDailyOptimization(keywords);
    return apiResponse({
      status: 'completed',
      ...result,
    });
  } catch (err) {
    console.error('[api/admin/optimization] failed:', err);
    return apiResponse(
      {
        status: 'error',
        error: sanitizeDbError(err),
      },
      { status: 500 },
    );
  }
}

async function getHandler(_request: NextRequest) {
  return apiResponse({
    service: 'keyword-optimization-loop',
    version: 'phase-1',
    description: 'Runs daily search-term collection, negative keyword expansion, and bid optimization.',
    cronSchedule: '0 6 * * *',
  });
}

export const POST = withCronGuard(postHandler);
export const GET = withAdminGuard(getHandler);
