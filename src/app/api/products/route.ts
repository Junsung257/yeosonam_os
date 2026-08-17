/**
 * GET    /api/products           — 목록 조회
 * GET    /api/products?id=...    — 단건 조회
 * POST/PATCH/DELETE              — retired: immutable registration Kernel only
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import { getSecret } from '@/lib/secret-registry';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

// ─── B2B 필드 목록 (VA 역할에게 숨겨야 하는 필드) ────────────────────────────
const B2B_FIELDS = ['net_price', 'margin_rate', 'discount_amount', 'b2b_notes', 'supplier_code'] as const;
type B2BField = typeof B2B_FIELDS[number];

// ─── 사용자 역할 조회 (Authorization 헤더 기반) ───────────────────────────────
async function getUserRole(authHeader: string | null): Promise<'admin' | 'va'> {
  if (!authHeader?.startsWith('Bearer ')) return 'admin';
  const token = authHeader.slice(7);
  try {
    const url = getSecret('NEXT_PUBLIC_SUPABASE_URL');
    const key  = getSecret('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    if (!url || !key) return 'admin';
    const client = createClient(url, key);
    const { data: { user } } = await client.auth.getUser(token);
    if (!user) return 'admin';
    const { data } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    return (data?.role === 'va') ? 'va' : 'admin';
  } catch {
    return 'admin'; // 조회 실패 시 admin 권한 유지 (기존 사용자 영향 없음)
  }
}

function omitB2BFields<T extends Record<string, unknown>>(obj: T): Omit<T, B2BField> {
  const result = { ...obj };
  for (const f of B2B_FIELDS) delete result[f];
  return result as Omit<T, B2BField>;
}

// ─── GET ──────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const id             = searchParams.get('id');
  const status         = searchParams.get('status');
  const supplierCode   = searchParams.get('supplier_code');
  const destinationCode = searchParams.get('destination_code');
  const page           = parseInt(searchParams.get('page') || '1', 10);
  const limit          = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
  const offset         = (page - 1) * limit;

  // 단건 조회
  if (id) {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('internal_code', id)
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 404 });
    const role = await getUserRole(request.headers.get('authorization'));
    const product = role === 'va' ? omitB2BFields(data as Record<string, unknown>) : data;
    return NextResponse.json({ product }, { headers: NO_STORE_HEADERS });
  }

  // 역할 조회 (목록에서도 B2B 필드 필터링)
  const role = await getUserRole(request.headers.get('authorization'));

  // 목록 조회
  let query = supabaseAdmin.from('products').select('*', { count: 'exact' });

  if (status)         query = query.eq('status', status);
  if (supplierCode)   query = query.eq('supplier_code', supplierCode);
  if (destinationCode) query = query.eq('destination_code', destinationCode);

  // departure_date 필터: ±60일 범위 검색 (스마트 매칭용)
  const departureDateParam = searchParams.get('departure_date');
  if (departureDateParam) {
    const d    = new Date(departureDateParam);
    const from = new Date(d.getTime() - 60 * 86400000).toISOString().slice(0, 10);
    const to   = new Date(d.getTime() + 60 * 86400000).toISOString().slice(0, 10);
    query = query.gte('departure_date', from).lte('departure_date', to);
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const products = role === 'va'
    ? (data ?? []).map((p: Record<string, unknown>) => omitB2BFields(p))
    : data;
  return NextResponse.json({ products, count, page, limit }, { headers: NO_STORE_HEADERS });
}

// ─── POST ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  return NextResponse.json({
    error: '정규화 필드를 직접 저장하는 경로는 종료되었습니다. 원문은 /api/upload로 등록해 주세요.',
    code: 'PRODUCT_DIRECT_CREATE_RETIRED',
    next: '/api/upload',
  }, { status: 410, headers: NO_STORE_HEADERS });
}

// ─── PATCH ────────────────────────────────────────────────────

export async function PATCH(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  return NextResponse.json({
    error: '상품 사실 직접 수정은 종료되었습니다. 변경 원문을 첨부해 correction revision을 생성해 주세요.',
    code: 'PRODUCT_DIRECT_UPDATE_RETIRED',
    next: '/api/admin/product-registration/products/{catalogProductId}/corrections',
  }, { status: 410, headers: NO_STORE_HEADERS });
}

// ─── DELETE ───────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  return NextResponse.json({
    error: '상품 row 삭제는 종료되었습니다. 판매중단 overlay 또는 lifecycle 전환을 사용해 주세요.',
    code: 'PRODUCT_DIRECT_DELETE_RETIRED',
  }, { status: 410, headers: NO_STORE_HEADERS });
}
