import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

// POST /api/recommendations/convert — 전환 로깅
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ success: true });
  }

  try {
    const { sessionId, packageId } = await request.json();
    if (!sessionId || !packageId) {
      return NextResponse.json({ success: true });
    }

    await supabaseAdmin
      .from('recommendation_logs')
      .update({ converted: true, clicked_package_id: packageId })
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(1);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true });
  }
}
