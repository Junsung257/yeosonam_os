import { type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { addRfqReaction, countRfqReactions, getRfqShareIdentity } from '@/lib/db/rfq-server';
import { hasValidRfqShareToken } from '@/lib/rfq-request-auth';
import { rateLimit } from '@/lib/rate-limiter';

const REACTION_TYPES = new Set(['like', 'curious', 'vote_a', 'vote_b', 'vote_c']);
const MAX_REACTIONS_PER_RFQ = 5_000;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rfqId, visitorToken, reactionType, comment, shareToken } = body;

    if (typeof rfqId !== 'string' || typeof visitorToken !== 'string' || typeof reactionType !== 'string'
      || typeof shareToken !== 'string' || !REACTION_TYPES.has(reactionType)
      || rfqId.length > 100 || !shareToken.trim() || shareToken.length > 200
      || visitorToken.length < 8 || visitorToken.length > 80
      || (comment !== undefined && (typeof comment !== 'string' || comment.trim().length > 1000))) {
      return apiResponse({ error: '필수 파라미터 누락' }, { status: 400 });
    }

    const globalLimited = await rateLimit(req, {
      limit: 60,
      window: 60,
      prefix: 'rl-rfq-reaction-global',
      failClosed: true,
    });
    if (globalLimited) return globalLimited;

    const identity = await getRfqShareIdentity(rfqId);
    if (!identity) return apiResponse({ error: 'RFQ not found' }, { status: 404 });
    if (!hasValidRfqShareToken(req, identity.share_token, shareToken)) {
      return apiResponse({ error: 'Invalid share token' }, { status: 403 });
    }

    const shareDigest = digest(shareToken);
    const shareLimited = await rateLimit(req, {
      limit: 30,
      window: 60,
      prefix: 'rl-rfq-reaction-share',
      failClosed: true,
      keyFn: () => shareDigest,
    });
    if (shareLimited) return shareLimited;

    const visitorLimited = await rateLimit(req, {
      limit: 6,
      window: 60,
      prefix: 'rl-rfq-reaction-visitor',
      failClosed: true,
      keyFn: () => `${shareDigest}:${digest(visitorToken)}`,
    });
    if (visitorLimited) return visitorLimited;

    if (await countRfqReactions(rfqId) >= MAX_REACTIONS_PER_RFQ) {
      return apiResponse({ error: 'Reaction capacity reached' }, { status: 429 });
    }

    const ok = await addRfqReaction(
      rfqId,
      visitorToken,
      reactionType as 'like' | 'curious' | 'vote_a' | 'vote_b' | 'vote_c',
      typeof comment === 'string' ? comment.trim() || undefined : undefined,
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
