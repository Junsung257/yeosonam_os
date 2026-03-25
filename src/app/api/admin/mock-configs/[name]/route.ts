import { NextRequest, NextResponse } from 'next/server';
import { updateMockConfig, isSupabaseConfigured } from '@/lib/supabase';

// PUT /api/admin/mock-configs/[name]
export async function PUT(
  request: NextRequest,
  { params }: { params: { name: string } }
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const { mode, delay_ms } = await request.json();
  await updateMockConfig(params.name, { mode, delay_ms });
  return NextResponse.json({ ok: true, api_name: params.name });
}
