import { NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { buildSummaryResponse } from '../summary/route';

export const dynamic = 'force-dynamic';

export const GET = withAdminGuard(async () => {
  try {
    const summaryResponse = await buildSummaryResponse();
    const summary = await summaryResponse.json();
    const audit = summary?.enterprise_layer?.completion_audit;

    if (!audit) {
      return NextResponse.json(
        {
          ok: false,
          error: 'completion audit unavailable',
          safety: {
            read_only: true,
            external_api_write: false,
            database_mutation: false,
          },
        },
        { status: 503 },
      );
    }

    const requirements = Array.isArray(audit.requirements) ? audit.requirements : [];
    return NextResponse.json({
      ok: true,
      generated_at: summary.generated_at || new Date().toISOString(),
      audit,
      summary: {
        status: audit.status,
        readiness_score: audit.readiness_score,
        passed: audit.passed,
        warnings: audit.warnings,
        failed: audit.failed,
        top_blocker: audit.top_blocker,
        next_action: audit.next_action,
      },
      failed_requirements: requirements.filter((row: { status?: string }) => row.status === 'fail'),
      warning_requirements: requirements.filter((row: { status?: string }) => row.status === 'warn'),
      safety: {
        read_only: true,
        external_api_write: false,
        database_mutation: false,
        source: '/api/admin/ad-os/summary enterprise_layer.completion_audit',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'completion audit unavailable',
        safety: {
          read_only: true,
          external_api_write: false,
          database_mutation: false,
        },
      },
      { status: 503 },
    );
  }
});
