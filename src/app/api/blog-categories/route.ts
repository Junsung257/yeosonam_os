import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * 블로그 카테고리 CRUD
 * - GET    /api/blog-categories?scope=info|product|both
 * - POST   /api/blog-categories       신규 생성
 * - PATCH  /api/blog-categories       수정
 * - DELETE /api/blog-categories?id=   삭제 (soft: is_active=false)
 */

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ categories: [] });

  try {
    const { searchParams } = request.nextUrl;
    const scope = searchParams.get('scope'); // info | product | both | null(전체)
    const includeInactive = searchParams.get('include_inactive') === '1';

    let query = supabaseAdmin
      .from('blog_categories')
      .select('*')
      .order('display_order', { ascending: true });

    if (!includeInactive) query = query.eq('is_active', true);
    // scope 필터: 'info' 요청 시 → scope in ('info', 'both')
    if (scope === 'info') query = query.in('scope', ['info', 'both']);
    if (scope === 'product') query = query.in('scope', ['product', 'both']);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ categories: data || [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const { key, label, description, scope, display_order } = body;

    if (!key || !label) {
      return NextResponse.json({ error: 'key와 label은 필수입니다.' }, { status: 400 });
    }
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      return NextResponse.json({ error: 'key는 영소문자/숫자/언더스코어만 허용 (첫 글자는 영문)' }, { status: 400 });
    }
    if (scope && !['info', 'product', 'both'].includes(scope)) {
      return NextResponse.json({ error: `잘못된 scope: ${scope}` }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('blog_categories')
      .insert({
        key,
        label,
        description: description || null,
        scope: scope || 'both',
        display_order: display_order ?? 99,
        is_active: true,
      })
      .select();

    if (error) throw error;
    return NextResponse.json({ category: data?.[0], success: true }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '생성 실패' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const { id, label, description, scope, display_order, is_active } = body;
    if (!id) return NextResponse.json({ error: 'id 필수' }, { status: 400 });

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (label !== undefined) updateData.label = label;
    if (description !== undefined) updateData.description = description;
    if (scope !== undefined) {
      if (!['info', 'product', 'both'].includes(scope)) {
        return NextResponse.json({ error: `잘못된 scope: ${scope}` }, { status: 400 });
      }
      updateData.scope = scope;
    }
    if (display_order !== undefined) updateData.display_order = display_order;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data, error } = await supabaseAdmin
      .from('blog_categories')
      .update(updateData)
      .eq('id', id)
      .select();

    if (error) throw error;
    return NextResponse.json({ category: data?.[0], success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '수정 실패' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const { searchParams } = request.nextUrl;
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id 필수' }, { status: 400 });

    // Soft delete (is_active = false)
    const { error } = await supabaseAdmin
      .from('blog_categories')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '삭제 실패' }, { status: 500 });
  }
}
