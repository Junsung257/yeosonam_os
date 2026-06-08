import { NextRequest, NextResponse } from 'next/server';
import {
  buildCreativeAssetVariantsForPackage,
  buildTravelIntentSignalsForPackage,
  type PackageFact,
  type TravelIntentSignalRow,
} from '@/lib/ad-os-v41-v60';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = Boolean(body.apply);
  const tenantId = body.tenant_id ? String(body.tenant_id) : null;
  const productId = body.product_id ? String(body.product_id) : null;

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'creative_asset_group',
      platform: null,
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      started_at: new Date().toISOString(),
      summary: {
        config: { apply, tenant_id: tenantId, product_id: productId, source: 'asset_group_v1' },
        external_api_write: false,
      },
    })
    .select('*')
    .single();
  if (runError) return NextResponse.json({ ok: false, error: runError.message }, { status: 500 });

  let packageQuery = supabaseAdmin.from('travel_packages').select('*').order('created_at', { ascending: false }).limit(1);
  if (productId) packageQuery = packageQuery.eq('id', productId);
  const { data: packages, error: packageError } = await packageQuery;
  const pkg = packages?.[0] as PackageFact | undefined;
  if (packageError || !pkg) {
    const message = packageError?.message || 'No package found for creative asset generation.';
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', errors: [{ message }], finished_at: new Date().toISOString() })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: message }, { status: packageError ? 500 : 404 });
  }

  let existingSignalsQuery = supabaseAdmin
    .from('ad_os_travel_intent_signals')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1000);
  if (pkg.destination) existingSignalsQuery = existingSignalsQuery.eq('destination', pkg.destination);
  if (tenantId) existingSignalsQuery = existingSignalsQuery.eq('tenant_id', tenantId);

  const { data: existingSignals, error: existingError } = await existingSignalsQuery;
  if (existingError) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', errors: [{ message: existingError.message }], finished_at: new Date().toISOString() })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: existingError.message }, { status: 500 });
  }

  const signals = buildTravelIntentSignalsForPackage(pkg, existingSignals || []).map((signal) => ({
    ...signal,
    tenant_id: signal.tenant_id || tenantId,
    run_id: run.id,
  }));
  const variants = buildCreativeAssetVariantsForPackage(pkg, signals as TravelIntentSignalRow[]).map((variant) => ({
    ...variant,
    tenant_id: variant.tenant_id || tenantId,
    run_id: run.id,
  }));

  let insertedSignals = 0;
  let insertedVariants = 0;
  if (apply) {
    if (signals.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('ad_os_travel_intent_signals')
        .upsert(signals as never, { onConflict: 'product_id,intent_key,keyword_text' })
        .select('id');
      if (error) {
        await supabaseAdmin
          .from('ad_os_automation_runs')
          .update({ status: 'failed', errors: [{ message: error.message }], finished_at: new Date().toISOString() })
          .eq('id', run.id);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      insertedSignals = data?.length || 0;
    }
    if (variants.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('ad_os_creative_asset_variants')
        .upsert(variants as never, { onConflict: 'idempotency_key' })
        .select('id');
      if (error) {
        await supabaseAdmin
          .from('ad_os_automation_runs')
          .update({ status: 'failed', errors: [{ message: error.message }], finished_at: new Date().toISOString() })
          .eq('id', run.id);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      insertedVariants = data?.length || 0;
    }
  }

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      summary: {
        product_id: pkg.id,
        signals: signals.length,
        variants: variants.length,
        insertedSignals,
        insertedVariants,
      },
    })
    .eq('id', run.id);

  return NextResponse.json({
    ok: true,
    run_id: run.id,
    dry_run: !apply,
    product: { id: pkg.id, title: pkg.title, destination: pkg.destination },
    signals,
    variants,
    summary: {
      generated_signals: signals.length,
      generated_variants: variants.length,
      inserted_signals: insertedSignals,
      inserted_variants: insertedVariants,
    },
  });
});
