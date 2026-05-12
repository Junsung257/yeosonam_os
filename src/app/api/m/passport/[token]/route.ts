/**
 * POST /api/m/passport/[token] — 여권 정보 제출.
 *
 * 동작:
 *   1. magic-session + scope='passport:upload'
 *   2. surname, given_names, passport_no, expiry_date, scan 받음
 *   3. 사진 → customer-uploads/passport_upload/<tokenId>/
 *   4. passport_no → AES-GCM 암호화 후 metadata.passport.encrypted_no
 *      + passport_no_last4 (마스킹 표시용)
 *   5. single_use=true → used_at 기록 (한 번만 제출)
 *
 * PII 노트: 본 라우트는 PII 처리. metadata 에는 평문 여권번호 절대 저장 X.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { MAGIC_SESSION_COOKIE, verifyMagicSessionToken } from '@/lib/magic-session';
import { supabaseAdmin } from '@/lib/supabase';
import { uploadGuestFile } from '@/lib/magic-link-storage';
import { encrypt } from '@/lib/encryption';
import { recordMagicLinkAudit } from '@/lib/magic-link-audit';
import { rateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const limited = await rateLimit(req, { limit: 5, window: 60, prefix: 'rl-m-passport' });
  if (limited) return limited;

  const { token: tokenIdFromUrl } = await ctx.params;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(MAGIC_SESSION_COOKIE)?.value;
  const session = verifyMagicSessionToken(sessionCookie);

  if (!session.ok || session.payload.aid !== tokenIdFromUrl) {
    return NextResponse.json({ error: 'session_invalid' }, { status: 401 });
  }
  if (!session.payload.scope.includes('passport:upload')) {
    return NextResponse.json({ error: 'no_scope' }, { status: 403 });
  }
  if (session.payload.act !== 'passport_upload') {
    return NextResponse.json({ error: 'wrong_action' }, { status: 400 });
  }

  const fd = await req.formData();
  const surname = sanitizeName((fd.get('surname') as string | null) ?? '', 40);
  const given_names = sanitizeName((fd.get('given_names') as string | null) ?? '', 60);
  const passport_no = sanitizePassportNo((fd.get('passport_no') as string | null) ?? '');
  const expiry_date = sanitizeDate((fd.get('expiry_date') as string | null) ?? '');

  if (!surname) return NextResponse.json({ error: 'surname_required' }, { status: 400 });
  if (!given_names) return NextResponse.json({ error: 'given_names_required' }, { status: 400 });
  if (passport_no.length < 5) return NextResponse.json({ error: 'passport_no_too_short' }, { status: 400 });
  if (!expiry_date) return NextResponse.json({ error: 'expiry_date_invalid' }, { status: 400 });

  const scanFile = fd.get('scan');
  if (!(scanFile instanceof File) || scanFile.size === 0) {
    return NextResponse.json({ error: 'scan_required' }, { status: 400 });
  }

  // 토큰 상태 확인
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
    // single_use — 이미 제출됨, 멱등 redirect
    return NextResponse.redirect(new URL(`/m/passport/${tokenIdFromUrl}`, req.url), { status: 303 });
  }

  // 사진 업로드
  const uploaded = await uploadGuestFile('passport_upload', tokenIdFromUrl, scanFile);
  if (!uploaded.ok) {
    return NextResponse.json({ error: 'scan_upload_failed', reason: uploaded.reason }, { status: 500 });
  }

  // 여권번호 암호화
  let encrypted_no: string;
  try {
    encrypted_no = encrypt(passport_no);
  } catch (e) {
    console.error('[passport] encrypt failed:', e);
    return NextResponse.json({ error: 'encryption_unavailable' }, { status: 500 });
  }

  const passportMeta = {
    surname,
    given_names,
    encrypted_no,
    passport_no_last4: passport_no.slice(-4),
    expiry_date,
    scan: uploaded.result,
    submitted_at: new Date().toISOString(),
  };

  const newMetadata = { ...(row.metadata ?? {}), passport: passportMeta };

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
    actionType: 'passport_upload',
    event: 'consume',
    metadata: {
      source: 'passport_form',
      last4: passport_no.slice(-4),
      has_scan: true,
    },
  });

  return NextResponse.redirect(new URL(`/m/passport/${tokenIdFromUrl}`, req.url), { status: 303 });
}

function sanitizeName(v: string, max: number): string {
  return v.trim().toUpperCase().replace(/[^A-Z \-]/g, '').replace(/\s+/g, ' ').slice(0, max);
}
function sanitizePassportNo(v: string): string {
  return v.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
}
function sanitizeDate(v: string): string | null {
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
