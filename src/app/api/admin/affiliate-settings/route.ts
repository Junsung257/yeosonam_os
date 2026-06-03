import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { sanitizeDbError } from '@/lib/error-sanitizer';

type AttributionModel = 'last_touch' | 'first_touch' | 'linear';

function normalizeModel(v: unknown): AttributionModel {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'first_touch') return 'first_touch';
  if (s === 'linear') return 'linear';
  return 'last_touch';
}

async function getHandler() {
  if (!isSupabaseConfigured) {
    return apiResponse({ attribution_model: 'last_touch' as AttributionModel });
  }

  const { data, error } = await supabaseAdmin
    .from('app_settings')
    .select('key, value')
    .eq('key', 'affiliate_attribution_model')
    .maybeSingle();
  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });

  const model = normalizeModel((data as { value?: { model?: string } } | null)?.value?.model);
  return apiResponse({ attribution_model: model });
}

async function patchHandler(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }

  let body: { attribution_model?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'invalid json' }, { status: 400 });
  }

  const model = normalizeModel(body.attribution_model);
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert(
      {
        key: 'affiliate_attribution_model',
        value: {
          model,
          updated_at: new Date().toISOString(),
          updated_by: 'admin',
        },
      } as never,
      { onConflict: 'key' },
    );
  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  return apiResponse({ ok: true, attribution_model: model });
}

export const GET = withAdminGuard(getHandler);
export const PATCH = withAdminGuard(patchHandler);
