import { NextRequest, NextResponse } from 'next/server';
import { getTenant, updateTenant, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  const { id } = await params;
  const tenant = await getTenant(id);
  if (!tenant) return NextResponse.json({ error: '테넌트 없음' }, { status: 404 });
  return NextResponse.json({ tenant });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  const { id } = await params;
  const body = await request.json();
  await updateTenant(id, body);
  return NextResponse.json({ ok: true });
}
