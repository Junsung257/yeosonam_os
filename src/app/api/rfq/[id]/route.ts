import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  getGroupRfq,
  updateGroupRfq,
} from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';

const TIER_DELAY_MS = parseInt(process.env.RFQ_TIER_DELAY_MINUTES ?? '10') * 60 * 1000;

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  // Admin 전용
  if (!(await isAdminRequest(_request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const params = await props.params;
  const { id } = params;

  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  try {
    const rfq = await getGroupRfq(id);
    if (!rfq) {
      return NextResponse.json({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ rfq });
  } catch (error) {
    console.error('RFQ 조회 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'RFQ 조회에 실패했습니다.' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  // Admin 전용
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const params = await props.params;
  const { id } = params;

  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { action, ...rest } = body;

    if (action === 'publish') {
      const now = Date.now();
      const patch = {
        status: 'published' as const,
        published_at: new Date(now).toISOString(),
        gold_unlock_at: new Date(now).toISOString(),
        silver_unlock_at: new Date(now + TIER_DELAY_MS).toISOString(),
        bronze_unlock_at: new Date(now + 2 * TIER_DELAY_MS).toISOString(),
        bid_deadline: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      };
      const rfq = await updateGroupRfq(id, patch);
      if (!rfq) {
        return NextResponse.json({ error: 'RFQ 게시에 실패했습니다.' }, { status: 500 });
      }
      return NextResponse.json({ rfq });
    }

    if (action === 'transition') {
      const { status } = rest;
      if (!status) {
        return NextResponse.json({ error: 'status가 필요합니다.' }, { status: 400 });
      }
      const rfq = await updateGroupRfq(id, { status });
      if (!rfq) {
        return NextResponse.json({ error: 'RFQ 상태 변경에 실패했습니다.' }, { status: 500 });
      }

      // 여행 완료(completed) 시 travel history 자동 기록
      if (status === 'completed') {
        try {
          const sb = (await import('@/lib/supabase')).getSupabaseAdmin();
          if (sb) {
            const selectedProposalId = (rfq as any).selected_proposal_id;
            let proposal: Record<string, unknown> | null = null;
            let tenantName: string | null = null;

            if (selectedProposalId) {
              const { data: prop } = await sb
                .from('rfq_proposals')
                .select('title, price, tenant_id')
                .eq('id', selectedProposalId)
                .single();
              proposal = prop as Record<string, unknown> | null;

              // tenant_id로 tenants 테이블 조회
              if (proposal?.tenant_id) {
                const { data: tenant } = await sb
                  .from('tenants')
                  .select('name')
                  .eq('id', proposal.tenant_id)
                  .single();
                tenantName = (tenant as any)?.name ?? null;
              }
            }

            const { error: insertError } = await sb
              .from('user_travel_histories')
              .upsert({
                customer_id: (rfq as any).customer_id,
                rfq_id: id,
                destination: (rfq as any).destination ?? '미등록',
                destination_country: null,
                departure_date: (rfq as any).departure_date_from ?? null,
                duration_nights: (rfq as any).duration_nights ?? null,
                trip_type: (rfq as any).custom_requirements?.group_type ?? null,
                tenant_name: tenantName,
                proposal_title: proposal?.title ?? null,
                total_price: proposal?.price ?? null,
                total_pax: ((rfq as any).adult_count ?? 0) + ((rfq as any).child_count ?? 0),
                review_submitted: false,
              } as never, { onConflict: 'customer_id,rfq_id', ignoreDuplicates: 'true' } as never);
            if (insertError) {
              console.error('Travel history upsert 오류:', insertError);
            }
          }
        } catch (e) {
          console.error('Travel history 기록 실패 (무시):', e);
        }
      }

      return NextResponse.json({ rfq });
    }

    // 일반 업데이트
    const rfq = await updateGroupRfq(id, rest);
    if (!rfq) {
      return NextResponse.json({ error: 'RFQ 업데이트에 실패했습니다.' }, { status: 500 });
    }
    return NextResponse.json({ rfq });
  } catch (error) {
    console.error('RFQ 업데이트 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'RFQ 업데이트에 실패했습니다.' },
      { status: 500 }
    );
  }
}
