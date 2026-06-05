'use client';

import { useEffect, useState } from 'react';
import type { JarvisReadinessSummary } from '@/lib/jarvis/eval/readiness-gate';

interface ReadinessPayload {
  mode: 'lightweight';
  generated_at: string;
  release_gate_command: string;
  summary: JarvisReadinessSummary;
}

function tone(status?: 'pass' | 'warn' | 'fail') {
  if (status === 'pass') {
    return {
      panel: 'border-emerald-200 bg-emerald-50',
      badge: 'bg-emerald-600 text-white',
      text: 'text-emerald-700',
      label: 'Release signal',
    };
  }
  if (status === 'fail') {
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
    label: status === 'warn' ? 'Needs gate' : 'Loading',
  };
}

export default function JarvisReadinessCard() {
  const [payload, setPayload] = useState<ReadinessPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/jarvis/readiness')
      .then(async (response) => {
        const contentType = response.headers.get('content-type') ?? '';
        if (!response.ok || !contentType.includes('application/json')) {
          throw new Error(`status ${response.status}`);
        }
        return response.json() as Promise<ReadinessPayload>;
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
  const cardTone = tone(summary?.status);

  return (
    <section className={`rounded-admin-md border p-4 ${cardTone.panel}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-admin-text-2">Jarvis Readiness</h3>
        <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${cardTone.badge}`}>
          {summary ? summary.status.toUpperCase() : cardTone.label}
        </span>
      </div>

      {summary ? (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <Kpi label="Score" value={`${summary.score}/${summary.maxScore}`} highlight={summary.status === 'pass'} />
            <Kpi label="Warnings" value={summary.warningChecks.length.toString()} />
            <Kpi label="Blocks" value={summary.blockingChecks.length.toString()} />
          </div>
          <div className="space-y-1 text-[11px] text-admin-text-2">
            {summary.checks.slice(0, 4).map((check) => (
              <div key={check.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{check.label}</span>
                <span className="shrink-0 font-bold">{check.status}</span>
              </div>
            ))}
          </div>
          {summary.warningChecks.length > 0 && (
            <p className={`mt-2 text-[11px] leading-relaxed ${cardTone.text}`}>
              Lightweight snapshot skips heavy checks. Run <code className="rounded bg-white px-1 py-0.5 text-[10px]">{payload.release_gate_command}</code> before release.
            </p>
          )}
        </>
      ) : (
        <p className={`text-[11px] leading-relaxed ${cardTone.text}`}>
          {error
            ? `Readiness snapshot could not be loaded (${error}). Run npm run verify:jarvis-readiness for CLI evidence.`
            : 'Loading Jarvis readiness snapshot.'}
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
