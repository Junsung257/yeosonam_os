import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { listTenants, createTenant, isSupabaseConfigured } from '@/lib/supabase';

const PRIVATE_NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured) return NextResponse.json({ tenants: [] }, { headers: PRIVATE_NO_STORE_HEADERS });
  const tenants = await listTenants();
  return NextResponse.json({ tenants }, { headers: PRIVATE_NO_STORE_HEADERS });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503, headers: PRIVATE_NO_STORE_HEADERS });
  }

  const body = await request.json();
  if (!body.name) return NextResponse.json({ error: 'name is required' }, { status: 400, headers: PRIVATE_NO_STORE_HEADERS });
  const tenant = await createTenant(body);
  return NextResponse.json({ tenant }, { status: 201, headers: PRIVATE_NO_STORE_HEADERS });
}
