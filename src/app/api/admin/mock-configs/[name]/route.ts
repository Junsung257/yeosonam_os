import { NextRequest, NextResponse } from 'next/server';
import { updateMockConfig, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';

// PUT /api/admin/mock-configs/[name]
const putHandler = async (
  request: NextRequest,
  { params }: { params: { name: string } }
) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const { mode, delay_ms } = await request.json();
  await updateMockConfig(params.name, { mode, delay_ms });
  return NextResponse.json({ ok: true, api_name: params.name });
}

export const PUT = withAdminGuard(putHandler);
