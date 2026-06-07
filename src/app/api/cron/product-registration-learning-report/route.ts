import { NextResponse, type NextRequest } from 'next/server';

import { withCronGuard } from '@/lib/cron-auth';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { loadProductRegistrationLearningReport } from '@/lib/product-registration/learning-engine-report';

export const dynamic = 'force-dynamic';

export const GET = withCronGuard(async (_request: NextRequest) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const report = await loadProductRegistrationLearningReport({
      supabase: supabaseAdmin,
      isSupabaseConfigured,
      since,
      limit: 1000,
      fullRegressionVerified: false,
    });

    return NextResponse.json({
      ok: true,
      generatedAt: report.generatedAt,
      source: 'product-registration-learning-report',
      summary: {
        eventsLoaded: report.window.eventsLoaded,
        eventsPersisted: report.micro.eventsPersisted,
        macroShouldRun: report.macro.shouldRun,
        macroRunReasons: report.macro.runReasons,
        candidates: report.macro.candidates.length,
        promotionReadyCandidates: report.macro.candidates.filter(candidate => candidate.promotionReady).length,
        promotionWorkItems: report.promotion.workItems.length,
        score: report.score,
        nextAction: report.nextAction,
      },
      safety: report.safety,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        source: 'product-registration-learning-report',
        error: error instanceof Error ? error.message : 'product registration learning report failed',
        nextAction: 'Check improvement ledger migration, service-role access, and macro mining input shape.',
        safety: {
          readOnly: true,
          productionMutation: false,
          rawTextStored: false,
          promotionRequiresReview: true,
        },
      },
      { status: 503 },
    );
  }
});
