import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';

type AttributionModel = 'last_touch' | 'first_touch' | 'linear';

function normalizeModel(v: unknown): AttributionModel {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'first_touch') return 'first_touch';
  if (s === 'linear') return 'linear';
  return 'last_touch';
}

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ attribution_model: 'last_touch' as AttributionModel });
  }

  const { data, error } = await supabaseAdmin
    .from('app_settings')
    .select('key, value')
    .eq('key', 'affiliate_attribution_model')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const model = normalizeModel((data as { value?: { model?: string } } | null)?.value?.model);
  return NextResponse.json({ attribution_model: model });
}

export async function PATCH(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = await request.json();
  const model = normalizeModel(body?.attribution_model);
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, attribution_model: model });
}

