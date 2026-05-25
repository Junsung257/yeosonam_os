import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';

// ── GET /api/brand-kits/[id] ───────────────────────────────────────────────
export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!(await isAdminRequest(request))) return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const { data, error } = await supabaseAdmin
    .from('brand_kits')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: '브랜드킷을 찾을 수 없습니다' }, { status: 404 });

  return NextResponse.json({ brand_kit: data });
}

// ── PUT /api/brand-kits/[id] ───────────────────────────────────────────────
export async function PUT(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!(await isAdminRequest(request))) return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const { id } = params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  const allowed = [
    'name', 'colors', 'fonts', 'logo_text', 'logo_url', 'logo_light_url',
    'domain', 'voice_guide', 'voice_samples', 'is_active',
    'owner_type', 'owner_id', 'brand_name', 'brand_tagline',
    'watermark_text', 'watermark_enabled', 'social_links',
  ] as const;

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
      .select()
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

// ── DELETE /api/brand-kits/[id] ─────────────────────────────────────────────
export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!(await isAdminRequest(request))) return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const { id } = params;

  try {
    // 연결된 card_news가 있는지 확인
    const { count } = await supabaseAdmin
      .from('card_news')
      .select('*', { count: 'exact', head: true })
      .eq('brand_kit_id', id);

    const { error } = await supabaseAdmin
      .from('brand_kits')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: `삭제됨${(count ?? 0) > 0 ? ` (연결된 카드뉴스 ${count}건은 유지)` : ''}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '삭제 실패' },
      { status: 500 }
    );
  }
}
