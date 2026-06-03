import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

// POST /api/recommendations/convert — 전환 로깅
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ success: true });
  }

  try {
    const { sessionId, packageId } = await request.json();
    if (!sessionId || !packageId) {
      return apiResponse({ success: true });
    }

    await supabaseAdmin
      .from('recommendation_logs')
      .update({ converted: true, clicked_package_id: packageId })
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(1);

    return apiResponse({ success: true });
  } catch {
    return apiResponse({ success: true });
  }
}
