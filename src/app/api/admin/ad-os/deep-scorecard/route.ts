import { NextRequest, NextResponse } from 'next/server';
import { buildMarketingDeepScorecard } from '@/lib/marketing-deep-scorecard';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { withTimeout } from '@/lib/promise-timeout';
import { fetchAdOsSummaryJson } from '../_lib/summary-fetch';

export const dynamic = 'force-dynamic';

const DEEP_SCORECARD_TIMEOUT_MS = 12000;

async function getReviewedSourceCount(): Promise<number> {
  if (!isSupabaseAdminConfigured) return 0;
  try {
    const { count, error } = await supabaseAdmin
      .from('ad_os_source_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'accepted');
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

export const GET = withAdminGuard(async (request: NextRequest) => {
  try {
    const [summary, sourceLedgerCount] = await withTimeout(
      Promise.all([fetchAdOsSummaryJson(request), getReviewedSourceCount()]),
      DEEP_SCORECARD_TIMEOUT_MS,
      'marketing deep scorecard',
    );
    const scorecard = buildMarketingDeepScorecard({ summary, sourceLedgerCount });
    return NextResponse.json(scorecard);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: 'blocked',
        error: error instanceof Error ? error.message : 'Marketing deep scorecard unavailable.',
        safety: {
          read_only: true,
          database_mutation: false,
          external_api_write: false,
          live_spend_krw: 0,
          full_auto_allowed: false,
        },
      },
      { status: 503 },
    );
  }
});
