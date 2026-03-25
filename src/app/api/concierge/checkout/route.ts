/**
 * Saga 결제 오케스트레이터
 * 멱등성 키 → CUSTOMER_PAID → API_PROCESSING → COMPLETED / PARTIAL_FAIL (+ 롤백)
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  getCart,
  upsertCart,
  createTransaction,
  updateTransaction,
  createApiOrder,
  updateApiOrder,
  getTransactionByIdempotencyKey,
  deductInventory,
  resolveProductCategory,
  SagaEvent,
  VoucherItem,
} from '@/lib/supabase';
import { bookProduct, cancelProduct } from '@/lib/mock-apis';

function generateVoucherCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function addSagaEvent(log: SagaEvent[], event: string, detail?: string): SagaEvent[] {
  return [...log, { event, timestamp: new Date().toISOString(), detail }];
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = await request.json();
  const { session_id, customer } = body as {
    session_id: string;
    customer: {
      name:   string;
      phone?: string;
      email?: string;
    };
  };

  if (!session_id || !customer?.name) {
    return NextResponse.json({ error: 'session_id, customer.name 필수' }, { status: 400 });
  }

  // ① 장바구니 조회
  const cart = await getCart(session_id);
  if (!cart || !cart.items?.length) {
    return NextResponse.json({ error: '장바구니가 비어 있습니다.' }, { status: 400 });
  }
  const items = cart.items;

  // ② 멱등성 키 — session + timestamp (초 단위)
  const idempotency_key = `${session_id}-${Math.floor(Date.now() / 1000)}`;

  // ③ 기존 트랜잭션 확인 (멱등성)
  const existing = await getTransactionByIdempotencyKey(idempotency_key);
  if (existing) {
    return NextResponse.json({ transaction_id: existing.id, status: existing.status, idempotent: true });
  }

  const total_cost  = items.reduce((s, i) => s + i.cost  * i.quantity, 0);
  const total_price = items.reduce((s, i) => s + i.price * i.quantity, 0);

  // ④ 트랜잭션 생성 (PENDING)
  const txn = await createTransaction({
    idempotency_key,
    session_id,
    total_cost,
    total_price,
    customer_name:  customer.name,
    customer_phone: customer.phone,
    customer_email: customer.email,
  });
  if (!txn) {
    return NextResponse.json({ error: '트랜잭션 생성 실패' }, { status: 500 });
  }

  let sagaLog: SagaEvent[] = [];

  // ⑤ CUSTOMER_PAID
  sagaLog = addSagaEvent(sagaLog, 'CUSTOMER_PAID', `고객: ${customer.name} / 결제금액: ${total_price.toLocaleString()}원`);
  await updateTransaction(txn.id, { status: 'CUSTOMER_PAID', saga_log: sagaLog });

  // ⑥ api_orders 생성
  const orderRows = await Promise.all(
    items.map(item =>
      createApiOrder({
        transaction_id:   txn.id,
        api_name:         item.api_name,
        product_type:     item.product_type,
        product_category: resolveProductCategory(item),
        product_id:       item.product_id,
        product_name:     item.product_name,
        cost:             item.cost * item.quantity,
        price:            item.price * item.quantity,
        quantity:         item.quantity,
        attrs:            item.attrs,
      })
    )
  );
  const validOrders = orderRows.filter(Boolean);

  // ⑦ API_PROCESSING
  sagaLog = addSagaEvent(sagaLog, 'API_PROCESSING', `${validOrders.length}건 처리 시작`);
  await updateTransaction(txn.id, { status: 'API_PROCESSING', saga_log: sagaLog });

  // ⑧ 각 API에 예약 요청 (병렬)
  const bookResults = await Promise.allSettled(
    validOrders.map(async (order) => {
      if (!order) throw new Error('order is null');
      const result = await bookProduct(order.api_name, order.product_id, order.quantity);
      await updateApiOrder(order.id, { status: 'CONFIRMED', external_ref: result.external_ref });
      return { order, external_ref: result.external_ref };
    })
  );

  const succeeded = bookResults
    .filter((r): r is PromiseFulfilledResult<{ order: NonNullable<typeof validOrders[number]>; external_ref: string }> =>
      r.status === 'fulfilled'
    )
    .map(r => r.value);

  const failed = bookResults
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map(r => r.reason as Error);

  // ⑨ 실패 있으면 롤백
  if (failed.length > 0) {
    // 성공한 주문들 취소
    await Promise.allSettled(
      succeeded.map(async ({ order, external_ref }) => {
        await cancelProduct(order.api_name, external_ref);
        await updateApiOrder(order.id, { status: 'REFUNDED' });
      })
    );

    // 실패한 주문들 CANCELLED 처리
    const failedOrderIds = bookResults
      .map((r, i) => r.status === 'rejected' ? validOrders[i] : null)
      .filter(Boolean);
    await Promise.allSettled(
      failedOrderIds.map(order => order && updateApiOrder(order.id, { status: 'CANCELLED' }))
    );

    sagaLog = addSagaEvent(sagaLog, 'ROLLBACK',
      `실패 ${failed.length}건 / 롤백 ${succeeded.length}건: ${failed.map(e => e.message).join(', ')}`
    );
    await updateTransaction(txn.id, { status: 'PARTIAL_FAIL', saga_log: sagaLog });

    return NextResponse.json({
      transaction_id: txn.id,
      status:         'PARTIAL_FAIL',
      failed_count:   failed.length,
      errors:         failed.map(e => e.message),
    }, { status: 202 });
  }

  // ⑩ 전체 성공 — 바우처 생성
  const vouchers: VoucherItem[] = succeeded.map(({ order }) => ({
    code:         generateVoucherCode(),
    product_name: order.product_name,
    product_type: order.product_type,
  }));

  // ⑪ tenant_product 주문 재고 차감 + tenant_cost_breakdown 집계
  const tenantCostBreakdown: Record<string, number> = {};
  await Promise.allSettled(
    succeeded.map(async ({ order }) => {
      const tenantId = order.attrs?.tenant_id as string | undefined;
      const date     = order.attrs?.date      as string | undefined;
      // product_category 기반 분기 (구버전 api_name 후방 호환)
      const isFixed  = order.product_category === 'FIXED'
                    || (!order.product_category && order.api_name === 'tenant_product');
      if (isFixed && tenantId && date) {
        await deductInventory(order.product_id, date, order.quantity);
        tenantCostBreakdown[tenantId] = (tenantCostBreakdown[tenantId] ?? 0) + order.cost;
      }
    })
  );

  sagaLog = addSagaEvent(sagaLog, 'COMPLETED',
    `바우처 ${vouchers.length}건 발행: ${vouchers.map(v => v.code).join(', ')}`
  );
  await updateTransaction(txn.id, {
    status:                 'COMPLETED',
    saga_log:               sagaLog,
    vouchers,
    tenant_cost_breakdown:  Object.keys(tenantCostBreakdown).length > 0 ? tenantCostBreakdown : undefined,
  });

  // 장바구니 비우기
  await upsertCart(session_id, []);

  return NextResponse.json({
    transaction_id: txn.id,
    status:         'COMPLETED',
    vouchers,
    total_price,
  });
}
