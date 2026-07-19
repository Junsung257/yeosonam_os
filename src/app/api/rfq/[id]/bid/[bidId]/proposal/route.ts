import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  ProposalChecklist,
  RfqProposal,
} from '@/lib/supabase';
import { createRfqProposal, getGroupRfq, getRfqBids, getRfqProposals, updateGroupRfq, updateRfqBid, updateRfqProposal } from '@/lib/db/rfq-server';
import { reviewProposal, generateFactBombingReport } from '@/lib/rfq-ai';
import {
  resolveRfqActor,
  rfqForbiddenResponse,
  rfqUnauthorizedResponse,
} from '@/lib/rfq-request-auth';

const REQUIRED_CHECKLIST_ITEMS: (keyof ProposalChecklist)[] = [
  'guide_fee',
  'driver_tip',
  'fuel_surcharge',
  'local_tax',
  'water_cost',
];

const MAX_PROPOSAL_AMOUNT = 2_000_000_000;
const MAX_CHECKLIST_BYTES = 50_000;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isOptionalText(value: unknown, maxLength: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= maxLength);
}

function isProposalAmount(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0
    && value <= MAX_PROPOSAL_AMOUNT;
}

function isStringArray(value: unknown, maxItems: number, maxItemLength: number): boolean {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every((item) => typeof item === 'string' && item.length <= maxItemLength);
}

function validateChecklistShape(value: unknown, requireRequiredItems: boolean): string | null {
  if (!isPlainRecord(value)) return 'checklist는 객체여야 합니다.';
  if (JSON.stringify(value).length > MAX_CHECKLIST_BYTES) return 'checklist가 너무 큽니다.';

  const allowedKeys = new Set<string>([
    ...REQUIRED_CHECKLIST_ITEMS,
    'inclusions', 'exclusions', 'optional_tours', 'hotel_info', 'meal_plan', 'transportation',
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return 'checklist에 지원하지 않는 필드가 있습니다.';
  }

  for (const key of REQUIRED_CHECKLIST_ITEMS) {
    const item = value[key];
    if (item === undefined && !requireRequiredItems) continue;
    if (!isPlainRecord(item) || typeof item.included !== 'boolean') return `${key} 형식이 올바르지 않습니다.`;
    if (item.amount !== undefined && item.amount !== null && !isProposalAmount(item.amount)) return `${key}.amount 형식이 올바르지 않습니다.`;
    if (!isOptionalText(item.note, 500)) return `${key}.note가 너무 깁니다.`;
  }

  if (value.inclusions !== undefined && !isStringArray(value.inclusions, 100, 500)) return 'inclusions 형식이 올바르지 않습니다.';
  if (value.exclusions !== undefined && !isStringArray(value.exclusions, 100, 500)) return 'exclusions 형식이 올바르지 않습니다.';
  if (value.optional_tours !== undefined) {
    if (!Array.isArray(value.optional_tours) || value.optional_tours.length > 50
      || value.optional_tours.some((tour) => !isPlainRecord(tour)
        || typeof tour.name !== 'string' || !tour.name.trim() || tour.name.length > 200
        || !isProposalAmount(tour.price))) {
      return 'optional_tours 형식이 올바르지 않습니다.';
    }
  }
  if (value.hotel_info !== undefined) {
    const hotel = value.hotel_info;
    if (!isPlainRecord(hotel)
      || !isOptionalText(hotel.grade, 100)
      || !isOptionalText(hotel.name, 200)
      || !isOptionalText(hotel.notes, 1000)) return 'hotel_info 형식이 올바르지 않습니다.';
  }
  if (!isOptionalText(value.meal_plan, 500) || !isOptionalText(value.transportation, 500)) {
    return 'checklist 텍스트가 너무 깁니다.';
  }
  return null;
}

function validateProposalBody(body: unknown, partial: boolean): string | null {
  if (!isPlainRecord(body)) return '요청 본문은 객체여야 합니다.';
  if (!isOptionalText(body.proposal_title, 200) || !isOptionalText(body.itinerary_summary, 20_000)) {
    return '제안서 텍스트가 너무 깁니다.';
  }
  if ((!partial || body.total_cost !== undefined) && !isProposalAmount(body.total_cost)) return 'total_cost 형식이 올바르지 않습니다.';
  if ((!partial || body.total_selling_price !== undefined) && !isProposalAmount(body.total_selling_price)) return 'total_selling_price 형식이 올바르지 않습니다.';
  if (!partial || body.checklist !== undefined) {
    const checklistError = validateChecklistShape(body.checklist, !partial);
    if (checklistError) return checklistError;
  }
  return null;
}

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

function isBidDeadlinePassed(deadline: string | undefined): boolean {
  return Boolean(deadline && new Date(deadline).getTime() <= Date.now());
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string; bidId: string }> }
) {
  const params = await props.params;
  const { id: rfqId, bidId } = params;

  const actor = await resolveRfqActor(request);
  if (!actor) return rfqUnauthorizedResponse();
  const bids = await getRfqBids(rfqId);
  const bid = bids.find((candidate) => candidate.id === bidId);
  if (!bid) return NextResponse.json({ error: '입찰을 찾을 수 없습니다.' }, { status: 404 });
  if (actor.kind === 'tenant' && bid.tenant_id !== actor.tenantId) {
    return rfqForbiddenResponse();
  }
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
    return NextResponse.json({ proposal }, { headers: { 'Cache-Control': 'private, no-store' } });
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

  const actor = await resolveRfqActor(request);
  if (!actor) return rfqUnauthorizedResponse();
  const bids = await getRfqBids(rfqId);
  const bid = bids.find((candidate) => candidate.id === bidId);
  if (!bid) return NextResponse.json({ error: '입찰을 찾을 수 없습니다.' }, { status: 404 });
  if (actor.kind === 'tenant' && bid.tenant_id !== actor.tenantId) {
    return rfqForbiddenResponse();
  }
  if (bid.status !== 'locked' || isBidDeadlinePassed(bid.submit_deadline)) {
    return NextResponse.json({ error: '제안서를 제출할 수 없는 입찰 상태입니다.' }, { status: 409 });
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  try {
    const body: unknown = await request.json();
    const validationError = validateProposalBody(body, false);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const proposalBody = body as Record<string, unknown>;
    const {
      proposal_title,
      itinerary_summary,
      total_cost,
      total_selling_price,
      checklist,
    } = proposalBody;

    // 체크리스트 검증
    const missingItems = validateChecklist(checklist as Partial<ProposalChecklist>);
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
      tenant_id: bid.tenant_id,
      proposal_title: proposal_title as string | undefined,
      itinerary_summary: itinerary_summary as string | undefined,
      total_cost: total_cost as number,
      total_selling_price: total_selling_price as number,
      hidden_cost_estimate: 0,
      checklist: checklist as Partial<ProposalChecklist>,
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
  props: { params: Promise<{ id: string; bidId: string }> }
) {
  const params = await props.params;
  const { id: rfqId, bidId } = params;

  const actor = await resolveRfqActor(request);
  if (!actor) return rfqUnauthorizedResponse();
  const bids = await getRfqBids(rfqId);
  const bid = bids.find((candidate) => candidate.id === bidId);
  if (!bid) return NextResponse.json({ error: '입찰을 찾을 수 없습니다.' }, { status: 404 });
  if (actor.kind === 'tenant' && bid.tenant_id !== actor.tenantId) {
    return rfqForbiddenResponse();
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  try {
    const body: unknown = await request.json();
    const validationError = validateProposalBody(body, true);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const proposalBody = body as Record<string, unknown>;
    const {
      proposal_title,
      itinerary_summary,
      total_cost,
      total_selling_price,
      checklist,
    } = proposalBody;

    // 제안서 찾기
    const proposals = await getRfqProposals(rfqId);
    const existing = proposals.find(p => p.bid_id === bidId);
    if (!existing) {
      return NextResponse.json({ error: '제안서를 찾을 수 없습니다.' }, { status: 404 });
    }
    if (
      ['selected', 'rejected'].includes(existing.status)
      || ['selected', 'rejected', 'timeout', 'withdrawn'].includes(bid.status)
      || isBidDeadlinePassed(bid.submit_deadline)
    ) {
      return NextResponse.json({ error: '제안서를 수정할 수 없는 상태입니다.' }, { status: 409 });
    }

    const mergedChecklist: Partial<ProposalChecklist> = {
      ...(existing.checklist ?? {}),
      ...(checklist ?? {}),
    };

    if (checklist !== undefined) {
      const mergedChecklistError = validateChecklistShape(mergedChecklist, false);
      if (mergedChecklistError) {
        return NextResponse.json({ error: mergedChecklistError }, { status: 400 });
      }
    }

    const missingItems = validateChecklist(mergedChecklist);
    const checklistCompleted = missingItems.length === 0;

    const patch: Partial<RfqProposal> = { checklist_completed: checklistCompleted };
    if (proposal_title !== undefined) patch.proposal_title = proposal_title as string;
    if (itinerary_summary !== undefined) patch.itinerary_summary = itinerary_summary as string;
    if (total_cost !== undefined) patch.total_cost = total_cost as number;
    if (total_selling_price !== undefined) patch.total_selling_price = total_selling_price as number;
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
