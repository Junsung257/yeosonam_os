import { NextRequest, NextResponse } from 'next/server';
import { syncTenantAdAccountBudgetCaps } from '@/lib/ad-os-tenant-ad-accounts';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const PLATFORMS = ['naver', 'google', 'meta', 'kakao'] as const;
type Platform = typeof PLATFORMS[number];

type BudgetInput = {
  platform: string;
  monthly_budget_krw?: number;
  daily_budget_cap_krw?: number;
  max_cpc_krw?: number;
  max_test_loss_krw?: number;
  target_cpa_krw?: number | null;
  target_roas?: number | null;
  automation_level?: number;
  status?: string;
  notes?: string | null;
  external_account_id?: string | null;
  external_campaign_id?: string | null;
  external_ad_group_id?: string | null;
  external_config_note?: string | null;
};

function toNonNegativeInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function toNullableNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function cleanBudget(input: BudgetInput) {
  const platform = input.platform as Platform;
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`지원하지 않는 채널입니다: ${input.platform}`);
  }

  return {
    tenant_id: null,
    platform,
    monthly_budget_krw: toNonNegativeInt(input.monthly_budget_krw),
    daily_budget_cap_krw: toNonNegativeInt(input.daily_budget_cap_krw),
    max_cpc_krw: toNonNegativeInt(input.max_cpc_krw),
    max_test_loss_krw: toNonNegativeInt(input.max_test_loss_krw),
    target_cpa_krw: toNullableNonNegativeNumber(input.target_cpa_krw),
    target_roas: toNullableNonNegativeNumber(input.target_roas),
    automation_level: Math.min(5, Math.max(0, toNonNegativeInt(input.automation_level ?? 1))),
    status: input.status === 'active' ? 'active' : 'paused',
    notes: input.notes || null,
    external_account_id: String(input.external_account_id || '').trim() || null,
    external_campaign_id: String(input.external_campaign_id || '').trim() || null,
    external_ad_group_id: String(input.external_ad_group_id || '').trim() || null,
    external_config_note: String(input.external_config_note || '').trim() || null,
    updated_at: new Date().toISOString(),
  };
}

export const GET = withAdminGuard(async () => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const { data, error } = await supabaseAdmin
    .from('ad_os_channel_budgets')
    .select('*')
    .is('tenant_id', null)
    .order('platform', { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, budgets: data || [] });
});

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const inputs = Array.isArray(body?.budgets) ? body.budgets : [body];

  try {
    const saved = [];
    for (const input of inputs as BudgetInput[]) {
      const row = cleanBudget(input);
      const existing = await supabaseAdmin
        .from('ad_os_channel_budgets')
        .select('id')
        .is('tenant_id', null)
        .eq('platform', row.platform)
        .maybeSingle();

      if (existing.error) throw new Error(existing.error.message);

      const query = existing.data?.id
        ? supabaseAdmin
            .from('ad_os_channel_budgets')
            .update(row)
            .eq('id', existing.data.id)
            .select('*')
            .single()
        : supabaseAdmin
            .from('ad_os_channel_budgets')
            .insert(row)
            .select('*')
            .single();

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      if (['naver', 'google'].includes(row.platform)) {
        await syncTenantAdAccountBudgetCaps(supabaseAdmin, {
          platform: row.platform,
          monthlyBudgetCapKrw: row.monthly_budget_krw,
          dailyBudgetCapKrw: row.daily_budget_cap_krw,
        });
      }

      saved.push(data);
    }

    return NextResponse.json({ ok: true, saved });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '예산 저장 실패' },
      { status: 400 },
    );
  }
});
