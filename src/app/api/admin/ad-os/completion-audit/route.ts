import { NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { withTimeout } from '@/lib/promise-timeout';
import { buildSummaryResponse } from '../summary/route';

export const dynamic = 'force-dynamic';
const AD_OS_COMPLETION_AUDIT_TIMEOUT_MS = 8000;

export const GET = withAdminGuard(async () => {
  try {
    const summaryResponse = await withTimeout(
      buildSummaryResponse(),
      AD_OS_COMPLETION_AUDIT_TIMEOUT_MS,
      'ad os completion audit',
    );
    const summary = await summaryResponse.json();
    const audit = summary?.enterprise_layer?.completion_audit;

    if (!audit) {
      return NextResponse.json(
        {
          ok: false,
          status: 'blocked',
          error: 'completion audit unavailable',
          next_action: 'Run /api/admin/ad-os/summary and inspect enterprise_layer.completion_audit.',
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
        status: 'blocked',
        error: error instanceof Error ? error.message : 'completion audit unavailable',
        next_action: 'Recover the Ad OS summary data plane before using completion audit in monitors.',
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
