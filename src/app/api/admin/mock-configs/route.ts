import { NextRequest, NextResponse } from 'next/server';
import { listMockConfigs, updateMockConfig, isSupabaseConfigured } from '@/lib/supabase';

// GET /api/admin/mock-configs
export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ configs: [] });
  }
  const configs = await listMockConfigs();
  return NextResponse.json({ configs });
}

// PUT /api/admin/mock-configs  body: { api_name, mode, delay_ms }
export async function PUT(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const { api_name, mode, delay_ms } = await request.json();
  if (!api_name) return NextResponse.json({ error: 'api_name 필수' }, { status: 400 });

  await updateMockConfig(api_name, { mode, delay_ms });
  return NextResponse.json({ ok: true });
}
