/**
 * 매직링크 통합 SSOT — mint / verify / consume / POST-confirm 게이트
 *
 * 설계 결정 (S1):
 *   - 원문 토큰은 발급 시 1회 노출 (응답·알림 메시지). DB 에는 SHA-256 만 저장.
 *   - confirm_required=true 면 첫 GET 으로 토큰 소진하지 않음.
 *     사용자가 /m/[token] 페이지에서 "확인" 버튼 클릭 (POST /api/m/[token]/confirm) 시
 *     confirmed_at 기록 → 액션 페이지로 이동. SafeLinks/Slackbot/Gmail prefetch burn 방지.
 *   - single_use=true: 최초 consume 시 used_at 기록 + use_count=1.
 *     이후 verify 는 통과시키되 consume 은 거부 (이미 사용됨 페이지로 안내).
 *   - 모든 mint/confirm/consume/verify_fail 이벤트는 magic_link_audit 로 기록.
 *
 * 사용 예:
 *   const { rawToken, url, expiresAt } = await mintMagicToken({
 *     actionType: 'payment_balance',
 *     bookingId,
 *     tenantId,
 *     ttlHours: 72,
 *     recipientChannel: 'alimtalk',
 *     recipientPhone: phone,
 *     metadata: { amount: 1_200_000, currency: 'KRW', dueDate: '2026-06-15' },
 *   });
 *   // url 을 알림톡 WL 버튼으로 발송 → 클릭 → /m/[rawToken] 착지 → POST-confirm → 액션 페이지
 */

import { createHash, randomBytes } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { recordMagicLinkAudit } from '@/lib/magic-link-audit';

export type MagicActionType =
  | 'booking_portal'
  | 'guidebook'
  | 'payment_balance'
  | 'itinerary_consent'
  | 'passport_upload'
  | 'review_request'
  | 'companion_input'
  | 'jarvis_session';

export type MagicRecipientChannel =
  | 'sms'
  | 'email'
  | 'alimtalk'
  | 'friend_talk'
  | 'kakao_channel'
  | 'manual_share';

export interface MintInput {
  actionType: MagicActionType;
  bookingId?: string | null;
  tenantId?: string | null;
  customerId?: string | null;
  metadata?: Record<string, unknown>;
  ttlHours: number;
  singleUse?: boolean;
  confirmRequired?: boolean;
  recipientChannel?: MagicRecipientChannel;
  /** 전화번호 또는 이메일 — DB 에는 SHA-256 만 저장 */
  recipientPhone?: string;
  recipientEmail?: string;
  createdBy?: string | null;
}

export interface MintResult {
  tokenId: string;
  rawToken: string;
  url: string;
  expiresAt: string;
}

export interface VerifiedToken {
  id: string;
  actionType: MagicActionType;
  bookingId: string | null;
  tenantId: string | null;
  customerId: string | null;
  metadata: Record<string, unknown>;
  singleUse: boolean;
  confirmRequired: boolean;
  confirmedAt: string | null;
  usedAt: string | null;
  useCount: number;
  expiresAt: string;
}

export type VerifyFailReason =
  | 'not_found'
  | 'expired'
  | 'revoked'
  | 'used'
  | 'requires_confirm';

export type VerifyResult =
  | { ok: true; token: VerifiedToken }
  | { ok: false; reason: VerifyFailReason; token?: VerifiedToken };

// ─────────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────────

export function hashMagicToken(raw: string): string {
  return createHash('sha256').update(raw.trim(), 'utf8').digest('hex');
}

export function hashRecipient(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase(), 'utf8').digest('hex');
}

function generateRawToken(): string {
  // 32 bytes → 43 chars base64url. URL-safe, prediction-resistant.
  return randomBytes(32).toString('base64url');
}

export function buildMagicLinkUrl(rawToken: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  if (!base) return `/m/${rawToken}`;
  return `${base}/m/${rawToken}`;
}

// ─────────────────────────────────────────────────────────────────────
// MINT
// ─────────────────────────────────────────────────────────────────────

export async function mintMagicToken(input: MintInput): Promise<MintResult> {
  const rawToken = generateRawToken();
  const tokenHash = hashMagicToken(rawToken);
  const expiresAt = new Date(Date.now() + input.ttlHours * 3_600_000).toISOString();
  const singleUse = input.singleUse !== false;
  const confirmRequired = input.confirmRequired !== false;

  let recipientHash: string | null = null;
  if (input.recipientPhone) recipientHash = hashRecipient(input.recipientPhone);
  else if (input.recipientEmail) recipientHash = hashRecipient(input.recipientEmail);

  const row = {
    token_hash: tokenHash,
    action_type: input.actionType,
    booking_id: input.bookingId ?? null,
    tenant_id: input.tenantId ?? null,
    customer_id: input.customerId ?? null,
    metadata: input.metadata ?? {},
    recipient_channel: input.recipientChannel ?? null,
    recipient_hash: recipientHash,
    single_use: singleUse,
    confirm_required: confirmRequired,
    expires_at: expiresAt,
    created_by: input.createdBy ?? null,
  };

  const { data, error } = await supabaseAdmin
    .from('magic_action_tokens')
    .insert(row as never)
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`mintMagicToken failed: ${error?.message ?? 'unknown'}`);
  }
  const inserted = data as { id: string };

  await recordMagicLinkAudit({
    tokenId: inserted.id,
    actionType: input.actionType,
    event: 'mint',
    recipientHash,
    metadata: {
      channel: input.recipientChannel,
      ttl_hours: input.ttlHours,
      single_use: singleUse,
      confirm_required: confirmRequired,
    },
  });

  return {
    tokenId: inserted.id,
    rawToken,
    url: buildMagicLinkUrl(rawToken),
    expiresAt,
  };
}

// ─────────────────────────────────────────────────────────────────────
// VERIFY (read-only — POST-confirm 게이트 확인)
// ─────────────────────────────────────────────────────────────────────

type DbTokenRow = {
  id: string;
  action_type: MagicActionType;
  booking_id: string | null;
  tenant_id: string | null;
  customer_id: string | null;
  metadata: Record<string, unknown> | null;
  single_use: boolean;
  confirm_required: boolean;
  confirmed_at: string | null;
  used_at: string | null;
  use_count: number;
  expires_at: string;
  revoked_at: string | null;
};

function toVerified(row: DbTokenRow): VerifiedToken {
  return {
    id: row.id,
    actionType: row.action_type,
    bookingId: row.booking_id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    metadata: row.metadata ?? {},
    singleUse: row.single_use,
    confirmRequired: row.confirm_required,
    confirmedAt: row.confirmed_at,
    usedAt: row.used_at,
    useCount: row.use_count,
    expiresAt: row.expires_at,
  };
}

const TOKEN_SELECT =
  'id, action_type, booking_id, tenant_id, customer_id, metadata, single_use, confirm_required, confirmed_at, used_at, use_count, expires_at, revoked_at';

/**
 * 토큰 원문으로 행을 조회. 만료/revoked/used 여부도 함께 반환.
 * verify 만으로는 confirmed_at·used_at 을 변경하지 않음.
 */
export async function verifyMagicToken(
  rawToken: string,
  opts: { auditContext?: { ip?: string; ua?: string } } = {},
): Promise<VerifyResult> {
  if (!rawToken || rawToken.length < 16) {
    await recordMagicLinkAudit({
      event: 'verify_fail',
      success: false,
      metadata: { reason: 'malformed' },
      ip: opts.auditContext?.ip,
      ua: opts.auditContext?.ua,
    });
    return { ok: false, reason: 'not_found' };
  }

  const tokenHash = hashMagicToken(rawToken);
  const { data: rawData, error } = await supabaseAdmin
    .from('magic_action_tokens')
    .select(TOKEN_SELECT)
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !rawData) {
    await recordMagicLinkAudit({
      event: 'verify_fail',
      success: false,
      metadata: { reason: 'not_found' },
      ip: opts.auditContext?.ip,
      ua: opts.auditContext?.ua,
    });
    return { ok: false, reason: 'not_found' };
  }

  const data = rawData as DbTokenRow;
  const verified = toVerified(data);

  if (data.revoked_at) {
    await recordMagicLinkAudit({
      tokenId: data.id,
      actionType: data.action_type,
      event: 'verify_fail',
      success: false,
      metadata: { reason: 'revoked' },
      ip: opts.auditContext?.ip,
      ua: opts.auditContext?.ua,
    });
    return { ok: false, reason: 'revoked', token: verified };
  }

  if (new Date(data.expires_at).getTime() <= Date.now()) {
    await recordMagicLinkAudit({
      tokenId: data.id,
      actionType: data.action_type,
      event: 'expire',
      success: false,
      ip: opts.auditContext?.ip,
      ua: opts.auditContext?.ua,
    });
    return { ok: false, reason: 'expired', token: verified };
  }

  if (data.single_use && data.used_at) {
    return { ok: false, reason: 'used', token: verified };
  }

  return { ok: true, token: verified };
}

// ─────────────────────────────────────────────────────────────────────
// POST-CONFIRM (사용자가 /m/[token] 에서 "확인" 버튼 클릭)
// ─────────────────────────────────────────────────────────────────────

/**
 * POST-confirm: SafeLinks/AV burn 방지 게이트.
 * 첫 GET 에는 confirmed_at 미기록 → 사용자 클릭(POST) 시에만 기록.
 * 이미 confirmed 면 멱등 (재클릭 OK).
 */
export async function confirmMagicToken(
  rawToken: string,
  opts: { ip?: string; ua?: string } = {},
): Promise<VerifyResult> {
  const verify = await verifyMagicToken(rawToken, { auditContext: opts });
  if (!verify.ok) return verify;

  const token = verify.token;
  if (!token.confirmRequired || token.confirmedAt) {
    // 이미 확정 또는 confirm 불필요 → 그대로 통과
    return verify;
  }

  const { data: rawData, error } = await supabaseAdmin
    .from('magic_action_tokens')
    .update({ confirmed_at: new Date().toISOString() } as never)
    .eq('id', token.id)
    .select(TOKEN_SELECT)
    .single();

  if (error || !rawData) {
    return { ok: false, reason: 'not_found' };
  }

  await recordMagicLinkAudit({
    tokenId: token.id,
    actionType: token.actionType,
    event: 'confirm',
    ip: opts.ip,
    ua: opts.ua,
  });

  return { ok: true, token: toVerified(rawData as DbTokenRow) };
}

// ─────────────────────────────────────────────────────────────────────
// CONSUME (single_use 토큰을 실제로 액션 수행하며 사용 처리)
// ─────────────────────────────────────────────────────────────────────

/**
 * 액션 실행 직전 호출. single_use=true 면 used_at 기록 + use_count 증가.
 * confirm_required=true 인데 confirmed_at 미기록이면 'requires_confirm' 반환.
 * single_use=false (reusable) 이면 use_count 만 증가, used_at 은 기록 X.
 */
export async function consumeMagicToken(
  rawToken: string,
  opts: { ip?: string; ua?: string } = {},
): Promise<VerifyResult> {
  const verify = await verifyMagicToken(rawToken, { auditContext: opts });
  if (!verify.ok) return verify;

  const token = verify.token;
  if (token.confirmRequired && !token.confirmedAt) {
    return { ok: false, reason: 'requires_confirm', token };
  }

  // single_use 면 atomically 1회만 used_at 세팅 (race condition 차단)
  if (token.singleUse) {
    const { data: rawData, error } = await supabaseAdmin
      .from('magic_action_tokens')
      .update({
        used_at: new Date().toISOString(),
        use_count: 1,
      } as never)
      .eq('id', token.id)
      .is('used_at', null) // 이미 사용된 토큰엔 update 미적용
      .select(TOKEN_SELECT)
      .maybeSingle();

    if (error) {
      return { ok: false, reason: 'not_found' };
    }
    if (!rawData) {
      // 경쟁 상태 — 다른 요청이 먼저 used
      return { ok: false, reason: 'used', token };
    }

    await recordMagicLinkAudit({
      tokenId: token.id,
      actionType: token.actionType,
      event: 'consume',
      ip: opts.ip,
      ua: opts.ua,
    });
    return { ok: true, token: toVerified(rawData as DbTokenRow) };
  }

  // reusable: use_count 증가 (use_count 정확도 손해는 reusable 토큰엔 critical 아님)
  const { data: rawUpdated } = await supabaseAdmin
    .from('magic_action_tokens')
    .update({ use_count: token.useCount + 1 } as never)
    .eq('id', token.id)
    .select(TOKEN_SELECT)
    .single();

  await recordMagicLinkAudit({
    tokenId: token.id,
    actionType: token.actionType,
    event: 'consume',
    ip: opts.ip,
    ua: opts.ua,
    metadata: { reusable: true },
  });

  const updatedRow = (rawUpdated as DbTokenRow | null) ?? {
    id: token.id,
    action_type: token.actionType,
    booking_id: token.bookingId,
    tenant_id: token.tenantId,
    customer_id: token.customerId,
    metadata: token.metadata,
    single_use: false,
    confirm_required: token.confirmRequired,
    confirmed_at: token.confirmedAt,
    used_at: null,
    use_count: token.useCount + 1,
    expires_at: token.expiresAt,
    revoked_at: null,
  };
  return { ok: true, token: toVerified(updatedRow) };
}

// ─────────────────────────────────────────────────────────────────────
// REVOKE (어드민 폐기)
// ─────────────────────────────────────────────────────────────────────

export async function revokeMagicToken(
  tokenId: string,
  reason: string,
  revokedBy?: string | null,
): Promise<void> {
  await supabaseAdmin
    .from('magic_action_tokens')
    .update({
      revoked_at: new Date().toISOString(),
      revoked_reason: reason,
    } as never)
    .eq('id', tokenId);

  await recordMagicLinkAudit({
    tokenId,
    event: 'revoke',
    metadata: { reason, revoked_by: revokedBy ?? null },
  });
}
