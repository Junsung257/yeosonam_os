import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { buildAdOsOperatingInventory } from '@/lib/ad-os-v581-v600';
import { buildAdOsStagingSmokeSummary } from '@/lib/ad-os-v541-v560';
import { withTimeout } from '@/lib/promise-timeout';
import { fetchAdOsSummaryJson } from '../_lib/summary-fetch';

export const dynamic = 'force-dynamic';
const AD_OS_OPERATING_INVENTORY_SUMMARY_TIMEOUT_MS = 5000;

export const GET = withAdminGuard(async (request: NextRequest) => {
  try {
    const summary = await withTimeout(
      fetchAdOsSummaryJson(request),
      AD_OS_OPERATING_INVENTORY_SUMMARY_TIMEOUT_MS,
      '광고 운영 요약',
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
    const message = error instanceof Error ? error.message : '운영 항목 점검을 사용할 수 없습니다.';
    return NextResponse.json({
      ok: true,
      generated_at: new Date().toISOString(),
      inventory: {
        status: 'partial',
        readiness_score: 45,
        operational: 0,
        partial: 1,
        blocked: 0,
        top_gap: '광고 운영 요약 응답 지연',
        next_action: '광고 운영 요약이 느려 기본 점검 카드만 표시합니다. 잠시 뒤 다시 점검하세요.',
        items: [{
          id: 'operating_inventory_unavailable',
          label: '운영 항목 점검 지연',
          status: 'partial',
          evidence: message,
          next_action: '화면은 계속 사용할 수 있습니다. 요약 API가 안정화되면 운영 항목을 다시 불러오세요.',
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
        status: 'partial',
        readiness_score: 45,
        operational: 0,
        partial: 1,
        blocked: 0,
        top_gap: '광고 운영 요약 응답 지연',
        next_action: '광고 운영 요약이 느려 기본 점검 카드만 표시합니다. 잠시 뒤 다시 점검하세요.',
      },
    });
  }
});
