import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({
      totalEvents: 0, totalCorrections: 0, activeCorrections: 0,
      recentCritiques: 0, blockCritiques: 0, warnCritiques: 0, passCritiques: 0,
      hitlCount: 0, topErrors: [], corrections: [], scenarios: [],
      totalScenarios: 0, pendingScenarios: 0, activeScenarios: 0,
      scenarioRunCount7d: 0, scenarioPassRate7d: 0, failedScenarioRuns7d: 0,
    });
  }

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekIso = weekAgo.toISOString();

  const [eventRes, correctionRes, critiqueRes, metricsRes, scenarioRes, pendingScenarioRes, activeScenarioRes, scenarioRunRes] = await Promise.allSettled([
    supabaseAdmin.from('platform_learning_events').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('response_corrections').select('id, created_at, source, pattern, severity, is_active, applied_count, scope_tenant_id', { count: 'exact' }).order('created_at', { ascending: false }).limit(50),
    supabaseAdmin.from('critique_results').select('id', { count: 'exact', head: true }).gte('created_at', weekIso),
    supabaseAdmin.from('critique_results').select('severity, cnt:severity', { count: 'exact', head: false })
      .gte('created_at', weekIso)
      .then((r: any) => {
        // Simple group by via raw query
        return supabaseAdmin.rpc('get_critique_counts_since', { since_iso: weekIso }).then((g: any) => ({ data: g.data, error: g.error }));
      }),
    supabaseAdmin
      .from('qa_learning_scenarios')
      .select('id, created_at, category, destination_hint, user_message_redacted, expected_behavior, priority, status, generated_reason, last_run_at, last_result', { count: 'exact' })
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(60),
    supabaseAdmin
      .from('qa_learning_scenarios')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabaseAdmin
      .from('qa_learning_scenarios')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabaseAdmin
      .from('qa_learning_scenario_runs')
      .select('passed, score, created_at')
      .gte('created_at', weekIso)
      .order('created_at', { ascending: false })
      .limit(500),
  ] as const);

  const totalEvents = eventRes.status === 'fulfilled' ? eventRes.value.count ?? 0 : 0;
  const totalCorrections = correctionRes.status === 'fulfilled' ? correctionRes.value.count ?? 0 : 0;
  const activeCorrections = correctionRes.status === 'fulfilled'
    ? correctionRes.value.data?.filter((r: { is_active: boolean }) => r.is_active).length ?? 0
    : 0;
  const recentCritiques = critiqueRes.status === 'fulfilled' ? critiqueRes.value.count ?? 0 : 0;

  // HITL count from events
  let hitlCount = 0;
  const { data: hitlEvents } = await supabaseAdmin
    .from('platform_learning_events')
    .select('payload')
    .gte('created_at', weekIso)
    .limit(2000);
  if (hitlEvents) {
    for (const e of hitlEvents) {
      const p = e.payload as Record<string, unknown> | null;
      if (p?.pending_hitl) hitlCount++;
    }
  }

  // Critique severity distribution using raw query fallback
  let topErrors: { severity: string; cnt: number }[] = [];
  if (metricsRes.status === 'fulfilled' && metricsRes.value.data) {
    topErrors = metricsRes.value.data as { severity: string; cnt: number }[];
  } else {
    // Fallback: separate queries per severity
    const [p, w, b] = await Promise.all([
      supabaseAdmin.from('critique_results').select('id', { count: 'exact', head: true }).eq('severity', 'pass').gte('created_at', weekIso),
      supabaseAdmin.from('critique_results').select('id', { count: 'exact', head: true }).eq('severity', 'warn').gte('created_at', weekIso),
      supabaseAdmin.from('critique_results').select('id', { count: 'exact', head: true }).eq('severity', 'block').gte('created_at', weekIso),
    ]);
    topErrors = [
      { severity: 'pass', cnt: p.count ?? 0 },
      { severity: 'warn', cnt: w.count ?? 0 },
      { severity: 'block', cnt: b.count ?? 0 },
    ];
  }

  const blockCritiques = topErrors.find((e: { severity: string }) => e.severity === 'block')?.cnt ?? 0;
  const warnCritiques = topErrors.find((e: { severity: string }) => e.severity === 'warn')?.cnt ?? 0;
  const passCritiques = topErrors.find((e: { severity: string }) => e.severity === 'pass')?.cnt ?? 0;

  const corrections = correctionRes.status === 'fulfilled' ? (correctionRes.value.data ?? []) : [];
  const scenarios = scenarioRes.status === 'fulfilled' ? (scenarioRes.value.data ?? []) : [];
  const totalScenarios = scenarioRes.status === 'fulfilled' ? scenarioRes.value.count ?? 0 : 0;
  const pendingScenarios = pendingScenarioRes.status === 'fulfilled' ? pendingScenarioRes.value.count ?? 0 : 0;
  const activeScenarios = activeScenarioRes.status === 'fulfilled' ? activeScenarioRes.value.count ?? 0 : 0;
  const scenarioRuns = scenarioRunRes.status === 'fulfilled' ? (scenarioRunRes.value.data ?? []) : [];
  const scenarioRunCount7d = scenarioRuns.length;
  const passedScenarioRuns7d = scenarioRuns.filter((r: { passed?: boolean }) => r.passed === true).length;
  const failedScenarioRuns7d = scenarioRunCount7d - passedScenarioRuns7d;
  const scenarioPassRate7d = scenarioRunCount7d > 0
    ? Math.round((passedScenarioRuns7d / scenarioRunCount7d) * 1000) / 10
    : 0;

  return NextResponse.json({
    totalEvents,
    totalCorrections,
    activeCorrections,
    recentCritiques,
    blockCritiques,
    warnCritiques,
    passCritiques,
    hitlCount,
    topErrors,
    corrections,
    scenarios,
    totalScenarios,
    pendingScenarios,
    activeScenarios,
    scenarioRunCount7d,
    scenarioPassRate7d,
    failedScenarioRuns7d,
  });
}
