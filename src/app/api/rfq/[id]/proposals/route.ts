import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  isSupabaseConfigured,
} from '@/lib/supabase';
import { sensitiveBackendUnavailable } from '@/lib/sensitive-api-fail-closed';
import { getRfqProposals } from '@/lib/db/rfq-server';
import {
  resolveRfqActor,
  rfqUnauthorizedResponse,
} from '@/lib/rfq-request-auth';


export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id: rfqId } = params;

  const actor = await resolveRfqActor(request);
  if (actor?.kind !== 'admin') return rfqUnauthorizedResponse();

  if (!isSupabaseConfigured) {
    return sensitiveBackendUnavailable('rfq_proposals');
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
