import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';

// ── PUT /api/brand-kits/[id] ───────────────────────────────────────────────
// 브랜드킷 업데이트. 허용 필드: name, colors, fonts, logo_text, logo_url,
// domain, voice_guide, voice_samples, is_active
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!(await isAdminRequest(request))) return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const { id } = params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  const allowed = ['name', 'colors', 'fonts', 'logo_text', 'logo_url', 'domain', 'voice_guide', 'voice_samples', 'is_active'] as const;
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: '변경할 필드가 없습니다' }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('brand_kits')
      .update(patch)
      .eq('id', id)
      .select('id, code, name, colors, fonts, logo_text, logo_url, domain, voice_guide, voice_samples, is_active, updated_at')
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: '브랜드킷을 찾을 수 없습니다' }, { status: 404 });

    return NextResponse.json({ brand_kit: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '수정 실패' },
      { status: 500 }
    );
  }
}

// ── GET /api/brand-kits/[id] ───────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!(await isAdminRequest(request))) return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const { data, error } = await supabaseAdmin
    .from('brand_kits')
    .select('id, code, name, colors, fonts, logo_text, logo_url, domain, voice_guide, voice_samples, is_active, created_at, updated_at')
    .eq('id', params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: '브랜드킷을 찾을 수 없습니다' }, { status: 404 });

  return NextResponse.json({ brand_kit: data });
}
