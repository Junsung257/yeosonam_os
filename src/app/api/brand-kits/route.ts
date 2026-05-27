import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';
import { cacheHeader } from '@/lib/api-response';

// ── GET /api/brand-kits ──────────────────────────────────────────────────────
// 브랜드킷 목록 조회 (관리자용: 모든 status 포함 / 공개용: 활성만)
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ brand_kits: [] }, { headers: cacheHeader(3600) });
  }

  try {
    const code = request.nextUrl.searchParams.get('code');
    const showAll = request.nextUrl.searchParams.get('all') === 'true';
    const isAdmin = await isAdminRequest(request).catch(() => false);

    let query = supabaseAdmin
      .from('brand_kits')
      .select('id, code, name, colors, fonts, logo_text, logo_url, logo_light_url, domain, voice_guide, voice_samples, is_active, owner_type, owner_id, brand_name, brand_tagline, watermark_text, watermark_enabled, created_at, updated_at');

    // 관리자가 아니거나 all=false면 활성만
    if (!isAdmin || !showAll) {
      query = query.eq('is_active', true);
    }

    if (code) {
      query = query.eq('code', code);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    return NextResponse.json({ brand_kits: data ?? [] }, { headers: cacheHeader(3600) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '조회 실패';
    return NextResponse.json({ error: msg }, { status: 500, headers: cacheHeader(3600) });
  }
}

// ── POST /api/brand-kits ─────────────────────────────────────────────────────
// 새 브랜드킷 생성
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json();

    // code 필수 (고유 식별자)
    if (!body.code || typeof body.code !== 'string') {
      return NextResponse.json({ error: 'code는 필수입니다.' }, { status: 400 });
    }

    // 중복 체크
    const { data: existing } = await supabaseAdmin
      .from('brand_kits')
      .select('id')
      .eq('code', body.code)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: `code '${body.code}'는 이미 존재합니다.` }, { status: 409 });
    }

    const insertData = {
      code: body.code,
      name: body.name || body.code,
      colors: body.colors || { primary: '#001f3f', accent: '#005d90', ink: '#1a1a2e', mute: '#6b7280', surface: '#f8f9fb' },
      fonts: body.fonts || { sans: 'Pretendard', serif: 'Noto Serif KR', mono: 'D2Coding' },
      logo_text: body.logo_text || null,
      logo_url: body.logo_url || null,
      logo_light_url: body.logo_light_url || null,
      domain: body.domain || null,
      voice_guide: body.voice_guide || null,
      voice_samples: body.voice_samples || null,
      is_active: body.is_active !== false,
      owner_type: body.owner_type || 'platform',
      owner_id: body.owner_id || '00000000-0000-0000-0000-000000000000',
      brand_name: body.brand_name || body.name || body.code,
      brand_tagline: body.brand_tagline || null,
      watermark_text: body.watermark_text || null,
      watermark_enabled: body.watermark_enabled !== false,
      social_links: body.social_links || {},
    };

    const { data, error } = await supabaseAdmin
      .from('brand_kits')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ brand_kit: data }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '생성 실패';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
