import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { resolveAdminActorLabel, withAdminGuard } from '@/lib/admin-guard';
import { invalidateAiPolicyCache } from '@/lib/ai-provider-policy';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

type Provider = 'deepseek' | 'claude' | 'gemini';

function isProvider(v: unknown): v is Provider {
  return v === 'deepseek' || v === 'claude' || v === 'gemini';
}

async function getHandler() {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const { data, error } = await supabaseAdmin
    .from('system_ai_policies')
    .select('*')
    .order('task', { ascending: true });
  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  return apiResponse({ policies: data ?? [] });
}

async function postHandler(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'invalid json' }, { status: 400 });
  }

  const task = typeof body.task === 'string' ? body.task.trim() : '';
  const provider = body.provider;
  const fallbackProvider = body.fallback_provider ?? null;
  if (!task || !isProvider(provider) || (fallbackProvider && !isProvider(fallbackProvider))) {
    return apiResponse({ error: 'task/provider 형식 오류' }, { status: 400 });
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
  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  invalidateAiPolicyCache();
  return apiResponse({ policy: data }, { status: 201 });
}

async function deleteHandler(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const task = request.nextUrl.searchParams.get('task')?.trim();
  if (!task) return apiResponse({ error: 'task 필요' }, { status: 400 });
  const { error } = await supabaseAdmin.from('system_ai_policies').delete().eq('task', task);
  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  invalidateAiPolicyCache();
  return apiResponse({ success: true });
}

export const GET = withAdminGuard(getHandler);
export const POST = withAdminGuard(postHandler);
export const DELETE = withAdminGuard(deleteHandler);
