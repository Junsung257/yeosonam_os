import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  isSupabaseConfigured,
  type RfqProposal,
} from '@/lib/supabase';
import { getRfqProposals } from '@/lib/db/rfq-server';
import {
  resolveRfqActor,
  rfqUnauthorizedResponse,
} from '@/lib/rfq-request-auth';

const MOCK_PROPOSALS: RfqProposal[] = [];

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id: rfqId } = params;

  const actor = await resolveRfqActor(request);
  if (actor?.kind !== 'admin') return rfqUnauthorizedResponse();

  if (!isSupabaseConfigured) {
    const proposals = MOCK_PROPOSALS.filter(p => p.rfq_id === rfqId || rfqId.startsWith('mock'));
    return apiResponse({ proposals, count: proposals.length, mock: true });
  }

  try {
    const proposals = await getRfqProposals(rfqId);
    return apiResponse(
      { proposals, count: proposals.length },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('[rfq/proposals] failed:', sanitizeDbError(error));
    return apiResponse(
      { error: sanitizeDbError(error, '제안서 목록 조회에 실패했습니다.') },
      { status: 500 },
    );
  }
}
