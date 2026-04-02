import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const { creative_id, action } = body; // action: 'publish' | 'archive'

    if (!creative_id) return NextResponse.json({ error: 'creative_id 필요' }, { status: 400 });

    const status = action === 'archive' ? 'archived' : 'published';
    const updateData: Record<string, unknown> = { status };
    if (status === 'published') updateData.published_at = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from('content_creatives')
      .update(updateData)
      .eq('id', creative_id);

    if (error) throw error;

    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '발행 실패' }, { status: 500 });
  }
}
