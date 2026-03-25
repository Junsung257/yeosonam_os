import { NextRequest, NextResponse } from 'next/server';
import {
  getInventoryBlocks,
  getInventoryByTenant,
  upsertInventoryBlock,
  isSupabaseConfigured,
} from '@/lib/supabase';

// GET /api/tenant/inventory?tenant_id=&product_id=&from=&to=
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ blocks: [] });
  const { searchParams } = request.nextUrl;
  const tenantId  = searchParams.get('tenant_id');
  const productId = searchParams.get('product_id');
  const from      = searchParams.get('from') ?? new Date().toISOString().slice(0, 7) + '-01';
  const to        = searchParams.get('to')   ?? new Date().toISOString().slice(0, 7) + '-31';

  if (productId) {
    const blocks = await getInventoryBlocks(productId, from, to);
    return NextResponse.json({ blocks });
  }
  if (tenantId) {
    const blocks = await getInventoryByTenant(tenantId, from, to);
    return NextResponse.json({ blocks });
  }
  return NextResponse.json({ error: 'tenant_id 또는 product_id 필수' }, { status: 400 });
}

// POST /api/tenant/inventory — upsert single date block
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  const body = await request.json();
  if (!body.tenant_id || !body.product_id || !body.date || body.total_seats === undefined) {
    return NextResponse.json({ error: 'tenant_id, product_id, date, total_seats 필수' }, { status: 400 });
  }
  const block = await upsertInventoryBlock(body);
  return NextResponse.json({ block }, { status: 201 });
}

// PUT /api/tenant/inventory — batch upsert (배치 입력)
export async function PUT(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  const body = await request.json();
  // body.blocks: array of inventory block inputs
  if (!Array.isArray(body.blocks)) {
    return NextResponse.json({ error: 'blocks 배열 필수' }, { status: 400 });
  }
  const results = await Promise.allSettled(
    body.blocks.map((b: Parameters<typeof upsertInventoryBlock>[0]) => upsertInventoryBlock(b))
  );
  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  return NextResponse.json({ ok: true, succeeded, total: body.blocks.length });
}
