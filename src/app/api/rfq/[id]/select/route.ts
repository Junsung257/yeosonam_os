import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  getGroupRfq,
  getRfqProposals,
  getRfqBids,
  updateGroupRfq,
  updateRfqProposal,
  updateRfqBid,
} from '@/lib/supabase';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id: rfqId } = params;

  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  try {
    const { proposal_id } = await request.json();

    if (!proposal_id) {
      return NextResponse.json({ error: 'proposal_id가 필요합니다.' }, { status: 400 });
    }

    // RFQ 조회
    const rfq = await getGroupRfq(rfqId);
    if (!rfq) {
      return NextResponse.json({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }

    if (rfq.status !== 'awaiting_selection' && rfq.status !== 'bidding') {
      return NextResponse.json(
        { error: '현재 제안서를 선택할 수 없는 상태입니다.' },
        { status: 409 }
      );
    }

    // 모든 제안서 및 입찰 조회
    const proposals = await getRfqProposals(rfqId);
    const selectedProposal = proposals.find(p => p.id === proposal_id);

    if (!selectedProposal) {
      return NextResponse.json({ error: '선택한 제안서를 찾을 수 없습니다.' }, { status: 404 });
    }

    const bids = await getRfqBids(rfqId);

    // 선택된 제안서 상태 업데이트
    await updateRfqProposal(proposal_id, { status: 'selected' });

    // 나머지 제안서 거절 처리
    const otherProposals = proposals.filter(p => p.id !== proposal_id);
    await Promise.all(
      otherProposals.map(p => updateRfqProposal(p.id, { status: 'rejected' }))
    );

    // 선택된 제안서에 해당하는 입찰 업데이트
    const winningBid = bids.find(b => b.id === selectedProposal.bid_id);
    if (winningBid) {
      await updateRfqBid(winningBid.id, { status: 'selected' });
    }

    // 나머지 입찰 거절 처리
    const otherBids = bids.filter(b => b.id !== selectedProposal.bid_id);
    await Promise.all(
      otherBids.map(b => updateRfqBid(b.id, { status: 'rejected' }))
    );

    // RFQ 상태를 contracted로 전환
    const updatedRfq = await updateGroupRfq(rfqId, {
      selected_proposal_id: proposal_id,
      status: 'contracted',
    });

    return NextResponse.json({
      rfq: updatedRfq,
      proposal: { ...selectedProposal, status: 'selected' },
    });
  } catch (error) {
    console.error('제안서 선택 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '제안서 선택에 실패했습니다.' },
      { status: 500 }
    );
  }
}
