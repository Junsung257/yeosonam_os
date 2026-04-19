import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { invalidateTermsCache } from '@/lib/standard-terms';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured) return NextResponse.json({ data: null });
  try {
    const { id } = await params;
    const { data, error } = await supabaseAdmin
      .from('terms_templates')
      .select('*')
      .eq('id', id)
      .limit(1);
    if (error) throw error;
    return NextResponse.json({ data: data?.[0] ?? null });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  try {
    const { id } = await params;
    const body = await request.json();
    const allowed = ['name', 'scope', 'notices', 'priority', 'is_active', 'starts_at', 'ends_at', 'notes'];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    const { data, error } = await supabaseAdmin
      .from('terms_templates')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    invalidateTermsCache();
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '수정 실패' },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  try {
    const { id } = await params;
    // soft delete: is_active=false + is_current=false (완전 삭제 금지 — 예약 스냅샷 참조 유지)
    const { error } = await supabaseAdmin
      .from('terms_templates')
      .update({ is_active: false, is_current: false })
      .eq('id', id);
    if (error) throw error;
    invalidateTermsCache();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '삭제 실패' },
      { status: 500 },
    );
  }
}
