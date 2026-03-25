import { NextRequest, NextResponse } from 'next/server';
import { getTenantProducts, upsertTenantProduct, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get('tenant_id');
  if (!tenantId) return NextResponse.json({ error: 'tenant_id 필수' }, { status: 400 });
  if (!isSupabaseConfigured) return NextResponse.json({ products: [] });
  const products = await getTenantProducts(tenantId);
  return NextResponse.json({ products });
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  const body = await request.json();
  if (!body.tenant_id || !body.title) {
    return NextResponse.json({ error: 'tenant_id, title 필수' }, { status: 400 });
  }
  const product = await upsertTenantProduct(body);
  return NextResponse.json({ product }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  const body = await request.json();
  if (!body.id || !body.tenant_id) {
    return NextResponse.json({ error: 'id, tenant_id 필수' }, { status: 400 });
  }
  const product = await upsertTenantProduct(body);
  return NextResponse.json({ product });
}
