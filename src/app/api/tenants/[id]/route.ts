import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { getTenant, updateTenant, isSupabaseConfigured } from '@/lib/supabase';

const PRIVATE_NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  const params = await props.params;
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503, headers: PRIVATE_NO_STORE_HEADERS });
  }

  const tenant = await getTenant(params.id);
  if (!tenant) return NextResponse.json({ error: 'tenant not found' }, { status: 404, headers: PRIVATE_NO_STORE_HEADERS });
  return NextResponse.json({ tenant }, { headers: PRIVATE_NO_STORE_HEADERS });
}

export async function PUT(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  const params = await props.params;
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503, headers: PRIVATE_NO_STORE_HEADERS });
  }

  const body = await request.json();
  await updateTenant(params.id, body);
  return NextResponse.json({ ok: true }, { headers: PRIVATE_NO_STORE_HEADERS });
}
