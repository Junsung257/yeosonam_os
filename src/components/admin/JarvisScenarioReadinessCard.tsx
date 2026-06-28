'use client';

import { useEffect, useState } from 'react';
import type { AllScenarioReadinessSummary } from '@/lib/jarvis/eval/all-scenarios-readiness';

interface ScenarioReadinessPayload {
  mode: 'lightweight';
  generated_at: string;
  release_gate_command: string;
  summary: AllScenarioReadinessSummary;
  customer_inquiry: {
    total: number;
    passed: number;
    score: number;
  };
  free_travel: {
    total: number;
    passed: number;
    score: number;
    p0Failures: unknown[];
  };
}

function tone(summary?: AllScenarioReadinessSummary) {
  if (summary?.status === 'pass') {
    return {
      panel: 'border-emerald-200 bg-emerald-50',
      badge: 'bg-emerald-600 text-white',
      text: 'text-emerald-700',
      label: 'Ready',
    };
  }
  if (summary?.status === 'fail' && summary.blockingSections.length > 0) {
    return {
      panel: 'border-red-200 bg-red-50',
      badge: 'bg-red-600 text-white',
      text: 'text-red-700',
      label: 'Blocked',
    };
  }
  return {
    panel: 'border-amber-200 bg-amber-50',
    badge: 'bg-amber-600 text-white',
    text: 'text-amber-700',
    label: summary ? 'CLI Required' : 'Loading',
  };
}

export default function JarvisScenarioReadinessCard() {
  const [payload, setPayload] = useState<ScenarioReadinessPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/jarvis/scenario-readiness')
      .then(async (response) => {
        const contentType = response.headers.get('content-type') ?? '';
        if (!response.ok || !contentType.includes('application/json')) {
          throw new Error(`status ${response.status}`);
        }
        return response.json() as Promise<ScenarioReadinessPayload>;
      })
      .then((data) => {
        setPayload(data);
        setError(null);
      })
      .catch((err) => {
        setPayload(null);
        setError(err instanceof Error ? err.message : 'unknown error');
      });
  }, []);

  const summary = payload?.summary;
  const cardTone = tone(summary);

  return (
    <section className={`rounded-admin-md border p-4 ${cardTone.panel}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-admin-text-2">All-Scenario Readiness</h3>
        <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${cardTone.badge}`}>
          {summary ? cardTone.label : 'Loading'}
        </span>
      </div>

      {summary && payload ? (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Kpi label="Weighted" value={`${summary.score}/${summary.maxScore}`} highlight={summary.status === 'pass'} />
            <Kpi label="Threshold" value={`${summary.passThreshold}+`} />
            <Kpi label="Inquiry" value={`${payload.customer_inquiry.passed}/${payload.customer_inquiry.total}`} />
            <Kpi label="Free travel" value={`${payload.free_travel.passed}/${payload.free_travel.total}`} />
          </div>

          <div className="space-y-1 text-[11px] text-admin-text-2">
            {summary.sections.map((section) => (
              <div key={section.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{section.label}</span>
                <span className="shrink-0 font-bold tabular-nums">
                  {section.score}/{section.maxScore}
                </span>
              </div>
            ))}
          </div>

          {payload.free_travel.p0Failures.length > 0 && (
            <p className="mt-2 text-[11px] leading-relaxed text-red-700">
              Free-travel P0 failures are blocking one-click automation release.
            </p>
          )}

          <p className={`mt-2 text-[11px] leading-relaxed ${cardTone.text}`}>
            Run <code className="rounded bg-white px-1 py-0.5 text-[10px]">{payload.release_gate_command}</code> for full 95+ release evidence.
          </p>
        </>
      ) : (
        <p className={`text-[11px] leading-relaxed ${cardTone.text}`}>
          {error
            ? `Scenario readiness snapshot could not be loaded (${error}). Run npm run verify:jarvis-all-scenarios for CLI evidence.`
            : 'Loading all-scenario readiness snapshot.'}
        </p>
      )}
    </section>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border bg-white p-2 ${highlight ? 'border-emerald-300' : 'border-admin-border-mid'}`}>
      <div className="text-[10px] uppercase text-admin-muted-2">{label}</div>
      <div className={`mt-0.5 text-base font-extrabold tabular-nums ${highlight ? 'text-emerald-700' : 'text-admin-text-2'}`}>
        {value}
      </div>
    </div>
  );
}
