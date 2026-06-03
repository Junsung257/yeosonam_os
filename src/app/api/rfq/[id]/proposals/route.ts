import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  isSupabaseConfigured,
  getRfqProposals,
  type RfqProposal,
} from '@/lib/supabase';

const MOCK_PROPOSALS: RfqProposal[] = [];

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id: rfqId } = params;

  if (!isSupabaseConfigured) {
    const proposals = MOCK_PROPOSALS.filter(p => p.rfq_id === rfqId || rfqId.startsWith('mock'));
    return apiResponse({ proposals, count: proposals.length, mock: true });
  }

  try {
    const proposals = await getRfqProposals(rfqId);
    return apiResponse({ proposals, count: proposals.length });
  } catch (error) {
    console.error('[rfq/proposals] failed:', sanitizeDbError(error));
    return apiResponse(
      { error: sanitizeDbError(error, '제안서 목록 조회에 실패했습니다.') },
      { status: 500 },
    );
  }
}
