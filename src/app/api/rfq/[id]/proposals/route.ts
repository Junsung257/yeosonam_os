import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  isSupabaseConfigured,
  getRfqProposals,
} from '@/lib/supabase';
import { sensitiveBackendUnavailable } from '@/lib/sensitive-api-fail-closed';


export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id: rfqId } = params;

  if (!isSupabaseConfigured) {
    return sensitiveBackendUnavailable('rfq_proposals');
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
