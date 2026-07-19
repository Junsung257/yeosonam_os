import { NextRequest, NextResponse } from 'next/server';
import {
  getTransaction,
  isSupabaseConfigured,
} from '@/lib/supabase';

// GET /api/concierge/transactions/[id]
export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const txn = await getTransaction(params.id);
  if (!txn) return NextResponse.json({ error: '트랜잭션 없음' }, { status: 404 });
  return NextResponse.json(
    { transaction: txn },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

// POST /api/concierge/transactions/[id]  body: { action: 'refund' }
export async function POST(request: NextRequest, _props: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const { action } = await request.json();
  if (action !== 'refund') {
    return NextResponse.json({ error: '지원하지 않는 action' }, { status: 400 });
  }

  return NextResponse.json(
    {
      error: '컨시어지 결제/환불은 실제 결제사 승인 및 환불 증빙 연동 전까지 비활성화되어 있습니다.',
      code: 'CONCIERGE_REFUND_DISABLED',
    },
    {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store' },
    }
  );
}
