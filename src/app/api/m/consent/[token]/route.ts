/**
 * POST /api/m/consent/[token]
 *
 * 일정 변경 동의/거절 결정 기록.
 *   1. magic-session 쿠키 + scope='consent:sign' 확인
 *   2. body 또는 form decision='accepted'|'declined'
 *   3. magic_action_tokens.metadata.decision 업데이트 + consumeMagicToken
 *   4. /m/consent/[token] 으로 redirect (Resolved 화면)
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { MAGIC_SESSION_COOKIE, verifyMagicSessionToken } from '@/lib/magic-session';
import { consumeMagicToken } from '@/lib/magic-link';
import { supabaseAdmin } from '@/lib/supabase';
import { recordMagicLinkAudit } from '@/lib/magic-link-audit';
import { rateLimit, extractClientIp } from '@/lib/rate-limiter';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const limited = await rateLimit(req, { limit: 10, window: 60, prefix: 'rl-m-consent' });
  if (limited) return limited;

  const { token: tokenIdFromUrl } = await ctx.params;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(MAGIC_SESSION_COOKIE)?.value;
  const session = verifyMagicSessionToken(sessionCookie);

  if (!session.ok || session.payload.aid !== tokenIdFromUrl) {
    return NextResponse.json({ error: 'session_invalid' }, { status: 401 });
  }
  if (!session.payload.scope.includes('consent:sign')) {
    return NextResponse.json({ error: 'no_scope' }, { status: 403 });
  }
  if (session.payload.act !== 'itinerary_consent') {
    return NextResponse.json({ error: 'wrong_action' }, { status: 400 });
  }

  // body 파싱 — JSON 또는 form
  let decision: string | null = null;
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try {
      const j = await req.json();
      decision = j.decision ?? null;
    } catch {
      decision = null;
    }
  } else {
    const fd = await req.formData();
    const v = fd.get('decision');
    decision = typeof v === 'string' ? v : null;
  }

  if (decision !== 'accepted' && decision !== 'declined') {
    return NextResponse.json({ error: 'invalid_decision' }, { status: 400 });
  }

  // rawToken 이 아닌 token_id 로 진입했으므로 — magic_action_tokens 에서 token_hash 가 아닌 id 로 lookup.
  // 표준 consumeMagicToken 은 raw 토큰을 받음. 여기선 token_id 기반 직접 update + 별도 감사 기록.
  // (rawToken 은 client 가 가지지 않음 — POST-confirm 단에서 magic-session 쿠키 발급 시 소진된 적 없음)
  // 그래서 직접 update 로 metadata.decision 추가 + used_at 기록.
  const ip = extractClientIp(req);
  const ua = req.headers.get('user-agent') ?? undefined;

  // 1) 현재 metadata 조회 (이미 결정되었으면 거부)
  const { data: existing } = await supabaseAdmin
    .from('magic_action_tokens')
    .select('metadata, used_at, revoked_at, expires_at')
    .eq('id', tokenIdFromUrl)
    .limit(1);
  const row = existing?.[0] as
    | { metadata: Record<string, unknown> | null; used_at: string | null; revoked_at: string | null; expires_at: string }
    | undefined;
  if (!row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (row.revoked_at) return NextResponse.json({ error: 'revoked' }, { status: 410 });
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }
  if (row.used_at) {
    // 이미 결정됨 — 멱등: 동일 결정이면 통과, 다른 결정이면 거부
    const prev = (row.metadata as { decision?: string } | null)?.decision;
    if (prev === decision) {
      return NextResponse.redirect(new URL(`/m/consent/${tokenIdFromUrl}`, req.url), { status: 303 });
    }
    return NextResponse.json({ error: 'already_decided', previous: prev }, { status: 409 });
  }

  // 2) 결정 기록 + used_at 세팅 (atomic)
  const newMetadata = {
    ...(row.metadata ?? {}),
    decision,
    decision_at: new Date().toISOString(),
  };
  const { error: updErr } = await supabaseAdmin
    .from('magic_action_tokens')
    .update({
      metadata: newMetadata,
      used_at: new Date().toISOString(),
      use_count: 1,
    } as never)
    .eq('id', tokenIdFromUrl)
    .is('used_at', null);

  if (updErr) {
    return NextResponse.json({ error: 'persist_failed', detail: updErr.message }, { status: 500 });
  }

  await recordMagicLinkAudit({
    tokenId: tokenIdFromUrl,
    actionType: 'itinerary_consent',
    event: 'consume',
    ip,
    ua,
    metadata: { decision, source: 'consent_form' },
  });

  return NextResponse.redirect(new URL(`/m/consent/${tokenIdFromUrl}`, req.url), { status: 303 });
}
