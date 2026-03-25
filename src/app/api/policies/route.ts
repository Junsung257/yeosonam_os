import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ policies: [] });
  }
  try {
    const { supabaseAdmin } = await import('@/lib/supabase');
    const { searchParams } = request.nextUrl;
    const category = searchParams.get('category');
    const activeOnly = searchParams.get('active') === '1';

    let query = supabaseAdmin.from('os_policies').select('*').order('priority', { ascending: true }).order('created_at', { ascending: false });
    if (category) query = query.eq('category', category);
    if (activeOnly) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ policies: data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  try {
    const { supabaseAdmin } = await import('@/lib/supabase');
    const body = await request.json();
    const { category, name, description, trigger_type, trigger_config, action_type, action_config, target_scope, starts_at, ends_at, is_active, priority } = body;

    if (!category || !name || !action_type) {
      return NextResponse.json({ error: 'category, name, action_type 필수' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.from('os_policies').insert({
      category, name, description: description || null,
      trigger_type: trigger_type || 'condition',
      trigger_config: trigger_config || {},
      action_type,
      action_config: action_config || {},
      target_scope: target_scope || { all: true },
      starts_at: starts_at || new Date().toISOString(),
      ends_at: ends_at || null,
      is_active: is_active ?? true,
      priority: priority ?? 100,
    }).select().single();

    if (error) throw error;
    return NextResponse.json({ policy: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '생성 실패' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  try {
    const { supabaseAdmin } = await import('@/lib/supabase');
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) return NextResponse.json({ error: 'id 필수' }, { status: 400 });

    const { data, error } = await supabaseAdmin.from('os_policies').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return NextResponse.json({ policy: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '수정 실패' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  try {
    const { supabaseAdmin } = await import('@/lib/supabase');
    const { searchParams } = request.nextUrl;
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id 필수' }, { status: 400 });

    const { error } = await supabaseAdmin.from('os_policies').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '삭제 실패' }, { status: 500 });
  }
}
