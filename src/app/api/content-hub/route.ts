import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { requireAdminRequest } from '@/lib/admin-guard';

// GET: 콘텐츠 목록 조회
export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured) return NextResponse.json({ creatives: [] });

  const { searchParams } = request.nextUrl;
  const productId = searchParams.get('product_id');
  const status = searchParams.get('status');
  const requestedLimit = Number.parseInt(searchParams.get('limit') ?? '50', 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(100, Math.max(1, requestedLimit))
    : 50;

  try {
    let query = supabaseAdmin
      .from('content_creatives')
      .select('*, travel_packages(title, destination)')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (productId) query = query.eq('product_id', productId);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json(
      { creatives: data || [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}

// PATCH: 슬라이드 편집 저장
export async function PATCH(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const { id, slides, blog_html, ad_copy } = body;
    if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });
    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
      return NextResponse.json(
        { error: 'status 변경은 /api/content-hub/publish를 사용해야 합니다.' },
        { status: 400 },
      );
    }

    const updateData: Record<string, unknown> = {};
    if (slides !== undefined) updateData.slides = slides;
    if (blog_html !== undefined) updateData.blog_html = blog_html;
    if (ad_copy !== undefined) updateData.ad_copy = ad_copy;
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: '수정할 필드가 없습니다.' }, { status: 400 });
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('content_creatives')
      .select('id, status')
      .eq('id', id)
      .limit(1);
    if (existingError) throw existingError;
    if (!existing?.length) {
      return NextResponse.json({ error: '소재를 찾을 수 없습니다.' }, { status: 404 });
    }
    if (existing[0].status !== 'draft') {
      return NextResponse.json(
        { error: '공개·보관된 소재는 직접 편집할 수 없습니다. 새 초안에서 다시 검토하세요.' },
        { status: 409 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from('content_creatives')
      .update(updateData)
      .eq('id', id)
      .eq('status', 'draft')
      .select('id')
      .limit(1);

    if (error) throw error;
    if (!data?.length) {
      return NextResponse.json({ error: '소재 상태가 변경되었습니다. 새로고침 후 다시 시도하세요.' }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '저장 실패' }, { status: 500 });
  }
}

// DELETE: 소재 삭제
export async function DELETE(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const { searchParams } = request.nextUrl;
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

  try {
    const { data, error } = await supabaseAdmin
      .from('content_creatives')
      .delete()
      .eq('id', id)
      .select('id')
      .limit(1);

    if (error) throw error;
    if (!data?.length) return NextResponse.json({ error: '소재를 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '삭제 실패' }, { status: 500 });
  }
}
