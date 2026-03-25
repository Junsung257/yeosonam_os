import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  getGroupRfq,
  getRfqProposal,
  getRfqProposals,
  createRfqProposal,
  updateRfqProposal,
  updateRfqBid,
  updateGroupRfq,
  ProposalChecklist,
  RfqProposal,
} from '@/lib/supabase';
import { reviewProposal, generateFactBombingReport } from '@/lib/rfq-ai';

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
  { params }: { params: Promise<{ id: string; bidId: string }> }
) {
  const { id: rfqId, bidId } = await params;

  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  try {
    const proposals = await getRfqProposals(rfqId);
    const proposal = proposals.find(p => p.bid_id === bidId) ?? null;
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
  { params }: { params: Promise<{ id: string; bidId: string }> }
) {
  const { id: rfqId, bidId } = await params;

  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const {
      proposal_title,
      itinerary_summary,
      total_cost,
      total_selling_price,
      checklist,
      tenant_id,
    } = body;

    if (total_cost === undefined || total_selling_price === undefined) {
      return NextResponse.json(
        { error: 'total_cost와 total_selling_price는 필수입니다.' },
        { status: 400 }
      );
    }

    // 체크리스트 검증
    const missingItems = validateChecklist(checklist ?? {});
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
    const proposal = await createRfqProposal({
      rfq_id: rfqId,
      bid_id: bidId,
      tenant_id: tenant_id ?? '',
      proposal_title,
      itinerary_summary,
      total_cost,
      total_selling_price,
      hidden_cost_estimate: 0,
      checklist: checklist ?? {},
      checklist_completed: checklistCompleted,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    });

    if (!proposal) {
      return NextResponse.json({ error: '제안서 생성에 실패했습니다.' }, { status: 500 });
    }

    // 입찰 상태 업데이트
    await updateRfqBid(bidId, {
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    });

    // 비동기: AI 검수
    (async () => {
      try {
        const rfq = await getGroupRfq(rfqId);
        if (!rfq) return;

        const review = await reviewProposal(rfq, proposal);
        await updateRfqProposal(proposal.id, {
          ai_review: review,
          ai_reviewed_at: new Date().toISOString(),
          hidden_cost_estimate: review.hidden_cost_estimate,
          real_total_price: review.real_total_price,
          status: 'approved',
        });

        // 승인된 제안서가 3개 이상이면 팩트 폭격 분석 실행
        const allProposals = await getRfqProposals(rfqId);
        const approvedProposals = allProposals.filter(
          p => p.status === 'approved' || p.status === 'submitted'
        );

        if (approvedProposals.length >= 3) {
          const factResult = await generateFactBombingReport(rfq, approvedProposals);

          // 순위 업데이트
          for (let i = 0; i < factResult.ranked.length; i++) {
            const rankedProposal = factResult.ranked[i];
            if (rankedProposal?.id) {
              await updateRfqProposal(rankedProposal.id, { rank: i + 1 });
            }
          }

          // RFQ 상태를 awaiting_selection으로 전환
          if (rfq.status !== 'awaiting_selection') {
            await updateGroupRfq(rfqId, { status: 'awaiting_selection' });
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
  { params }: { params: Promise<{ id: string; bidId: string }> }
) {
  const { id: rfqId, bidId } = await params;

  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const {
      proposal_title,
      itinerary_summary,
      total_cost,
      total_selling_price,
      checklist,
    } = body;

    // 제안서 찾기
    const proposals = await getRfqProposals(rfqId);
    const existing = proposals.find(p => p.bid_id === bidId);
    if (!existing) {
      return NextResponse.json({ error: '제안서를 찾을 수 없습니다.' }, { status: 404 });
    }

    const mergedChecklist: Partial<ProposalChecklist> = {
      ...(existing.checklist ?? {}),
      ...(checklist ?? {}),
    };

    const missingItems = validateChecklist(mergedChecklist);
    const checklistCompleted = missingItems.length === 0;

    const patch: Partial<RfqProposal> = { checklist_completed: checklistCompleted };
    if (proposal_title !== undefined) patch.proposal_title = proposal_title;
    if (itinerary_summary !== undefined) patch.itinerary_summary = itinerary_summary;
    if (total_cost !== undefined) patch.total_cost = total_cost;
    if (total_selling_price !== undefined) patch.total_selling_price = total_selling_price;
    if (checklist !== undefined) patch.checklist = mergedChecklist;

    const updated = await updateRfqProposal(existing.id, patch);
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
