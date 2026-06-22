import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { buildAdOsOperatingInventory } from '@/lib/ad-os-v581-v600';
import { buildAdOsStagingSmokeSummary } from '@/lib/ad-os-v541-v560';
import { withTimeout } from '@/lib/promise-timeout';
import { fetchAdOsSummaryJson } from '../_lib/summary-fetch';

export const dynamic = 'force-dynamic';
const AD_OS_OPERATING_INVENTORY_TIMEOUT_MS = 15000;

export const GET = withAdminGuard(async (request: NextRequest) => {
  try {
    const summary = await withTimeout(
      fetchAdOsSummaryJson(request),
      AD_OS_OPERATING_INVENTORY_TIMEOUT_MS,
      'ad os operating inventory',
    );
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
    const message = error instanceof Error ? error.message : 'operating inventory unavailable';
    return NextResponse.json({
      ok: true,
      generated_at: new Date().toISOString(),
      inventory: {
        status: 'blocked',
        readiness_score: 0,
        operational: 0,
        partial: 0,
        blocked: 1,
        top_gap: 'Operating inventory unavailable.',
        next_action: 'Recover /api/admin/ad-os/summary before using the Ad OS operating inventory.',
        items: [{
          id: 'operating_inventory_unavailable',
          label: 'Operating inventory unavailable',
          status: 'blocked',
          evidence: message,
          next_action: 'Retry inventory check after the Ad OS summary endpoint is responsive.',
          risk: 'medium',
        }],
        safety: {
          read_only: true,
          database_mutation: false,
          external_api_write: false,
          live_spend_krw: 0,
        },
      },
      summary: {
        status: 'blocked',
        readiness_score: 0,
        operational: 0,
        partial: 0,
        blocked: 1,
        top_gap: 'Operating inventory unavailable.',
        next_action: 'Recover /api/admin/ad-os/summary before using the Ad OS operating inventory.',
      },
    });
  }
});
