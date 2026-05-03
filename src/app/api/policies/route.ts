import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { invalidatePolicyCache } from '@/lib/policy-engine';
import { isAdminRequest, resolveAdminActorLabel } from '@/lib/admin-guard';

// 정책 변경 시 os_policy_audit_log에 누가/언제/무엇을/왜 남김.
// _reason 필드는 body에서만 받고 DB INSERT/UPDATE에는 절대 포함되지 않음 (별도 audit insert).
async function writeAudit(params: {
  policyId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'TOGGLE';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  changedBy: string;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import('@/lib/supabase');
    await supabaseAdmin.from('os_policy_audit_log').insert({
      policy_id: params.policyId,
      action: params.action,
      diff: { before: params.before, after: params.after },
      reason: params.reason,
      changed_by: params.changedBy,
    } as never);
  } catch {
    /* audit 실패해도 정책 변경은 진행 (별도 알림 권장) */
  }
}

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
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
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  try {
    const { supabaseAdmin } = await import('@/lib/supabase');
    const body = await request.json();
    const { _reason, category, name, description, trigger_type, trigger_config, action_type, action_config, target_scope, starts_at, ends_at, is_active, priority } = body;

    if (!category || !name || !action_type) {
      return NextResponse.json({ error: 'category, name, action_type 필수' }, { status: 400 });
    }
    if (category === 'commission' && !_reason) {
      return NextResponse.json({ error: '커미션 정책은 변경 사유(_reason) 필수' }, { status: 400 });
    }

    const insertRow = {
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
      created_by: await resolveAdminActorLabel(request),
    };

    const { data, error } = await supabaseAdmin.from('os_policies').insert(insertRow).select().single();
    if (error) throw error;

    await writeAudit({
      policyId: (data as { id: string }).id,
      action: 'CREATE',
      before: null,
      after: data as Record<string, unknown>,
      reason: _reason || null,
      changedBy: await resolveAdminActorLabel(request),
    });
    invalidatePolicyCache();

    return NextResponse.json({ policy: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '생성 실패' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  try {
    const { supabaseAdmin } = await import('@/lib/supabase');
    const body = await request.json();
    const { id, _reason, ...updates } = body;

    if (!id) return NextResponse.json({ error: 'id 필수' }, { status: 400 });

    const { data: before } = await supabaseAdmin
      .from('os_policies')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!before) return NextResponse.json({ error: '정책을 찾을 수 없습니다' }, { status: 404 });

    const beforeRow = before as Record<string, unknown>;
    if (beforeRow.category === 'commission' && !_reason) {
      return NextResponse.json({ error: '커미션 정책 변경은 사유(_reason) 필수' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.from('os_policies').update(updates).eq('id', id).select().single();
    if (error) throw error;

    const afterRow = data as Record<string, unknown>;
    const isToggle = Object.keys(updates).length === 1 && 'is_active' in updates;

    await writeAudit({
      policyId: id,
      action: isToggle ? 'TOGGLE' : 'UPDATE',
      before: beforeRow,
      after: afterRow,
      reason: _reason || null,
      changedBy: await resolveAdminActorLabel(request),
    });
    invalidatePolicyCache();

    return NextResponse.json({ policy: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '수정 실패' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  try {
    const { supabaseAdmin } = await import('@/lib/supabase');
    const { searchParams } = request.nextUrl;
    const id = searchParams.get('id');
    const reason = searchParams.get('reason');
    if (!id) return NextResponse.json({ error: 'id 필수' }, { status: 400 });

    const { data: before } = await supabaseAdmin
      .from('os_policies')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    const { error } = await supabaseAdmin.from('os_policies').delete().eq('id', id);
    if (error) throw error;

    await writeAudit({
      policyId: id,
      action: 'DELETE',
      before: (before as Record<string, unknown>) || null,
      after: null,
      reason: reason || null,
      changedBy: await resolveAdminActorLabel(request),
    });
    invalidatePolicyCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '삭제 실패' }, { status: 500 });
  }
}
