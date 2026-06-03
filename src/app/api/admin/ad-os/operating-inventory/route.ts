import { NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { buildAdOsOperatingInventory } from '@/lib/ad-os-v581-v600';
import { buildAdOsStagingSmokeSummary } from '@/lib/ad-os-v541-v560';
import { withTimeout } from '@/lib/promise-timeout';
import { buildSummaryResponse } from '../summary/route';

export const dynamic = 'force-dynamic';
const AD_OS_OPERATING_INVENTORY_TIMEOUT_MS = 8000;

export const GET = withAdminGuard(async () => {
  try {
    const summaryResponse = await withTimeout(
      buildSummaryResponse(),
      AD_OS_OPERATING_INVENTORY_TIMEOUT_MS,
      'ad os operating inventory',
    );
    const summary = await summaryResponse.json();
    const inventory = buildAdOsOperatingInventory({
      completionAudit: summary?.enterprise_layer?.completion_audit || null,
      stagingSmoke: buildAdOsStagingSmokeSummary(),
      enterpriseLayer: summary?.enterprise_layer || null,
      learningLoop: summary?.learning_loop || null,
    });

    return NextResponse.json({
      ok: true,
      generated_at: summary.generated_at || new Date().toISOString(),
      inventory,
      summary: {
        status: inventory.status,
        readiness_score: inventory.readiness_score,
        operational: inventory.operational,
        partial: inventory.partial,
        blocked: inventory.blocked,
        top_gap: inventory.top_gap,
        next_action: inventory.next_action,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: 'blocked',
        error: error instanceof Error ? error.message : 'operating inventory unavailable',
        next_action: 'Recover /api/admin/ad-os/summary before using the Ad OS operating inventory.',
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
