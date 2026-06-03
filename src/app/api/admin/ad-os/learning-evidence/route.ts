import { NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { buildAdOsLearningEvidence } from '@/lib/ad-os-v621-v640';
import { withTimeout } from '@/lib/promise-timeout';
import { buildSummaryResponse } from '../summary/route';

export const dynamic = 'force-dynamic';
const AD_OS_LEARNING_EVIDENCE_TIMEOUT_MS = 8000;

export const GET = withAdminGuard(async () => {
  try {
    const summaryResponse = await withTimeout(
      buildSummaryResponse(),
      AD_OS_LEARNING_EVIDENCE_TIMEOUT_MS,
      'ad os learning evidence',
    );
    const summary = await summaryResponse.json();
    const facts = Array.isArray(summary?.samples?.performance_facts)
      ? summary.samples.performance_facts
      : [];
    const evidence = buildAdOsLearningEvidence(facts);

    return NextResponse.json({
      ok: true,
      generated_at: summary.generated_at || new Date().toISOString(),
      evidence,
      summary: {
        status: evidence.status,
        readiness_score: evidence.readiness_score,
        facts: evidence.facts,
        missing_dimensions: evidence.missing_dimensions,
        candidates: evidence.candidates.length,
        next_action: evidence.next_action,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: 'blocked',
        error: error instanceof Error ? error.message : 'learning evidence unavailable',
        next_action: 'Recover /api/admin/ad-os/summary before evaluating learning evidence.',
        safety: {
          read_only: true,
          database_mutation: false,
          external_api_write: false,
        },
      },
      { status: 503 },
    );
  }
});
