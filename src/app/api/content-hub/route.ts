import { NextRequest, NextResponse } from 'next/server';
import { cacheHeader } from '@/lib/api-response';
import { getPublishedPackageCards } from '@/lib/public-packages';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

// GET: 콘텐츠 목록 조회
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ creatives: [] });

  const { searchParams } = request.nextUrl;
  const productId = searchParams.get('product_id');
  const status = searchParams.get('status');
  const limit = parseInt(searchParams.get('limit') ?? '50');

  try {
    let query = supabaseAdmin
      .from('content_creatives')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (productId) query = query.eq('product_id', productId);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    const creatives = (data || []) as Array<Record<string, unknown>>;
    const productIds = [...new Set(
      creatives
        .map(row => typeof row.product_id === 'string' ? row.product_id : null)
        .filter((id): id is string => Boolean(id)),
    )];
    const publicPackages = await getPublishedPackageCards(
      supabaseAdmin,
      productIds.map(id => ({ id })),
    );
    const publicPackageById = new Map(publicPackages.map(pkg => [pkg.id, pkg]));
    const safeCreatives = creatives.map(row => ({
      ...row,
      travel_packages: typeof row.product_id === 'string'
        ? publicPackageById.get(row.product_id) ?? null
        : null,
    }));

    return NextResponse.json({ creatives: safeCreatives }, { headers: cacheHeader(60) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}

// PATCH: 슬라이드 편집 저장
export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const { id, slides, blog_html, ad_copy, status } = body;
    if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

    const updateData: Record<string, unknown> = {};
    if (slides !== undefined) updateData.slides = slides;
    if (blog_html !== undefined) updateData.blog_html = blog_html;
    if (ad_copy !== undefined) updateData.ad_copy = ad_copy;
    if (status !== undefined) updateData.status = status;

    const { error } = await supabaseAdmin
      .from('content_creatives')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '저장 실패' }, { status: 500 });
  }
}

// DELETE: 소재 삭제
export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const { searchParams } = request.nextUrl;
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

  try {
    const { error } = await supabaseAdmin
      .from('content_creatives')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '삭제 실패' }, { status: 500 });
  }
}
