import { NextRequest } from 'next/server';
import { ApiErrors, apiResponse } from '@/lib/api-response';
import { requireAdminRequest } from '@/lib/admin-guard';
import { getAdminContext } from '@/lib/admin-context';
import { findDuplicateCustomers, upsertCustomer, createBooking, supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured) {
    return ApiErrors.unavailable('Supabase가 설정되지 않았습니다.');
  }

  try {
    const body = await request.json();
    const transactionId = typeof body.transactionId === 'string' ? body.transactionId : '';
    const customerName = typeof body.customerName === 'string' ? body.customerName.trim() : '';
    if (!transactionId || !customerName) return ApiErrors.badRequest('transactionId, customerName 필수');

    const actor = getAdminContext(request).actor;

    const dup = await findDuplicateCustomers({ name: customerName, phone: body.phone });
    const reusedCustomer = dup.exact ?? dup.candidates[0] ?? null;
    const customer = reusedCustomer ?? await upsertCustomer({
      name: customerName,
      phone: body.phone ?? null,
      quick_created: true,
      quick_created_tx_id: transactionId,
    });
    if (!customer?.id) return ApiErrors.internalError('고객 생성 실패');

    const booking = await createBooking({
      leadCustomerId: customer.id,
      packageTitle: body.packageTitle || '미지정 상품',
      adultCount: Number(body.adultCount ?? 1),
      childCount: Number(body.childCount ?? 0),
      adultCost: Number(body.adultCost ?? 0),
      adultPrice: Number(body.adultPrice ?? 0),
      childCost: Number(body.childCost ?? 0),
      childPrice: Number(body.childPrice ?? 0),
      fuelSurcharge: Number(body.fuelSurcharge ?? 0),
      departureDate: body.departureDate || undefined,
      landOperator: body.landOperator || undefined,
      quickCreated: true,
      quickCreatedTxId: transactionId,
      status: body.status || 'pending',
    });
    if (!booking?.id) return ApiErrors.internalError('예약 생성 실패');

    const { data: tx, error: txError } = await supabaseAdmin
      .from('bank_transactions')
      .select('amount')
      .eq('id', transactionId)
      .single();
    if (txError || !tx) return ApiErrors.notFound('거래를 찾을 수 없습니다.');

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('match_bank_transaction_allocations', {
      p_transaction_id: transactionId,
      p_allocations: [{ bookingId: booking.id, amount: Number((tx as { amount: number }).amount) }],
      p_match_confidence: 1,
      p_matched_by: actor,
      p_notes: 'quick create customer booking and match',
    });
    if (rpcError) return ApiErrors.internalError(sanitizeDbError(rpcError));

    return apiResponse({
      customer,
      booking,
      reused_customer: !!reusedCustomer,
      match: rpcData,
    });
  } catch (error) {
    return ApiErrors.internalError(error instanceof Error ? error.message : '빠른 생성+매칭 실패');
  }
}
