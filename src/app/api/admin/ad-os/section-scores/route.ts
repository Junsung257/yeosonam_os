import { NextRequest, NextResponse } from 'next/server';
import {
  buildMarketingSectionScores,
  summarizeScoreGate,
  AD_OS_SOURCE_LEDGER_TARGET,
} from '@/lib/ad-os-ai-director';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { withTimeout } from '@/lib/promise-timeout';
import { fetchAdOsSummaryJson } from '../_lib/summary-fetch';

export const dynamic = 'force-dynamic';

const SECTION_SCORE_TIMEOUT_MS = 10000;

async function getSourceLedgerCount(): Promise<number> {
  if (!isSupabaseAdminConfigured) return 0;
  try {
    const { count, error } = await supabaseAdmin
      .from('ad_os_source_ledger')
      .select('id', { count: 'exact', head: true });
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

export const GET = withAdminGuard(async (request: NextRequest) => {
  try {
    const [summary, sourceCount] = await withTimeout(
      Promise.all([fetchAdOsSummaryJson(request), getSourceLedgerCount()]),
      SECTION_SCORE_TIMEOUT_MS,
      'ad os section scores',
    );
    const sectionScores = buildMarketingSectionScores(summary, sourceCount);
    return NextResponse.json({
      ok: true,
      generated_at: new Date().toISOString(),
      source_ledger: {
        current_sources: sourceCount,
        target_sources: AD_OS_SOURCE_LEDGER_TARGET,
        ready: sourceCount >= AD_OS_SOURCE_LEDGER_TARGET,
      },
      score_gate: summarizeScoreGate(sectionScores),
      section_scores: sectionScores,
      safety: {
        read_only: true,
        database_mutation: false,
        external_api_write: false,
        live_spend_krw: 0,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: 'blocked',
        error: error instanceof Error ? error.message : 'section scores unavailable',
        section_scores: [],
        safety: {
          read_only: true,
          database_mutation: false,
          external_api_write: false,
          live_spend_krw: 0,
        },
      },
      { status: 503 },
    );
  }
});
