import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseAdminConfigured,
  GroupRfq,
} from '@/lib/supabase';
import { sensitiveBackendUnavailable } from '@/lib/sensitive-api-fail-closed';
import { getTenantPortalTenant, isTenantPortalAuthError, requireTenantPortalRequest } from '@/lib/tenant-portal-auth';
import {
  sanitizeTenantPortalRfq,
  TENANT_PORTAL_VISIBLE_RFQ_STATUSES,
} from '@/lib/tenant-portal-rfq';
import { getServerGroupRfq, getServerRfqBids } from '@/lib/db/rfq-server';

export async function GET(request: NextRequest, props: { params: Promise<{ rfqId: string }> }) {
  const params = await props.params;
  const { rfqId } = params;
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenant_id');

  const authorization = await requireTenantPortalRequest(request, tenantId ?? '');
  if (isTenantPortalAuthError(authorization)) return authorization;

  if (!isSupabaseAdminConfigured) {
    return sensitiveBackendUnavailable('tenant_rfq');
  }

  try {
    const [rfq, tenant] = await Promise.all([
      getServerGroupRfq(rfqId),
      getTenantPortalTenant(authorization.tenantId),
    ]);

    if (!rfq) {
      return NextResponse.json({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }
    if (!TENANT_PORTAL_VISIBLE_RFQ_STATUSES.has(rfq.status)) {
      return NextResponse.json({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }
    if (!tenant) {
      return NextResponse.json({ error: '테넌트를 찾을 수 없습니다.' }, { status: 404 });
    }

    const tier = (tenant as unknown as { tier?: string }).tier ?? 'bronze';
    const now = new Date();

    let unlockAt: string | undefined;
    if (tier === 'gold')        unlockAt = rfq.gold_unlock_at   ?? undefined;
    else if (tier === 'silver') unlockAt = rfq.silver_unlock_at ?? undefined;
    else                        unlockAt = rfq.bronze_unlock_at ?? undefined;

    const isUnlocked = !unlockAt || new Date(unlockAt) <= now;

    const bids = await getServerRfqBids(rfqId, authorization.tenantId);
    const myBid = bids.find(b => b.tenant_id === authorization.tenantId) ?? null;
    const sanitized = sanitizeTenantPortalRfq(rfq, isUnlocked);

    return NextResponse.json(
      {
        rfq: sanitized,
        is_unlocked: isUnlocked,
        my_bid: myBid
          ? {
              id: myBid.id,
              status: myBid.status,
              locked_at: myBid.locked_at,
              submit_deadline: myBid.submit_deadline,
              submitted_at: myBid.submitted_at,
            }
          : null,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('테넌트 RFQ 상세 조회 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'RFQ 조회에 실패했습니다.' },
      { status: 500 }
    );
  }
}
