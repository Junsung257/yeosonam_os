import { NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const ALLOWED_PLATFORMS = new Set(['naver', 'google', 'meta', 'kakao']);
const ALLOWED_RISK_STATUS = new Set(['normal', 'watch', 'restricted', 'blocked']);

function clampNonNegativeInt(value: unknown): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function clampAutomationLevel(value: unknown): number {
  return Math.max(0, Math.min(5, clampNonNegativeInt(value)));
}

function normalizePlatforms(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : ['naver', 'google'];
  const filtered = raw.map(String).filter((platform) => ALLOWED_PLATFORMS.has(platform));
  return filtered.length > 0 ? Array.from(new Set(filtered)) : ['naver', 'google'];
}

export const POST = withAdminGuard(async (request: Request) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const maxAutomationLevel = clampAutomationLevel(body.max_automation_level);
  const row = {
    tenant_id: body.tenant_id || null,
    allowed_platforms: normalizePlatforms(body.allowed_platforms),
    monthly_budget_cap_krw: clampNonNegativeInt(body.monthly_budget_cap_krw),
    daily_budget_cap_krw: clampNonNegativeInt(body.daily_budget_cap_krw),
    max_cpc_krw: clampNonNegativeInt(body.max_cpc_krw),
    max_test_loss_krw: clampNonNegativeInt(body.max_test_loss_krw),
    max_automation_level: maxAutomationLevel,
    require_human_approval: body.require_human_approval !== false,
    full_auto_enabled: Boolean(body.full_auto_enabled) && maxAutomationLevel >= 4,
    risk_status: ALLOWED_RISK_STATUS.has(String(body.risk_status || ''))
      ? String(body.risk_status)
      : 'normal',
    notes: body.notes ? String(body.notes).slice(0, 1000) : null,
    updated_at: new Date().toISOString(),
  };

  const existingQuery = supabaseAdmin
    .from('ad_os_tenant_governance')
    .select('id')
    .limit(1);
  const existingRes = row.tenant_id
    ? await existingQuery.eq('tenant_id', row.tenant_id)
    : await existingQuery.is('tenant_id', null);

  if (existingRes.error) {
    return NextResponse.json({ ok: false, error: existingRes.error.message }, { status: 500 });
  }

  const existingId = existingRes.data?.[0]?.id;
  const saveRes = existingId
    ? await supabaseAdmin
        .from('ad_os_tenant_governance')
        .update(row)
        .eq('id', existingId)
        .select('*')
        .single()
    : await supabaseAdmin
        .from('ad_os_tenant_governance')
        .insert(row)
        .select('*')
        .single();

  if (saveRes.error) {
    return NextResponse.json({ ok: false, error: saveRes.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, policy: saveRes.data });
});
