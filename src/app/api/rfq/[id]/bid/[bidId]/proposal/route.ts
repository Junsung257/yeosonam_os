import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  isSupabaseAdminConfigured,
  ProposalChecklist,
  RfqProposal,
} from '@/lib/supabase';
import { reviewProposal, generateFactBombingReport } from '@/lib/rfq-ai';
import {
  getAuthorizedRfqBid,
  getAuthorizedRfqProposal,
  createAuthorizedRfqProposal,
  updateAuthorizedRfqBid,
  updateAuthorizedRfqProposal,
  getServerGroupRfq,
  getServerRfqProposals,
  updateServerGroupRfq,
  updateServerRfqProposal,
} from '@/lib/db/rfq-server';
import { isTenantPortalAuthError, requireTenantPortalRequest } from '@/lib/tenant-portal-auth';

const REQUIRED_CHECKLIST_ITEMS: (keyof ProposalChecklist)[] = [
  'guide_fee',
  'driver_tip',
  'fuel_surcharge',
  'local_tax',
  'water_cost',
];

function validateChecklist(checklist: Partial<ProposalChecklist>): string[] {
  const missing: string[] = [];
  for (const item of REQUIRED_CHECKLIST_ITEMS) {
    const val = checklist[item] as { included?: boolean } | undefined;
    if (!val || typeof val.included !== 'boolean') {
      missing.push(item);
    }
  }
  return missing;
}

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ id: string; bidId: string }> }
) {
  const params = await props.params;
  const { id: rfqId, bidId } = params;
  const tenantId = new URL(_request.url).searchParams.get('tenant_id') ?? '';
  const authorization = await requireTenantPortalRequest(_request, tenantId);
  if (isTenantPortalAuthError(authorization)) return authorization;

  if (!isSupabaseAdminConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  try {
    const proposal = await getAuthorizedRfqProposal(rfqId, bidId, authorization.tenantId);
    if (!proposal) {
      return NextResponse.json({ error: '제안서를 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ proposal });
  } catch (error) {
    console.error('제안서 조회 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '제안서 조회에 실패했습니다.' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string; bidId: string }> }
) {
  const params = await props.params;
  const { id: rfqId, bidId } = params;

  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const requestedTenantId = typeof body.tenant_id === 'string' ? body.tenant_id : '';
  const authorization = await requireTenantPortalRequest(request, requestedTenantId);
  if (isTenantPortalAuthError(authorization)) return authorization;

  try {
    const {
      proposal_title,
      itinerary_summary,
      total_cost,
      total_selling_price,
      checklist,
    } = body;

    if (
      typeof total_cost !== 'number'
      || !Number.isFinite(total_cost)
      || typeof total_selling_price !== 'number'
      || !Number.isFinite(total_selling_price)
    ) {
      return NextResponse.json(
        { error: 'total_cost와 total_selling_price는 필수입니다.' },
        { status: 400 }
      );
    }

    // 체크리스트 검증
    const checklistValue = checklist && typeof checklist === 'object' && !Array.isArray(checklist)
      ? checklist as Partial<ProposalChecklist>
      : {};
    const missingItems = validateChecklist(checklistValue);
    if (missingItems.length > 0) {
      return NextResponse.json(
        {
          error: '체크리스트에 누락된 항목이 있습니다.',
          missing_items: missingItems,
        },
        { status: 400 }
      );
    }

    const checklistCompleted = missingItems.length === 0;

    // 제안서 생성
    const bid = await getAuthorizedRfqBid(rfqId, bidId, authorization.tenantId);
    if (!bid) {
      return NextResponse.json({ error: '해당 테넌트의 입찰을 찾을 수 없습니다.' }, { status: 404 });
    }

    const proposal = await createAuthorizedRfqProposal({
      rfq_id: rfqId,
      bid_id: bidId,
      tenant_id: authorization.tenantId,
      proposal_title: typeof proposal_title === 'string' ? proposal_title : undefined,
      itinerary_summary: typeof itinerary_summary === 'string' ? itinerary_summary : undefined,
      total_cost,
      total_selling_price,
      hidden_cost_estimate: 0,
      checklist: checklistValue,
      checklist_completed: checklistCompleted,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    }, authorization.tenantId);

    if (!proposal) {
      return NextResponse.json({ error: '제안서 생성에 실패했습니다.' }, { status: 500 });
    }

    // 입찰 상태 업데이트
    await updateAuthorizedRfqBid(rfqId, bidId, authorization.tenantId, {
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    });

    // 비동기: AI 검수
    (async () => {
      try {
        const rfq = await getServerGroupRfq(rfqId);
        if (!rfq) return;

        const review = await reviewProposal(rfq, proposal);
        await updateServerRfqProposal(proposal.id, {
          ai_review: review,
          ai_reviewed_at: new Date().toISOString(),
          hidden_cost_estimate: review.hidden_cost_estimate,
          real_total_price: review.real_total_price,
          status: 'approved',
        });

        // 승인된 제안서가 3개 이상이면 팩트 폭격 분석 실행
        const allProposals = await getServerRfqProposals(rfqId);
        const approvedProposals = allProposals.filter(
          p => p.status === 'approved' || p.status === 'submitted'
        );

        if (approvedProposals.length >= 3) {
          const factResult = await generateFactBombingReport(rfq, approvedProposals);

          // 순위 업데이트
          for (let i = 0; i < factResult.ranked.length; i++) {
            const rankedProposal = factResult.ranked[i];
            if (rankedProposal?.id) {
              await updateServerRfqProposal(rankedProposal.id, { rank: i + 1 });
            }
          }

          // RFQ 상태를 awaiting_selection으로 전환
          if (rfq.status !== 'awaiting_selection') {
            await updateServerGroupRfq(rfqId, { status: 'awaiting_selection' });
          }
        }
      } catch (aiError) {
        console.error('AI 검수 비동기 오류:', aiError);
      }
    })();

    return NextResponse.json({ proposal }, { status: 201 });
  } catch (error) {
    console.error('제안서 제출 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '제안서 제출에 실패했습니다.' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ id: string; bidId: string }> }
) {
  const params = await props.params;
  const { id: rfqId, bidId } = params;

  const requestedTenantId = new URL(request.url).searchParams.get('tenant_id') ?? '';
  const authorization = await requireTenantPortalRequest(request, requestedTenantId);
  if (isTenantPortalAuthError(authorization)) return authorization;

  if (!isSupabaseAdminConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const {
      proposal_title,
      itinerary_summary,
      total_cost,
      total_selling_price,
      checklist,
    } = body;

    // 제안서 찾기
    const existing = await getAuthorizedRfqProposal(rfqId, bidId, authorization.tenantId);
    if (!existing) {
      return NextResponse.json({ error: '제안서를 찾을 수 없습니다.' }, { status: 404 });
    }

    const checklistValue = checklist && typeof checklist === 'object' && !Array.isArray(checklist)
      ? checklist as Partial<ProposalChecklist>
      : {};
    const mergedChecklist: Partial<ProposalChecklist> = {
      ...(existing.checklist ?? {}),
      ...checklistValue,
    };

    const missingItems = validateChecklist(mergedChecklist);
    const checklistCompleted = missingItems.length === 0;

    const patch: Partial<RfqProposal> = { checklist_completed: checklistCompleted };
    if (proposal_title !== undefined) {
      if (typeof proposal_title !== 'string') {
        return NextResponse.json({ error: 'proposal_title 형식이 올바르지 않습니다.' }, { status: 400 });
      }
      patch.proposal_title = proposal_title;
    }
    if (itinerary_summary !== undefined) {
      if (typeof itinerary_summary !== 'string') {
        return NextResponse.json({ error: 'itinerary_summary 형식이 올바르지 않습니다.' }, { status: 400 });
      }
      patch.itinerary_summary = itinerary_summary;
    }
    if (total_cost !== undefined) {
      if (typeof total_cost !== 'number' || !Number.isFinite(total_cost)) {
        return NextResponse.json({ error: 'total_cost 형식이 올바르지 않습니다.' }, { status: 400 });
      }
      patch.total_cost = total_cost;
    }
    if (total_selling_price !== undefined) {
      if (typeof total_selling_price !== 'number' || !Number.isFinite(total_selling_price)) {
        return NextResponse.json({ error: 'total_selling_price 형식이 올바르지 않습니다.' }, { status: 400 });
      }
      patch.total_selling_price = total_selling_price;
    }
    if (checklist !== undefined) patch.checklist = mergedChecklist;

    const updated = await updateAuthorizedRfqProposal(
      rfqId,
      bidId,
      authorization.tenantId,
      existing.id,
      patch,
    );
    if (!updated) {
      return NextResponse.json({ error: '제안서 업데이트에 실패했습니다.' }, { status: 500 });
    }

    return NextResponse.json({
      proposal: updated,
      missing_checklist_items: missingItems,
      checklist_completed: checklistCompleted,
    });
  } catch (error) {
    console.error('제안서 수정 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '제안서 수정에 실패했습니다.' },
      { status: 500 }
    );
  }
}
