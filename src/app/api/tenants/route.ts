import { NextRequest, NextResponse } from 'next/server';
import { listTenants, createTenant, isSupabaseConfigured } from '@/lib/supabase';

export async function GET() {
  if (!isSupabaseConfigured) return NextResponse.json({ tenants: [] });
  const tenants = await listTenants();
  return NextResponse.json({ tenants });
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  const body = await request.json();
  if (!body.name) return NextResponse.json({ error: 'name 필수' }, { status: 400 });
  const tenant = await createTenant(body);
  return NextResponse.json({ tenant }, { status: 201 });
}
