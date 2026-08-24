import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { getAdminContext } from '@/lib/admin-context';
import { apiResponse } from '@/lib/api-response';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

type FinalizeBody = {
  confirm?: boolean;
  settlement_mode?: 'accrual' | 'cash';
  reason?: string;
  idempotency_key?: string;
};

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 503 });
  }

  const { id } = await props.params;
  if (!id) return apiResponse({ error: '예약 ID가 필요합니다.' }, { status: 400 });

  let body: FinalizeBody;
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'Request body가 유효한 JSON이 아닙니다.' }, { status: 400 });
  }

  const confirm = body.confirm !== false;
  const mode = body.settlement_mode ?? 'cash';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const idempotencyKey = typeof body.idempotency_key === 'string'
    ? body.idempotency_key.trim()
    : '';

  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 160) {
    return apiResponse({ error: 'idempotency_key가 필요합니다.', code: 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 400 });
  }
  if (!reason || reason.length < 5) {
    return apiResponse({ error: '정산 확정·해제 사유는 5자 이상이어야 합니다.', code: 'SETTLEMENT_REASON_REQUIRED' }, { status: 400 });
  }
  const actor = getAdminContext(request).actor;

  const { data: clobeKey, error: clobeKeyError } = await supabaseAdmin
    .from('booking_settlement_keys')
    .select('id, source, metadata')
    .eq('booking_id', id)
    .eq('status', 'active')
    .or('source.eq.clobe_memo_created_booking,source.eq.bank_memo_created_booking')
    .limit(1)
    .maybeSingle();
  if (clobeKeyError) {
    return apiResponse({ error: clobeKeyError.message, code: clobeKeyError.code }, { status: 500 });
  }
  const isClobeSettlement = Boolean(clobeKey);

  const rpc = supabaseAdmin.rpc as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
  const { data: command, error: rpcError } = await rpc(
    isClobeSettlement ? 'finalize_clobe_booking_settlement' : 'finalize_booking_settlement',
    isClobeSettlement
      ? {
          p_booking_id: id,
          p_confirm: confirm,
          p_reason: reason,
          p_idempotency_key: idempotencyKey,
          p_actor: actor,
        }
      : {
          p_booking_id: id,
          p_confirm: confirm,
          p_settlement_mode: mode,
          p_reason: reason,
          p_idempotency_key: idempotencyKey,
          p_actor: actor,
        },
  );

  if (rpcError) {
    const code = rpcError.code;
    return apiResponse(
      { error: rpcError.message, code },
      { status: code === 'P0002' ? 404 : code === 'P0001' ? 409 : 400 },
    );
  }

  const { data: booking, error: bookingError } = await supabaseAdmin
    .from('bookings')
    .select('*, customers!lead_customer_id(id, name, phone)')
    .eq('id', id)
    .single();
  if (bookingError) {
    return apiResponse({ error: bookingError.message, code: bookingError.code }, { status: 500 });
  }

  return apiResponse({ booking, command, idempotency_key: idempotencyKey });
}
