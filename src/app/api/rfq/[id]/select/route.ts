import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  isSupabaseConfigured,
  getGroupRfq,
  getRfqProposals,
  getRfqBids,
  updateGroupRfq,
  updateRfqProposal,
  updateRfqBid,
} from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';
import { safeEqualString } from '@/lib/timing-safe';

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id: rfqId } = params;

  if (!isSupabaseConfigured) {
    return apiResponse(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 },
    );
  }

  try {
    const body = await request.json() as { proposal_id?: string; share_token?: string };
    const { proposal_id } = body;

    if (!proposal_id) {
      return apiResponse({ error: 'proposal_id가 필요합니다.' }, { status: 400 });
    }

    const rfq = await getGroupRfq(rfqId);
    if (!rfq) {
      return apiResponse({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }

    const rfqShareToken = typeof rfq.share_token === 'string' ? rfq.share_token : null;
    const requestShareToken = body.share_token ?? request.headers.get('x-rfq-share-token');
    const isAdmin = await isAdminRequest(request);
    if (!isAdmin && !safeEqualString(requestShareToken, rfqShareToken)) {
      return apiResponse({ error: '공유 링크 권한이 필요합니다.' }, { status: 403 });
    }

    if (rfq.status !== 'awaiting_selection' && rfq.status !== 'bidding') {
      return apiResponse(
        { error: '현재 제안서를 선택할 수 없는 상태입니다.' },
        { status: 409 },
      );
    }

    const proposals = await getRfqProposals(rfqId);
    const selectedProposal = proposals.find(p => p.id === proposal_id);

    if (!selectedProposal) {
      return apiResponse({ error: '선택한 제안서를 찾을 수 없습니다.' }, { status: 404 });
    }

    const bids = await getRfqBids(rfqId);

    await updateRfqProposal(proposal_id, { status: 'selected' });

    const otherProposals = proposals.filter(p => p.id !== proposal_id);
    await Promise.all(
      otherProposals.map(p => updateRfqProposal(p.id, { status: 'rejected' })),
    );

    const winningBid = bids.find(b => b.id === selectedProposal.bid_id);
    if (winningBid) {
      await updateRfqBid(winningBid.id, { status: 'selected' });
    }

    const otherBids = bids.filter(b => b.id !== selectedProposal.bid_id);
    await Promise.all(
      otherBids.map(b => updateRfqBid(b.id, { status: 'rejected' })),
    );

    const updatedRfq = await updateGroupRfq(rfqId, {
      selected_proposal_id: proposal_id,
      status: 'contracted',
    });

    return apiResponse({
      rfq: updatedRfq,
      proposal: { ...selectedProposal, status: 'selected' },
    });
  } catch (error) {
    console.error('[rfq/select] failed:', sanitizeDbError(error));
    return apiResponse(
      { error: sanitizeDbError(error, '제안서 선택에 실패했습니다.') },
      { status: 500 },
    );
  }
}
