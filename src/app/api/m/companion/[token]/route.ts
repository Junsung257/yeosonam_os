/**
 * POST /api/m/companion/[token] — 동반자 정보 제출.
 *
 * 동작:
 *   1. magic-session 검증 + scope='companion:input'
 *   2. form/json 으로 name_ko, name_en, birth_date, phone, notes 받음
 *   3. magic_action_tokens.metadata.companion_profile 에 저장 + used_at 기록 (atomic)
 *   4. /m/companion/[token] 으로 redirect (Submitted 화면)
 *
 * 어드민 검토: /admin/bookings/[id] 등에서 magic_action_tokens 조회해 companion_profile 표시 → 승인 시 bookings 에 반영.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { MAGIC_SESSION_COOKIE, verifyMagicSessionToken } from '@/lib/magic-session';
import { supabaseAdmin } from '@/lib/supabase';
import { recordMagicLinkAudit } from '@/lib/magic-link-audit';
import { rateLimit, extractClientIp } from '@/lib/rate-limiter';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const limited = await rateLimit(req, { limit: 10, window: 60, prefix: 'rl-m-companion' });
  if (limited) return limited;

  const { token: tokenIdFromUrl } = await ctx.params;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(MAGIC_SESSION_COOKIE)?.value;
  const session = verifyMagicSessionToken(sessionCookie);

  if (!session.ok || session.payload.aid !== tokenIdFromUrl) {
    return NextResponse.json({ error: 'session_invalid' }, { status: 401 });
  }
  if (!session.payload.scope.includes('companion:input')) {
    return NextResponse.json({ error: 'no_scope' }, { status: 403 });
  }
  if (session.payload.act !== 'companion_input') {
    return NextResponse.json({ error: 'wrong_action' }, { status: 400 });
  }

  // body 파싱
  let body: Record<string, string> = {};
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try {
      const j = await req.json();
      body = Object.fromEntries(
        Object.entries(j).map(([k, v]) => [k, typeof v === 'string' ? v : String(v ?? '')]),
      );
    } catch {
      body = {};
    }
  } else {
    const fd = await req.formData();
    for (const [k, v] of fd.entries()) {
      if (typeof v === 'string') body[k] = v;
    }
  }

  // 정규화
  const name_ko = (body.name_ko ?? '').trim().slice(0, 50);
  if (!name_ko) {
    return NextResponse.json({ error: 'name_ko_required' }, { status: 400 });
  }
  const name_en = (body.name_en ?? '').trim().toUpperCase().slice(0, 80);
  const birth_date = sanitizeBirthDate(body.birth_date);
  const phone = sanitizePhone(body.phone);
  const notes = (body.notes ?? '').trim().slice(0, 500);

  const ip = extractClientIp(req);
  const ua = req.headers.get('user-agent') ?? undefined;

  // 기존 metadata 조회 + 결정 여부 확인
  const { data: existing } = await supabaseAdmin
    .from('magic_action_tokens')
    .select('metadata, used_at, revoked_at, expires_at')
    .eq('id', tokenIdFromUrl)
    .limit(1);
  const row = existing?.[0] as
    | { metadata: Record<string, unknown> | null; used_at: string | null; revoked_at: string | null; expires_at: string }
    | undefined;
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (row.revoked_at) return NextResponse.json({ error: 'revoked' }, { status: 410 });
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }
  if (row.used_at) {
    // 이미 제출됨 — 멱등 (재제출 거부, 동반자가 본인 재방문 시 Submitted 표시)
    return NextResponse.redirect(new URL(`/m/companion/${tokenIdFromUrl}`, req.url), { status: 303 });
  }

  const submitted = {
    name_ko,
    ...(name_en ? { name_en } : {}),
    ...(birth_date ? { birth_date } : {}),
    ...(phone ? { phone } : {}),
    ...(notes ? { notes } : {}),
    submitted_at: new Date().toISOString(),
  };

  const newMetadata = {
    ...(row.metadata ?? {}),
    companion_profile: submitted,
  };

  const { error: updErr } = await supabaseAdmin
    .from('magic_action_tokens')
    .update({ metadata: newMetadata, used_at: new Date().toISOString(), use_count: 1 } as never)
    .eq('id', tokenIdFromUrl)
    .is('used_at', null);

  if (updErr) {
    return NextResponse.json({ error: 'persist_failed', detail: updErr.message }, { status: 500 });
  }

  await recordMagicLinkAudit({
    tokenId: tokenIdFromUrl,
    actionType: 'companion_input',
    event: 'consume',
    ip,
    ua,
    metadata: { source: 'companion_form', has_name_en: !!name_en, has_phone: !!phone },
  });

  return NextResponse.redirect(new URL(`/m/companion/${tokenIdFromUrl}`, req.url), { status: 303 });
}

function sanitizeBirthDate(v: string | undefined): string | null {
  if (!v) return null;
  // YYYY-MM-DD 만 허용
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function sanitizePhone(v: string | undefined): string | null {
  if (!v) return null;
  // 숫자·하이픈·플러스만 허용, 최대 20자
  const cleaned = v.trim().replace(/[^\d+\-]/g, '').slice(0, 20);
  return cleaned.length >= 8 ? cleaned : null;
}
