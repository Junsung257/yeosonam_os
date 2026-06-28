'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bot, Database, Gauge, Settings, ShieldCheck } from 'lucide-react';
import Button from '@/components/ui/Button';

type SectionScore = {
  section_key: string;
  section_label: string;
  score: number;
  status: 'pass' | 'warn' | 'fail';
  blockers: string[];
  recommendations: string[];
};

type SectionScoresResponse = {
  ok: boolean;
  source_ledger?: {
    current_sources: number;
    target_sources: number;
    ready: boolean;
  };
  score_gate?: {
    target: number;
    passed: boolean;
    lowest_score: number;
    blockers: string[];
  };
  section_scores?: SectionScore[];
  error?: string;
};

type AiDirectorResponse = {
  ok: boolean;
  mode?: 'dry_run' | 'guarded_l3';
  persisted?: boolean;
  score_gate?: SectionScoresResponse['score_gate'];
  decisions?: Array<{
    id: string;
    title: string;
    risk_level: string;
    can_auto_apply_l3: boolean;
    blocked_reasons: string[];
    next_action: string;
  }>;
  budget_allocations?: Array<{
    platform: string;
    allocation_pct: number;
    status: 'planned' | 'blocked';
    monthly_cap_krw: number;
    daily_cap_krw: number;
  }>;
  write_packets?: Array<{
    platform: string;
    lifecycle_status: 'ready' | 'blocked';
    external_api_write: false;
  }>;
  source_ledger?: {
    current_sources: number;
    target_sources: number;
    ready: boolean;
  };
  safety?: {
    database_mutation: boolean;
    external_api_write: false;
    live_spend_krw: number;
  };
  error?: string;
};

type DeepSubcategory = {
  id: string;
  label: string;
  score: number;
  target_score: number;
  status: 'pass' | 'warn' | 'fail';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  critical: boolean;
  owner: string;
  blockers: string[];
  repair_action: string;
};

type DeepDomain = {
  domain_key: string;
  domain_label: string;
  score: number;
  target_score: number;
  status: 'pass' | 'warn' | 'fail';
  subcategories: DeepSubcategory[];
};

type DeepScorecardResponse = {
  ok: boolean;
  source_ledger?: {
    current_sources: number;
    target_sources: number;
    seed_sources: number;
    ready: boolean;
  };
  score_gate?: {
    target: number;
    passed: boolean;
    lowest_score: number;
    blockers: string[];
  };
  summary?: {
    domain_count: number;
    subcategory_count: number;
    average_score: number;
    passing_subcategories: number;
    gap_subcategories: number;
    p0_gaps: number;
  };
  domains?: DeepDomain[];
  repair_queue?: Array<{
    repair_id: string;
    title: string;
    current_score: number;
    target_score: number;
    priority: 'P0' | 'P1' | 'P2' | 'P3';
    action: string;
    can_stage_l3: boolean;
    approval_required: boolean;
  }>;
  error?: string;
};

type RepairPlanResponse = {
  ok: boolean;
  persisted?: boolean;
  persisted_rows?: {
    subcategory_scores: number;
    repair_queue: number;
  };
  repair_queue?: DeepScorecardResponse['repair_queue'];
  error?: string;
};

type SourceImportResponse = {
  ok: boolean;
  imported_sources?: number;
  current_sources?: number;
  target_sources?: number;
  ready?: boolean;
  error?: string;
};

function statusClass(status: string) {
  if (status === 'pass' || status === 'planned' || status === 'ready') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (status === 'warn') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-rose-200 bg-rose-50 text-rose-700';
}

function formatKrw(value: number) {
  return `${Math.round(value || 0).toLocaleString('ko-KR')} KRW`;
}

export function AiDirectorControlPanel() {
  const [scores, setScores] = useState<SectionScoresResponse | null>(null);
  const [deepScorecard, setDeepScorecard] = useState<DeepScorecardResponse | null>(null);
  const [director, setDirector] = useState<AiDirectorResponse | null>(null);
  const [repairPlan, setRepairPlan] = useState<RepairPlanResponse | null>(null);
  const [sourceImport, setSourceImport] = useState<SourceImportResponse | null>(null);
  const [loadingScores, setLoadingScores] = useState(false);
  const [loadingDeep, setLoadingDeep] = useState(false);
  const [running, setRunning] = useState<'dry_run' | 'guarded_l3' | null>(null);
  const [stagingRepair, setStagingRepair] = useState(false);
  const [importingSources, setImportingSources] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadScores = async () => {
    setLoadingScores(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/ad-os/section-scores', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || 'Section score load failed.');
      setScores(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Section score load failed.');
    } finally {
      setLoadingScores(false);
    }
  };

  const loadDeepScorecard = async () => {
    setLoadingDeep(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/ad-os/deep-scorecard', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || 'Deep scorecard load failed.');
      setDeepScorecard(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deep scorecard load failed.');
    } finally {
      setLoadingDeep(false);
    }
  };

  const runDirector = async (mode: 'dry_run' | 'guarded_l3', apply: boolean) => {
    setRunning(mode);
    setError(null);
    try {
      const response = await fetch('/api/admin/ad-os/ai-director/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          apply,
          channels: ['naver', 'google', 'meta', 'kakao'],
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || 'AI Director run failed.');
      setDirector(json);
      await loadScores();
      await loadDeepScorecard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI Director run failed.');
    } finally {
      setRunning(null);
    }
  };

  const stageRepairQueue = async () => {
    setStagingRepair(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/ad-os/ai-director/repair-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || 'Repair queue staging failed.');
      setRepairPlan(json);
      await loadDeepScorecard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Repair queue staging failed.');
    } finally {
      setStagingRepair(false);
    }
  };

  const importReviewedSources = async () => {
    setImportingSources(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/ad-os/source-ledger/import-reviewed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || 'Source ledger import failed.');
      setSourceImport(json);
      await loadScores();
      await loadDeepScorecard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Source ledger import failed.');
    } finally {
      setImportingSources(false);
    }
  };

  useEffect(() => {
    loadScores();
    loadDeepScorecard();
  }, []);

  const sections = scores?.section_scores || [];
  const deepDomains = deepScorecard?.domains || [];
  const deepSubcategories = deepDomains.flatMap((domain) => domain.subcategories);
  const topGaps = useMemo(
    () => sections
      .filter((section) => section.status !== 'pass')
      .sort((a, b) => a.score - b.score)
      .slice(0, 4),
    [sections],
  );
  const deepGaps = useMemo(
    () => deepSubcategories
      .filter((section) => section.score < section.target_score)
      .sort((a, b) => {
        const priority: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
        return priority[a.priority] - priority[b.priority] || a.score - b.score;
      })
      .slice(0, 8),
    [deepSubcategories],
  );
  const plannedAllocations = director?.budget_allocations?.filter((row) => row.status === 'planned') || [];
  const blockedPackets = director?.write_packets?.filter((packet) => packet.lifecycle_status === 'blocked') || [];

  return (
    <section className="admin-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-admin-muted">
            <Bot size={14} />
            AI Ad Director
          </div>
          <h2 className="mt-1 text-lg font-bold text-admin-text">95+ automation gate</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className={`rounded-admin-sm border px-2 py-1 ${scores?.score_gate?.passed ? statusClass('pass') : statusClass('warn')}`}>
              Lowest score {scores?.score_gate?.lowest_score ?? '-'} / target {scores?.score_gate?.target ?? 95}
            </span>
            <span className={`rounded-admin-sm border px-2 py-1 ${scores?.source_ledger?.ready ? statusClass('pass') : statusClass('warn')}`}>
              Sources {scores?.source_ledger?.current_sources ?? 0}/{scores?.source_ledger?.target_sources ?? 100}
            </span>
            <span className="rounded-admin-sm border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">
              External write 0 KRW
            </span>
            <span className={`rounded-admin-sm border px-2 py-1 ${deepScorecard?.score_gate?.passed ? statusClass('pass') : statusClass('warn')}`}>
              Deep avg {deepScorecard?.summary?.average_score ?? '-'} / gaps {deepScorecard?.summary?.gap_subcategories ?? '-'}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={loadScores} loading={loadingScores}>
            <Gauge size={14} />
            Refresh score
          </Button>
          <Button variant="secondary" size="sm" onClick={loadDeepScorecard} loading={loadingDeep}>
            <Gauge size={14} />
            Refresh deep
          </Button>
          <Button variant="secondary" size="sm" onClick={() => runDirector('dry_run', false)} loading={running === 'dry_run'}>
            <ShieldCheck size={14} />
            Dry run
          </Button>
          <Button variant="primary" size="sm" onClick={() => runDirector('guarded_l3', true)} loading={running === 'guarded_l3'}>
            <Database size={14} />
            Stage L3
          </Button>
          <Button variant="secondary" size="sm" onClick={stageRepairQueue} loading={stagingRepair}>
            <Settings size={14} />
            Stage repairs
          </Button>
          <Button variant="secondary" size="sm" onClick={importReviewedSources} loading={importingSources}>
            <Database size={14} />
            Import sources
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-admin-sm border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_1fr]">
        <div className="rounded-admin-md border border-admin-border bg-white p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-admin-text">Section scores</h3>
            <span className="text-xs text-admin-muted">{sections.length} sections</span>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {sections.map((section) => (
              <div key={section.section_key} className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-admin-text">{section.section_label}</p>
                  <span className={`shrink-0 rounded-admin-sm border px-2 py-0.5 text-xs font-semibold ${statusClass(section.status)}`}>
                    {section.score}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-admin-muted">
                  {section.status === 'pass'
                    ? 'Ready for the 95+ gate.'
                    : section.blockers[0] || section.recommendations[0] || 'Needs evidence.'}
                </p>
              </div>
            ))}
            {sections.length === 0 && (
              <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3 text-sm text-admin-muted">
                Score data is not loaded.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-admin-md border border-admin-border bg-white p-3">
            <h3 className="text-sm font-semibold text-admin-text">Top gaps</h3>
            <div className="mt-2 space-y-2">
              {topGaps.map((section) => (
                <div key={section.section_key} className="rounded-admin-sm bg-admin-surface p-2 text-xs leading-5 text-admin-muted">
                  <span className="font-semibold text-admin-text">{section.section_label}</span>
                  <span className="ml-2">{section.recommendations[0] || section.blockers[0]}</span>
                </div>
              ))}
              {topGaps.length === 0 && (
                <p className="rounded-admin-sm bg-emerald-50 p-2 text-xs text-emerald-700">No section gap is above the 95+ gate.</p>
              )}
            </div>
          </div>

          {director && (
            <div className="rounded-admin-md border border-admin-border bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-admin-text">Latest AI decision</h3>
                <span className={`rounded-admin-sm border px-2 py-0.5 text-xs ${director.persisted ? statusClass('planned') : statusClass('warn')}`}>
                  {director.persisted ? 'staged' : 'preview'}
                </span>
              </div>
              <div className="mt-2 space-y-2 text-xs leading-5 text-admin-muted">
                <p>
                  Decisions {director.decisions?.length || 0}, planned budgets {plannedAllocations.length}, blocked packets {blockedPackets.length}.
                </p>
                {plannedAllocations.slice(0, 4).map((allocation) => (
                  <div key={allocation.platform} className="flex items-center justify-between gap-3 rounded-admin-sm bg-admin-surface p-2">
                    <span className="font-semibold text-admin-text">{allocation.platform}</span>
                    <span>{allocation.allocation_pct}% / {formatKrw(allocation.daily_cap_krw)} daily</span>
                  </div>
                ))}
                {director.decisions?.slice(0, 2).map((decision) => (
                  <div key={decision.id} className="rounded-admin-sm bg-admin-surface p-2">
                    <p className="font-semibold text-admin-text">{decision.title}</p>
                    <p>{decision.next_action}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {repairPlan?.persisted && (
            <div className="rounded-admin-md border border-admin-border bg-white p-3">
              <h3 className="text-sm font-semibold text-admin-text">Repair queue</h3>
              <p className="mt-2 text-xs leading-5 text-admin-muted">
                Staged {repairPlan.persisted_rows?.repair_queue || 0} repair rows and {repairPlan.persisted_rows?.subcategory_scores || 0} score rows.
              </p>
            </div>
          )}

          {sourceImport?.ok && (
            <div className="rounded-admin-md border border-admin-border bg-white p-3">
              <h3 className="text-sm font-semibold text-admin-text">Source ledger</h3>
              <p className="mt-2 text-xs leading-5 text-admin-muted">
                Imported {sourceImport.imported_sources || 0} reviewed sources. Current {sourceImport.current_sources || 0}/{sourceImport.target_sources || 100}.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-admin-md border border-admin-border bg-white p-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-admin-text">Deep category matrix</h3>
            <p className="mt-1 text-xs text-admin-muted">
              {deepScorecard?.summary?.domain_count ?? 0} domains / {deepScorecard?.summary?.subcategory_count ?? 0} subcategories
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={`rounded-admin-sm border px-2 py-1 ${deepScorecard?.source_ledger?.ready ? statusClass('pass') : statusClass('warn')}`}>
              Source seeds {deepScorecard?.source_ledger?.seed_sources ?? 0}
            </span>
            <span className={`rounded-admin-sm border px-2 py-1 ${deepScorecard?.summary?.p0_gaps ? statusClass('fail') : statusClass('pass')}`}>
              P0 gaps {deepScorecard?.summary?.p0_gaps ?? 0}
            </span>
          </div>
        </div>

        {deepGaps.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
            {deepGaps.map((gap) => (
              <div key={gap.id} className="rounded-admin-sm border border-amber-100 bg-amber-50 p-2 text-xs leading-5">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-admin-text">{gap.label}</span>
                  <span className={`shrink-0 rounded-admin-sm border px-2 py-0.5 font-semibold ${statusClass(gap.status)}`}>
                    {gap.priority} / {gap.score}
                  </span>
                </div>
                <p className="mt-1 text-amber-800">{gap.repair_action}</p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
          {deepDomains.map((domain) => (
            <div key={domain.domain_key} className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-semibold text-admin-text">{domain.domain_label}</p>
                <span className={`shrink-0 rounded-admin-sm border px-2 py-0.5 text-xs font-semibold ${statusClass(domain.status)}`}>
                  {domain.score}
                </span>
              </div>
              <div className="mt-2 space-y-1.5">
                {domain.subcategories.map((item) => (
                  <div key={item.id} className="rounded-admin-xs bg-white px-2 py-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 text-xs font-medium leading-5 text-admin-text">{item.label}</span>
                      <span className={`shrink-0 rounded-admin-sm border px-1.5 py-0.5 text-[11px] font-semibold ${statusClass(item.status)}`}>
                        {item.score}
                      </span>
                    </div>
                    {item.status !== 'pass' && (
                      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-admin-muted">{item.repair_action}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {deepDomains.length === 0 && (
            <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3 text-sm text-admin-muted">
              Deep scorecard data is not loaded.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
