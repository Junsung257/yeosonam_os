import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/admin/integrations/disconnect
 * Body: { tenant_id: string, platform: string }
 *
 * tenant_api_tokens에서 해당 플랫폼 토큰을 is_active=false로 비활성화.
 * 토큰 데이터는 보존 (재연결 시 덮어씀).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ success: true, mock: true });
  }

  try {
    const body = await request.json() as { tenant_id?: string; platform?: string };
    const { tenant_id, platform } = body;

    if (!tenant_id || !platform) {
      return NextResponse.json({ error: 'tenant_id, platform 필수' }, { status: 400 });
    }

    const ALLOWED = ['google_ads', 'meta', 'naver', 'google_analytics'];
    if (!ALLOWED.includes(platform)) {
      return NextResponse.json({ error: '지원하지 않는 플랫폼' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('tenant_api_tokens')
      .update({ is_active: false })
      .eq('tenant_id', tenant_id)
      .eq('provider', platform);

    if (error) throw error;

    return NextResponse.json({ success: true, platform, disconnected_at: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
