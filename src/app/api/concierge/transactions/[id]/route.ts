import { NextRequest, NextResponse } from 'next/server';
import {
  getTransaction,
  updateTransaction,
  updateApiOrder,
  isSupabaseConfigured,
  SagaEvent,
} from '@/lib/supabase';
import { cancelProduct } from '@/lib/mock-apis';

// GET /api/concierge/transactions/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const txn = await getTransaction(params.id);
  if (!txn) return NextResponse.json({ error: '트랜잭션 없음' }, { status: 404 });
  return NextResponse.json({ transaction: txn });
}

// POST /api/concierge/transactions/[id]  body: { action: 'refund' }
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const { action } = await request.json();
  if (action !== 'refund') {
    return NextResponse.json({ error: '지원하지 않는 action' }, { status: 400 });
  }

  const txn = await getTransaction(params.id);
  if (!txn) return NextResponse.json({ error: '트랜잭션 없음' }, { status: 404 });

  if (txn.status === 'REFUNDED') {
    return NextResponse.json({ error: '이미 환불된 트랜잭션' }, { status: 409 });
  }

  // CONFIRMED 주문들 취소
  const confirmedOrders = (txn.api_orders ?? []).filter(o => o.status === 'CONFIRMED');
  await Promise.allSettled(
    confirmedOrders.map(async (order) => {
      if (order.external_ref) {
        await cancelProduct(order.api_name, order.external_ref);
      }
      await updateApiOrder(order.id, { status: 'REFUNDED' });
    })
  );

  const sagaLog: SagaEvent[] = [
    ...(txn.saga_log ?? []),
    {
      event:     'MANUAL_REFUND',
      timestamp: new Date().toISOString(),
      detail:    `수동 환불 처리: ${confirmedOrders.length}건 취소`,
    },
  ];

  await updateTransaction(params.id, { status: 'REFUNDED', saga_log: sagaLog });

  return NextResponse.json({ ok: true, refunded_orders: confirmedOrders.length });
}
