import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function changeRequestType(changeType: string) {
  if (changeType === 'expired_product_replacement') return 'update_blog_cta';
  if (changeType === 'scenario_expansion') return 'create_landing';
  return 'update_blog_cta';
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const createChangeRequests = body.create_change_requests !== false;
  const limit = Math.min(Math.max(Number(body.limit || 50), 1), 200);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'learning_apply',
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      summary: { apply, create_change_requests: createChangeRequests, limit, surface: 'blog_evolution' },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  const { data: versions, error } = await supabaseAdmin
    .from('blog_content_versions')
    .select('*')
    .eq('status', 'approved')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const changeRequests = (versions || []).map((version: any) => ({
    tenant_id: version.tenant_id || null,
    run_id: run.id,
    platform: null,
    automation_level: 2,
    request_type: changeRequestType(version.change_type),
    target_table: 'blog_content_versions',
    target_id: version.id,
    status: 'proposed',
    title: '블로그 진화 적용 승인',
    reason: version.reason || '성과 기반 블로그 CTA/SEO 버전 적용 후보입니다.',
    risk_level: version.change_type === 'expired_product_replacement' ? 'medium' : 'low',
    expected_impact: json(version.expected_impact),
    proposed_change: json({
      status: 'applied',
      applied_at: new Date().toISOString(),
      title_after: version.title_after || null,
      change_type: version.change_type,
    }),
    rollback_payload: json({ status: 'approved', applied_at: null }),
    approval_required: true,
  }));

  if (apply && createChangeRequests && changeRequests.length > 0) {
    const { error: requestError } = await supabaseAdmin.from('ad_os_change_requests').insert(changeRequests);
    if (requestError) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: requestError.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: requestError.message }, { status: 500 });
    }
  }

  if (apply && !createChangeRequests && versions && versions.length > 0) {
    const { error: updateError } = await supabaseAdmin
      .from('blog_content_versions')
      .update({ status: 'applied', applied_at: new Date().toISOString() })
      .in('id', versions.map((version: { id: string }) => version.id));
    if (updateError) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: updateError.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
    }
  }

  const summary = {
    versions_checked: versions?.length || 0,
    change_requests_prepared: changeRequests.length,
    change_requests_created: apply && createChangeRequests ? changeRequests.length : 0,
    directly_applied: apply && !createChangeRequests ? versions?.length || 0 : 0,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, versions: versions || [], change_requests: changeRequests.slice(0, 50) });
});
