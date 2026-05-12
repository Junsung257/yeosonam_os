/**
 * POST /api/admin/magic-links/mint — 어드민 매직링크 발급.
 *
 * Body:
 *   {
 *     actionType: 'booking_portal' | 'guidebook' | 'itinerary_consent' | 'companion_input' | 'review_request' | 'jarvis_session' | ...,
 *     bookingId?: string,
 *     ttlHours?: number,
 *     singleUse?: boolean,
 *     confirmRequired?: boolean,
 *     metadata?: Record<string, unknown>,
 *     recipientChannel?: 'sms' | 'email' | 'alimtalk' | 'manual_share',
 *     recipientPhone?: string,
 *     recipientEmail?: string,
 *   }
 *
 * 응답: { rawToken, url, expiresAt, tokenId } — rawToken 은 1회만 노출.
 *
 * 발송: 본 라우트는 발급만 함. 알림톡/SMS 발송은 사장님 wire 완료 후 별도 라우트에서.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard, resolveAdminActorLabel } from '@/lib/admin-guard';
import { mintMagicToken, type MagicActionType, type MagicRecipientChannel } from '@/lib/magic-link';
import { dispatchMagicLink, type DispatchResult } from '@/lib/magic-link-dispatch';
import { supabaseAdmin } from '@/lib/supabase';

const ALLOWED_ACTIONS: MagicActionType[] = [
  'booking_portal',
  'guidebook',
  'itinerary_consent',
  'passport_upload',
  'review_request',
  'companion_input',
  'jarvis_session',
  // payment_balance 는 결제 인프라 wire 후 허용 (S2)
];

const ALLOWED_CHANNELS: MagicRecipientChannel[] = [
  'sms',
  'email',
  'alimtalk',
  'manual_share',
];

const DEFAULT_TTL_HOURS: Record<MagicActionType, number> = {
  booking_portal: 24 * 90,    // 90일 (기존 정책 호환)
  guidebook: 24 * 14,         // 14일
  payment_balance: 72,
  itinerary_consent: 48,
  passport_upload: 24 * 7,
  review_request: 24 * 30,
  companion_input: 24 * 7,
  jarvis_session: 24,
};

export const POST = withAdminGuard(async (req: NextRequest) => {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const actionType = body.actionType as MagicActionType | undefined;
  if (!actionType || !ALLOWED_ACTIONS.includes(actionType)) {
    return NextResponse.json(
      { error: 'invalid_action_type', allowed: ALLOWED_ACTIONS },
      { status: 400 },
    );
  }

  const bookingId = typeof body.bookingId === 'string' ? body.bookingId : null;
  if (!bookingId && actionType !== 'jarvis_session') {
    return NextResponse.json({ error: 'booking_id_required' }, { status: 400 });
  }

  const ttlHours = clampInt(body.ttlHours, 1, 24 * 365) ?? DEFAULT_TTL_HOURS[actionType];

  const singleUse = body.singleUse !== false; // 기본 true
  const confirmRequired = body.confirmRequired !== false; // 기본 true

  const recipientChannel =
    typeof body.recipientChannel === 'string' &&
    ALLOWED_CHANNELS.includes(body.recipientChannel as MagicRecipientChannel)
      ? (body.recipientChannel as MagicRecipientChannel)
      : 'manual_share';

  const recipientPhone =
    typeof body.recipientPhone === 'string' && body.recipientPhone.trim()
      ? body.recipientPhone.trim()
      : undefined;
  const recipientEmail =
    typeof body.recipientEmail === 'string' && body.recipientEmail.trim()
      ? body.recipientEmail.trim()
      : undefined;

  const metadata =
    body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {};

  const actorLabel = await resolveAdminActorLabel(req);

  const dispatch = body.dispatch === true; // 발급 + 즉시 발송
  const label =
    typeof body.label === 'string' && body.label.trim()
      ? body.label.trim().slice(0, 90)
      : LABELS_BY_ACTION[actionType];

  try {
    const result = await mintMagicToken({
      actionType,
      bookingId: bookingId ?? undefined,
      ttlHours,
      singleUse,
      confirmRequired,
      metadata: { ...metadata, _minted_by: actorLabel },
      recipientChannel,
      recipientPhone,
      recipientEmail,
    });

    let dispatchResult: DispatchResult | null = null;
    if (dispatch) {
      // 고객명 조회 (alimtalk 변수용)
      let customerName: string | undefined;
      if (bookingId) {
        const { data } = await supabaseAdmin
          .from('bookings')
          .select('customers:lead_customer_id(name)')
          .eq('id', bookingId)
          .limit(1);
        const b = data?.[0] as { customers?: { name?: string | null } | null } | undefined;
        customerName = b?.customers?.name ?? undefined;
      }

      dispatchResult = await dispatchMagicLink({
        mintResult: result,
        actionType,
        channel: recipientChannel,
        recipientPhone,
        recipientEmail,
        label,
        customerName,
        bookingId: bookingId ?? null,
      });
    }

    return NextResponse.json({
      tokenId: result.tokenId,
      rawToken: result.rawToken,
      url: result.url,
      expiresAt: result.expiresAt,
      dispatch: dispatchResult,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'mint_failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});

const LABELS_BY_ACTION: Record<MagicActionType, string> = {
  booking_portal: '예약 정보 확인 링크입니다',
  guidebook: '가이드북이 도착했습니다',
  payment_balance: '잔금 결제 안내입니다',
  itinerary_consent: '여행 일정 변경 안내 — 확인 부탁드려요',
  passport_upload: '여권 정보 등록을 부탁드립니다',
  review_request: '여행 후기를 남겨주세요',
  companion_input: '동반자 정보 등록 안내입니다',
  jarvis_session: '여소남 안내 채팅을 시작해요',
};

function clampInt(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < min || i > max) return null;
  return i;
}
