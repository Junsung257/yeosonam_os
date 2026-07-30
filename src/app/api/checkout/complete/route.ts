import { NextRequest } from 'next/server';

import { apiResponse } from '@/lib/api-response';
import { deductInventory } from '@/lib/db/tenant';
import { bookProduct, cancelProduct } from '@/lib/mock-apis';
import {
  ApiOrder,
  SagaEvent,
  VoucherItem,
  getSupabaseAdmin,
  getTransaction,
  isSupabaseConfigured,
  updateApiOrder,
  updateTransaction,
  upsertCart,
} from '@/lib/supabase';
import { recordServerAnalyticsEvent } from '@/lib/analytics/server-events';

export const dynamic = 'force-dynamic';

type CheckoutCompleteRequest = {
  transactionId?: unknown;
  paymentConfirmationId?: unknown;
};

type CheckoutPaymentConfirmation = {
  id: string;
  transaction_id: string;
  provider: string;
  provider_payment_id: string;
  provider_order_id: string | null;
  amount_krw: number;
  currency: string;
  status: 'verified' | 'voided' | 'refunded';
  verified_at: string;
};

function noStore(init?: ResponseInit) {
  return {
    ...init,
    headers: { ...Object.fromEntries(new Headers(init?.headers)), 'Cache-Control': 'private, no-store' },
  };
}

function addSagaEvent(log: SagaEvent[], event: string, detail?: string): SagaEvent[] {
  return [...log, { event, timestamp: new Date().toISOString(), detail }];
}

function generateVoucherCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function parseString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function readVerifiedPaymentConfirmation(
  transactionId: string,
  paymentConfirmationId?: string,
): Promise<{ confirmation: CheckoutPaymentConfirmation | null; unavailable: boolean; error?: string }> {
  const sb = getSupabaseAdmin();
  if (!sb) return { confirmation: null, unavailable: true, error: 'Supabase admin client unavailable' };

  let query = sb
    .from('checkout_payment_confirmations')
    .select(
      'id, transaction_id, provider, provider_payment_id, provider_order_id, amount_krw, currency, status, verified_at',
    )
    .eq('transaction_id', transactionId)
    .eq('status', 'verified')
    .order('verified_at', { ascending: false })
    .limit(1);

  if (paymentConfirmationId) query = query.eq('id', paymentConfirmationId);

  const { data, error } = await query.maybeSingle();
  if (error) {
    return { confirmation: null, unavailable: true, error: error.message };
  }

  return { confirmation: data as CheckoutPaymentConfirmation | null, unavailable: false };
}

async function claimCheckoutCompletion(
  transactionId: string,
  paymentConfirmationId: string,
): Promise<{ claimed: boolean; unavailable: boolean; error?: string }> {
  const sb = getSupabaseAdmin();
  if (!sb) return { claimed: false, unavailable: true, error: 'Supabase admin client unavailable' };

  const { error } = await sb
    .from('checkout_completion_claims')
    .insert({
      transaction_id: transactionId,
      payment_confirmation_id: paymentConfirmationId,
      status: 'processing',
    } as never);

  if (!error) return { claimed: true, unavailable: false };

  if (error.code === '23505') {
    return { claimed: false, unavailable: false, error: 'completion already claimed' };
  }

  return { claimed: false, unavailable: true, error: error.message };
}

async function markClaim(
  transactionId: string,
  updates: { status: 'completed' | 'failed'; last_error?: string },
): Promise<void> {
  const sb = getSupabaseAdmin();
  if (!sb) return;

  await sb
    .from('checkout_completion_claims')
    .update({
      ...updates,
      completed_at: updates.status === 'completed' ? new Date().toISOString() : null,
    } as never)
    .eq('transaction_id', transactionId);
}

function buildTenantCostBreakdown(orders: ApiOrder[]): Record<string, number> {
  return orders.reduce<Record<string, number>>((acc, order) => {
    const tenantId = typeof order.attrs?.tenant_id === 'string' ? order.attrs.tenant_id : null;
    const isFixed = order.product_category === 'FIXED' || (!order.product_category && order.api_name === 'tenant_product');
    if (!tenantId || !isFixed) return acc;
    acc[tenantId] = (acc[tenantId] ?? 0) + order.cost;
    return acc;
  }, {});
}

/**
 * Completes a server-created checkout transaction only after a server-side
 * payment confirmation has already been verified and stored. The request may
 * identify records, but it never supplies trusted price, cost, PII, voucher, or
 * provider success data.
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse(
      { code: 'CHECKOUT_COMPLETE_UNAVAILABLE', error: 'checkout completion is unavailable' },
      noStore({ status: 503 }),
    );
  }

  let body: CheckoutCompleteRequest;
  try {
    body = await request.json();
  } catch {
    return apiResponse(
      { code: 'CHECKOUT_COMPLETE_INVALID_JSON', error: 'invalid JSON body' },
      noStore({ status: 400 }),
    );
  }

  const transactionId = parseString(body.transactionId);
  const paymentConfirmationId = parseString(body.paymentConfirmationId);
  if (!transactionId) {
    return apiResponse(
      { code: 'CHECKOUT_COMPLETE_INVALID_INPUT', error: 'transactionId is required' },
      noStore({ status: 400 }),
    );
  }

  const txn = await getTransaction(transactionId);
  if (!txn) {
    return apiResponse(
      { code: 'CHECKOUT_TRANSACTION_NOT_FOUND', error: 'checkout transaction not found' },
      noStore({ status: 404 }),
    );
  }

  if (txn.status === 'COMPLETED') {
    return apiResponse(
      {
        transaction_id: txn.id,
        status: txn.status,
        vouchers: txn.vouchers ?? [],
        total_price: txn.total_price,
        idempotent: true,
      },
      noStore(),
    );
  }

  if (txn.status !== 'PENDING') {
    return apiResponse(
      { code: 'CHECKOUT_TRANSACTION_NOT_COMPLETABLE', error: 'checkout transaction is not pending' },
      noStore({ status: 409 }),
    );
  }

  const orders = txn.api_orders ?? [];
  if (orders.length === 0 || orders.some(order => order.status !== 'PENDING')) {
    return apiResponse(
      { code: 'CHECKOUT_ORDERS_NOT_COMPLETABLE', error: 'checkout orders are not ready for completion' },
      noStore({ status: 409 }),
    );
  }

  const paymentResult = await readVerifiedPaymentConfirmation(transactionId, paymentConfirmationId ?? undefined);
  if (paymentResult.unavailable) {
    return apiResponse(
      {
        code: 'CHECKOUT_PAYMENT_CONFIRMATION_UNAVAILABLE',
        error: 'verified payment confirmation store is unavailable',
      },
      noStore({ status: 503 }),
    );
  }

  const confirmation = paymentResult.confirmation;
  if (!confirmation) {
    return apiResponse(
      { code: 'CHECKOUT_PAYMENT_NOT_VERIFIED', error: 'verified payment confirmation not found' },
      noStore({ status: 409 }),
    );
  }

  if (confirmation.currency !== 'KRW' || Number(confirmation.amount_krw) !== Number(txn.total_price)) {
    return apiResponse(
      { code: 'CHECKOUT_PAYMENT_AMOUNT_MISMATCH', error: 'verified payment amount does not match checkout total' },
      noStore({ status: 409 }),
    );
  }

  const claim = await claimCheckoutCompletion(transactionId, confirmation.id);
  if (claim.unavailable) {
    return apiResponse(
      { code: 'CHECKOUT_COMPLETION_CLAIM_UNAVAILABLE', error: 'checkout completion claim store is unavailable' },
      noStore({ status: 503 }),
    );
  }

  if (!claim.claimed) {
    const latest = await getTransaction(transactionId);
    if (latest?.status === 'COMPLETED') {
      return apiResponse(
        {
          transaction_id: latest.id,
          status: latest.status,
          vouchers: latest.vouchers ?? [],
          total_price: latest.total_price,
          idempotent: true,
        },
        noStore(),
      );
    }

    return apiResponse(
      { code: 'CHECKOUT_COMPLETION_ALREADY_CLAIMED', error: 'checkout completion is already processing' },
      noStore({ status: 409 }),
    );
  }

  let sagaLog: SagaEvent[] = addSagaEvent(
    txn.saga_log ?? [],
    'PAYMENT_VERIFIED',
    `${confirmation.provider}:${confirmation.provider_order_id ?? confirmation.provider_payment_id}`,
  );

  try {
    await updateTransaction(txn.id, { status: 'CUSTOMER_PAID', saga_log: sagaLog });

    sagaLog = addSagaEvent(sagaLog, 'API_PROCESSING', `${orders.length} orders started`);
    await updateTransaction(txn.id, { status: 'API_PROCESSING', saga_log: sagaLog });

    const bookResults = await Promise.allSettled(
      orders.map(async (order) => {
        const result = await bookProduct(order.api_name, order.product_id, order.quantity);
        await updateApiOrder(order.id, { status: 'CONFIRMED', external_ref: result.external_ref });
        return { order, external_ref: result.external_ref };
      }),
    );

    const succeeded = bookResults
      .filter(
        (result): result is PromiseFulfilledResult<{ order: ApiOrder; external_ref: string }> =>
          result.status === 'fulfilled',
      )
      .map(result => result.value);

    const failed = bookResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => (result.reason instanceof Error ? result.reason : new Error(String(result.reason))));

    if (failed.length > 0) {
      await Promise.allSettled(
        succeeded.map(async ({ order, external_ref }) => {
          await cancelProduct(order.api_name, external_ref);
          await updateApiOrder(order.id, { status: 'REFUNDED' });
        }),
      );

      const failedOrders = orders.filter((_order, index) => bookResults[index]?.status === 'rejected');
      await Promise.allSettled(failedOrders.map(order => updateApiOrder(order.id, { status: 'CANCELLED' })));

      sagaLog = addSagaEvent(sagaLog, 'ROLLBACK', `failed=${failed.length}; rolled_back=${succeeded.length}`);
      await updateTransaction(txn.id, { status: 'PARTIAL_FAIL', saga_log: sagaLog });
      await markClaim(txn.id, { status: 'failed', last_error: failed.map(error => error.message).join(', ') });

      return apiResponse(
        {
          transaction_id: txn.id,
          status: 'PARTIAL_FAIL',
          failed_count: failed.length,
        },
        noStore({ status: 202 }),
      );
    }

    try {
      await Promise.all(
        succeeded.map(async ({ order }) => {
          const date = typeof order.attrs?.date === 'string' ? order.attrs.date : null;
          const isFixed =
            order.product_category === 'FIXED' || (!order.product_category && order.api_name === 'tenant_product');
          if (isFixed && date) {
            await deductInventory(order.product_id, date, order.quantity);
          }
        }),
      );
    } catch (inventoryError) {
      await Promise.allSettled(
        succeeded.map(async ({ order, external_ref }) => {
          await cancelProduct(order.api_name, external_ref);
          await updateApiOrder(order.id, { status: 'REFUNDED' });
        }),
      );

      const message = inventoryError instanceof Error ? inventoryError.message : 'inventory deduction failed';
      sagaLog = addSagaEvent(sagaLog, 'ROLLBACK', `inventory failed; rolled_back=${succeeded.length}`);
      await updateTransaction(txn.id, { status: 'PARTIAL_FAIL', saga_log: sagaLog });
      await markClaim(txn.id, { status: 'failed', last_error: message });

      return apiResponse(
        {
          transaction_id: txn.id,
          status: 'PARTIAL_FAIL',
          failed_reason: 'inventory',
        },
        noStore({ status: 202 }),
      );
    }

    const confirmedOrders = succeeded.map(({ order }) => order);
    const vouchers: VoucherItem[] = confirmedOrders.map(order => ({
      code: generateVoucherCode(),
      product_name: order.product_name,
      product_type: order.product_type,
    }));

    const tenantCostBreakdown = buildTenantCostBreakdown(confirmedOrders);
    sagaLog = addSagaEvent(sagaLog, 'COMPLETED', `vouchers=${vouchers.length}`);
    await updateTransaction(txn.id, {
      status: 'COMPLETED',
      saga_log: sagaLog,
      vouchers,
      tenant_cost_breakdown: Object.keys(tenantCostBreakdown).length > 0 ? tenantCostBreakdown : undefined,
    });
    await upsertCart(txn.session_id, []);
    await markClaim(txn.id, { status: 'completed' });
    try {
      await recordServerAnalyticsEvent({
        eventName: 'purchase',
        idempotencyKey: `checkout-purchase:${txn.id}`,
        sourceType: 'checkout_transaction',
        sourceId: txn.id,
        transactionId: txn.id,
        valueKrw: Math.round(Number(txn.total_price)),
        payload: {
          transaction_id: txn.id,
          currency: 'KRW',
          value: Math.round(Number(txn.total_price)),
          items: confirmedOrders.map(order => ({
            item_id: order.product_id,
            item_name: order.product_name,
            item_category: order.product_type.toLowerCase(),
            price: order.price,
            quantity: order.quantity,
          })),
        },
      });
    } catch (analyticsError) {
      console.warn('[checkout/complete] analytics event recording failed:', analyticsError);
    }

    return apiResponse(
      {
        transaction_id: txn.id,
        status: 'COMPLETED',
        vouchers,
        total_price: txn.total_price,
        payment_confirmation_id: confirmation.id,
      },
      noStore(),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'checkout completion failed';
    await markClaim(txn.id, { status: 'failed', last_error: message });
    throw error;
  }
}
