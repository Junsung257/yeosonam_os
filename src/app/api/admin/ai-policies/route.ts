import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest, resolveAdminActorLabel } from '@/lib/admin-guard';
import { invalidateAiPolicyCache } from '@/lib/ai-provider-policy';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

type Provider = 'deepseek' | 'claude' | 'gemini';

function isProvider(v: unknown): v is Provider {
  return v === 'deepseek' || v === 'claude' || v === 'gemini';
}

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const { data, error } = await supabaseAdmin
    .from('system_ai_policies')
    .select('*')
    .order('task', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ policies: data ?? [] });
}

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const body = await request.json();
  const task = typeof body.task === 'string' ? body.task.trim() : '';
  const provider = body.provider;
  const fallbackProvider = body.fallback_provider ?? null;
  if (!task || !isProvider(provider) || (fallbackProvider && !isProvider(fallbackProvider))) {
    return NextResponse.json({ error: 'task/provider 형식 오류' }, { status: 400 });
  }

  const actor = await resolveAdminActorLabel(request);
  const payload = {
    task,
    provider,
    model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null,
    fallback_provider: fallbackProvider,
    fallback_model: typeof body.fallback_model === 'string' && body.fallback_model.trim() ? body.fallback_model.trim() : null,
    timeout_ms: typeof body.timeout_ms === 'number' && body.timeout_ms > 0 ? body.timeout_ms : null,
    enabled: body.enabled !== false,
    note: typeof body.note === 'string' ? body.note : null,
    updated_by: actor,
    created_by: actor,
  };
  const { data, error } = await supabaseAdmin
    .from('system_ai_policies')
    .upsert(payload, { onConflict: 'task' })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidateAiPolicyCache();
  return NextResponse.json({ policy: data }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const task = request.nextUrl.searchParams.get('task')?.trim();
  if (!task) return NextResponse.json({ error: 'task 필요' }, { status: 400 });
  const { error } = await supabaseAdmin.from('system_ai_policies').delete().eq('task', task);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidateAiPolicyCache();
  return NextResponse.json({ success: true });
}

