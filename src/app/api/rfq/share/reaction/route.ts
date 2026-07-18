import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { addRfqReaction, getRfqShareIdentity } from '@/lib/db/rfq-server';
import { hasValidRfqShareToken } from '@/lib/rfq-request-auth';

const REACTION_TYPES = new Set(['like', 'curious', 'vote_a', 'vote_b', 'vote_c']);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rfqId, visitorToken, reactionType, comment, shareToken } = body;

    if (typeof rfqId !== 'string' || typeof visitorToken !== 'string' || typeof reactionType !== 'string'
      || typeof shareToken !== 'string' || !REACTION_TYPES.has(reactionType)
      || rfqId.length > 100 || visitorToken.length < 8 || visitorToken.length > 200
      || (comment !== undefined && (typeof comment !== 'string' || comment.length > 1000))) {
      return apiResponse({ error: '필수 파라미터 누락' }, { status: 400 });
    }

    const identity = await getRfqShareIdentity(rfqId);
    if (!identity) return apiResponse({ error: 'RFQ not found' }, { status: 404 });
    if (!hasValidRfqShareToken(req, identity.share_token, shareToken)) {
      return apiResponse({ error: 'Invalid share token' }, { status: 403 });
    }

    const ok = await addRfqReaction(
      rfqId,
      visitorToken,
      reactionType as 'like' | 'curious' | 'vote_a' | 'vote_b' | 'vote_c',
      comment,
    );
    if (!ok) {
      return apiResponse({ error: '반응 저장 실패' }, { status: 500 });
    }

    return apiResponse({ success: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    console.error('Reaction API error:', sanitizeDbError(e));
    return apiResponse({ error: '서버 오류' }, { status: 500 });
  }
}
