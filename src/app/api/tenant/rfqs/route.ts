import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseAdminConfigured,
  GroupRfq,
} from '@/lib/supabase';
import { sensitiveBackendUnavailable } from '@/lib/sensitive-api-fail-closed';
import { getTenantPortalTenant, isTenantPortalAuthError, requireTenantPortalRequest } from '@/lib/tenant-portal-auth';
import { sanitizeTenantPortalRfq } from '@/lib/tenant-portal-rfq';
import { getServerRfqBids, listServerGroupRfqs } from '@/lib/db/rfq-server';

interface RfqWithTierInfo extends GroupRfq {
  is_unlocked: boolean;
  unlocks_in_seconds?: number;
  my_bid?: {
    id: string;
    status: string;
    locked_at: string;
    submit_deadline: string;
  } | null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenant_id');

  const authorization = await requireTenantPortalRequest(request, tenantId ?? '');
  if (isTenantPortalAuthError(authorization)) return authorization;

  if (!isSupabaseAdminConfigured) {
    return sensitiveBackendUnavailable('tenant_rfqs');
  }

  try {
    const tenant = await getTenantPortalTenant(authorization.tenantId);
    if (!tenant) {
      return NextResponse.json({ error: '테넌트를 찾을 수 없습니다.' }, { status: 404 });
    }

    const tier = (tenant as unknown as { tier?: string }).tier ?? 'bronze';
    const now = new Date();

    // status IN ('published', 'bidding') 인 RFQ 조회
    const publishedRfqs = await listServerGroupRfqs('published');
    const biddingRfqs = await listServerGroupRfqs('bidding');
    const allRfqs = [...publishedRfqs, ...biddingRfqs];

    // bid_deadline이 아직 안 지난 것만 필터
    const activeRfqs = allRfqs.filter(rfq => {
      if (!rfq.bid_deadline) return true;
      return new Date(rfq.bid_deadline) > now;
    });

    // 티어별 unlock_at 확인 및 my_bid 조회
    const enriched: RfqWithTierInfo[] = await Promise.all(
      activeRfqs.map(async rfq => {
        let unlockAt: string | undefined;
        if (tier === 'gold') {
          unlockAt = rfq.gold_unlock_at ?? undefined;
        } else if (tier === 'silver') {
          unlockAt = rfq.silver_unlock_at ?? undefined;
        } else {
          unlockAt = rfq.bronze_unlock_at ?? undefined;
        }

        const isUnlocked = !unlockAt || new Date(unlockAt) <= now;
        const unlocksInSeconds = !isUnlocked && unlockAt
          ? Math.ceil((new Date(unlockAt).getTime() - now.getTime()) / 1000)
          : undefined;

        // 해당 테넌트의 기존 입찰 확인
        const bids = await getServerRfqBids(rfq.id, authorization.tenantId);
        const myBid = bids.find(b => b.tenant_id === authorization.tenantId);

        // 고객 개인정보 마스킹
        const sanitized: RfqWithTierInfo = {
          ...sanitizeTenantPortalRfq(rfq, isUnlocked),
          is_unlocked: isUnlocked,
          unlocks_in_seconds: unlocksInSeconds,
          my_bid: myBid
            ? {
                id: myBid.id,
                status: myBid.status,
                locked_at: myBid.locked_at,
                submit_deadline: myBid.submit_deadline,
              }
            : null,
        };

        return sanitized;
      })
    );

    return NextResponse.json(
      { rfqs: enriched, count: enriched.length },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('테넌트 RFQ 목록 조회 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'RFQ 목록 조회에 실패했습니다.' },
      { status: 500 }
    );
  }
}
