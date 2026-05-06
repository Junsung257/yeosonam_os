/**
 * GET    /api/products           — 목록 조회
 * GET    /api/products?id=...    — 단건 조회
 * POST   /api/products           — 신규 저장 (scan 미리보기 확정 시)
 * PATCH  /api/products           — 수정 (status 변경, 필드 업데이트)
 * DELETE /api/products?id=...    — 삭제
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import { requireAuthenticatedRoute } from '@/lib/session-guard';
import { getSecret } from '@/lib/secret-registry';

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
    return NextResponse.json({ product });
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
  return NextResponse.json({ products, count, page, limit });
}

// ─── POST ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }

  const guard = await requireAuthenticatedRoute(request);
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await request.json();

    // 필수 필드 검증
    const required = [
      'internal_code', 'display_name',
      'departure_region', 'departure_region_code',
      'supplier_code', 'destination_code',
      'duration_days', 'net_price',
    ] as const;

    for (const field of required) {
      if (body[field] === undefined || body[field] === null || body[field] === '') {
        return NextResponse.json(
          { error: `필수 필드가 누락되었습니다: ${field}` },
          { status: 400 },
        );
      }
    }

    // 중복 코드 방지
    const { data: existing } = await supabaseAdmin
      .from('products')
      .select('internal_code')
      .eq('internal_code', body.internal_code)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: `이미 존재하는 상품 코드입니다: ${body.internal_code}` },
        { status: 409 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        internal_code:         body.internal_code,
        display_name:          body.display_name,
        departure_region:      body.departure_region,
        departure_region_code: body.departure_region_code,
        supplier_name:         body.supplier_name ?? null,
        supplier_code:         body.supplier_code,
        destination:           body.destination ?? null,
        destination_code:      body.destination_code,
        duration_days:         body.duration_days,
        departure_date:        body.departure_date ?? null,
        net_price:             body.net_price,
        margin_rate:           body.margin_rate ?? 0.10,
        discount_amount:       body.discount_amount ?? 0,
        ai_tags:               body.ai_tags ?? [],
        status:                body.status ?? 'draft',
        internal_memo:         body.internal_memo ?? null,
        source_filename:       body.source_filename ?? null,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ product: data }, { status: 201 });

  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '상품 저장 실패' },
      { status: 500 },
    );
  }
}

// ─── PATCH ────────────────────────────────────────────────────

const PATCHABLE_FIELDS = [
  'display_name', 'departure_region', 'departure_region_code',
  'supplier_name', 'supplier_code', 'destination', 'destination_code',
  'duration_days', 'departure_date', 'net_price', 'margin_rate',
  'discount_amount', 'ai_tags', 'status', 'internal_memo',
  'land_operator_id',  // 정규화 FK
] as const;

export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }

  const guard = await requireAuthenticatedRoute(request);
  if (guard instanceof NextResponse) return guard;

  try {
    const body = await request.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: 'id(internal_code)가 필요합니다.' }, { status: 400 });

    // 허용된 필드만 추출
    const updates: Record<string, unknown> = {};
    for (const field of PATCHABLE_FIELDS) {
      if (field in body) updates[field] = body[field];
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: '변경할 필드가 없습니다.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('products')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('internal_code', id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ product: data });

  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '수정 실패' },
      { status: 500 },
    );
  }
}

// ─── DELETE ───────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }

  const guard = await requireAuthenticatedRoute(request);
  if (guard instanceof NextResponse) return guard;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id(internal_code)가 필요합니다.' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('products')
    .delete()
    .eq('internal_code', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: id });
}
