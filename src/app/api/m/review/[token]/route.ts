/**
 * POST /api/m/review/[token] — 리뷰 제출 (multipart/form-data).
 *
 * 동작:
 *   1. magic-session + scope='review:submit'
 *   2. rating(1-5), text(<=1500), photos[] 받음
 *   3. 사진 업로드 → customer-uploads/review_request/<tokenId>/
 *   4. metadata.review 누적 update (사진 path 배열 append)
 *   5. /m/review/[token] 으로 redirect (Submitted 표시는 페이지 내 review.submitted_at 으로)
 *
 * 토큰: reusable (single_use=false 기본). 같은 사용자가 사진 추가 가능.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { MAGIC_SESSION_COOKIE, verifyMagicSessionToken } from '@/lib/magic-session';
import { supabaseAdmin } from '@/lib/supabase';
import { uploadGuestFile } from '@/lib/magic-link-storage';
import { recordMagicLinkAudit } from '@/lib/magic-link-audit';
import { rateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_PHOTOS = 5;

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const limited = await rateLimit(req, { limit: 5, window: 60, prefix: 'rl-m-review' });
  if (limited) return limited;

  const { token: tokenIdFromUrl } = await ctx.params;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(MAGIC_SESSION_COOKIE)?.value;
  const session = verifyMagicSessionToken(sessionCookie);

  if (!session.ok || session.payload.aid !== tokenIdFromUrl) {
    return NextResponse.json({ error: 'session_invalid' }, { status: 401 });
  }
  if (!session.payload.scope.includes('review:submit')) {
    return NextResponse.json({ error: 'no_scope' }, { status: 403 });
  }
  if (session.payload.act !== 'review_request') {
    return NextResponse.json({ error: 'wrong_action' }, { status: 400 });
  }

  const fd = await req.formData();
  const rating = Number(fd.get('rating'));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'rating_required' }, { status: 400 });
  }
  const text = (fd.get('text') as string | null)?.trim().slice(0, 1500) ?? '';

  // 기존 metadata + review 조회
  const { data: existing } = await supabaseAdmin
    .from('magic_action_tokens')
    .select('metadata, used_at, revoked_at, expires_at, booking_id')
    .eq('id', tokenIdFromUrl)
    .limit(1);
  const row = existing?.[0] as
    | { metadata: Record<string, unknown> | null; used_at: string | null; revoked_at: string | null; expires_at: string; booking_id: string | null }
    | undefined;
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (row.revoked_at) return NextResponse.json({ error: 'revoked' }, { status: 410 });
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }

  const prevReview = (row.metadata?.review ?? {}) as {
    rating?: number;
    text?: string;
    photos?: { path: string; size: number; contentType: string }[];
  };
  const prevPhotos = Array.isArray(prevReview.photos) ? prevReview.photos : [];

  // 사진 업로드
  const uploaded: { path: string; size: number; contentType: string }[] = [];
  const photoEntries = fd.getAll('photos').filter((v): v is File => v instanceof File);
  const photosToProcess = photoEntries.slice(0, Math.max(0, MAX_PHOTOS - prevPhotos.length));

  for (const file of photosToProcess) {
    if (file.size === 0) continue;
    const r = await uploadGuestFile('review_request', tokenIdFromUrl, file);
    if (r.ok) {
      uploaded.push(r.result);
    } else {
      console.warn('[review-upload] skip:', r.reason);
    }
  }

  const newReview = {
    rating,
    text,
    photos: [...prevPhotos, ...uploaded],
    submitted_at: new Date().toISOString(),
  };

  const newMetadata = { ...(row.metadata ?? {}), review: newReview };

  await supabaseAdmin
    .from('magic_action_tokens')
    .update({ metadata: newMetadata, use_count: ((row.metadata?.review as { rating?: number })?.rating ? 1 : 0) + 1 } as never)
    .eq('id', tokenIdFromUrl);

  await recordMagicLinkAudit({
    tokenId: tokenIdFromUrl,
    actionType: 'review_request',
    event: 'consume',
    metadata: {
      source: 'review_form',
      rating,
      photo_count: uploaded.length,
      total_photos: prevPhotos.length + uploaded.length,
    },
  });

  return NextResponse.redirect(new URL(`/m/review/${tokenIdFromUrl}`, req.url), { status: 303 });
}
