import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  getInventoryBlocks,
  getInventoryByTenant,
  upsertInventoryBlock,
  isSupabaseConfigured,
} from '@/lib/supabase';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return apiResponse({ blocks: [] });
  const { searchParams } = request.nextUrl;
  const tenantId = searchParams.get('tenant_id');
  const productId = searchParams.get('product_id');
  const from = searchParams.get('from') ?? new Date().toISOString().slice(0, 7) + '-01';
  const to = searchParams.get('to') ?? new Date().toISOString().slice(0, 7) + '-31';

  if (productId) {
    const blocks = await getInventoryBlocks(productId, from, to);
    return apiResponse({ blocks });
  }
  if (tenantId) {
    const blocks = await getInventoryByTenant(tenantId, from, to);
    return apiResponse({ blocks });
  }
  return apiResponse({ error: 'tenant_id 또는 product_id 필수' }, { status: 400 });
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json();
    if (!body.tenant_id || !body.product_id || !body.date || body.total_seats === undefined) {
      return apiResponse({ error: 'tenant_id, product_id, date, total_seats 필수' }, { status: 400 });
    }
    const block = await upsertInventoryBlock(body);
    return apiResponse({ block }, { status: 201 });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err, '재고 저장 실패') }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json();
    if (!Array.isArray(body.blocks)) {
      return apiResponse({ error: 'blocks 배열 필수' }, { status: 400 });
    }
    const results = await Promise.allSettled(
      body.blocks.map((b: Parameters<typeof upsertInventoryBlock>[0]) => upsertInventoryBlock(b)),
    );
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    return apiResponse({ ok: true, succeeded, total: body.blocks.length });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err, '재고 일괄 저장 실패') }, { status: 500 });
  }
}
