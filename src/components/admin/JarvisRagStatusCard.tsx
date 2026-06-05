'use client';

import { useEffect, useMemo, useState } from 'react';
import { fmtDateISO } from '@/lib/admin-utils';
import type {
  RagIndexAuditSummary,
  RagIndexIssueCode,
} from '@/lib/jarvis/eval/rag-index-audit';

interface Status {
  total_chunks: number;
  by_source: Record<string, number>;
  last_indexed_at: string | null;
  bot_profiles: number;
  rag_ready: boolean;
  audit?: RagIndexAuditSummary;
}

const SOURCE_LABELS: Record<string, string> = {
  package: 'Products',
  blog: 'Blog',
  attraction: 'Attractions',
  policy: 'Policies',
  custom: 'Custom',
};

const ISSUE_LABELS: Record<RagIndexIssueCode, string> = {
  empty_chunk_text: 'Empty chunk',
  empty_contextual_text: 'Empty context',
  short_chunk_text: 'Short chunk',
  short_contextual_text: 'Short context',
  context_not_enriched: 'Context not enriched',
  missing_source_title: 'Missing title',
  missing_source_ref: 'Missing source ref',
  missing_content_hash: 'Missing hash',
  stale_chunk: 'Stale chunk',
  duplicate_source_chunk: 'Duplicate source chunk',
  missing_expected_source: 'Missing source coverage',
};

function readinessTone(status: Status): {
  panel: string;
  badge: string;
  text: string;
  label: string;
} {
  const level = status.audit?.readinessLevel;
  if (!status.rag_ready || level === 'blocked') {
    return {
      panel: 'bg-red-50 border-red-200',
      badge: 'bg-red-600 text-white',
      text: 'text-red-700',
      label: 'Blocked',
    };
  }
  if (level === 'watch') {
    return {
      panel: 'bg-amber-50 border-amber-200',
      badge: 'bg-amber-600 text-white',
      text: 'text-amber-700',
      label: 'Watch',
    };
  }
  return {
    panel: 'bg-emerald-50 border-emerald-200',
    badge: 'bg-emerald-600 text-white',
    text: 'text-emerald-700',
    label: 'Ready',
  };
}

export default function JarvisRagStatusCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/jarvis/rag-status')
      .then(async (response) => {
        const contentType = response.headers.get('content-type') ?? '';
        if (!response.ok || !contentType.includes('application/json')) {
          throw new Error(`status ${response.status}`);
        }
        return response.json() as Promise<Status>;
      })
      .then((data) => {
        if (!Number.isFinite(data.total_chunks)) throw new Error('invalid payload');
        setStatus(data);
        setError(null);
      })
      .catch((err) => {
        setStatus(null);
        setError(err instanceof Error ? err.message : 'unknown error');
      });
  }, []);

  const visibleIssues = useMemo(() => {
    if (!status?.audit) return [];
    return (Object.entries(status.audit.issueCounts) as [RagIndexIssueCode, number][])
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [status]);

  if (!status) {
    return (
      <section className="rounded-admin-md border border-amber-200 bg-amber-50 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-admin-text-2">
            <span aria-hidden="true">RAG</span>
            <span>Jarvis Knowledge Index</span>
          </h3>
          <span className="rounded bg-amber-600 px-2 py-0.5 text-[11px] font-bold text-white">
            {error ? 'Unavailable' : 'Loading'}
          </span>
        </div>
        <p className="text-[11px] leading-relaxed text-amber-700">
          {error
            ? `RAG audit status could not be loaded (${error}). Run npm run audit:jarvis-rag for CLI evidence.`
            : 'Loading live RAG audit status.'}
        </p>
      </section>
    );
  }

  const total = status.total_chunks;
  const audit = status.audit;
  const tone = readinessTone(status);

  return (
    <section className={`rounded-admin-md border p-4 ${tone.panel}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-admin-text-2">
          <span aria-hidden="true">RAG</span>
          <span>Jarvis Knowledge Index</span>
        </h3>
        <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${tone.badge}`}>
          {tone.label}
        </span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi label="Chunks" value={total.toLocaleString()} highlight={status.rag_ready} />
        <Kpi label="Audit score" value={audit ? `${audit.qualityScore}/100` : '-'} highlight={audit?.readinessLevel === 'ready'} />
        <Kpi label="Sample" value={audit ? audit.sampledRows.toLocaleString() : '-'} />
        <Kpi label="Last indexed" value={status.last_indexed_at ? fmtDateISO(status.last_indexed_at) : 'none'} />
      </div>

      {Object.keys(status.by_source).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(status.by_source).map(([source, count]) => (
            <span
              key={source}
              className="inline-flex items-center gap-1 rounded-full border border-admin-border-mid bg-white px-2 py-0.5 text-[11px]"
            >
              <span>{SOURCE_LABELS[source] ?? source}</span>
              <span className="font-bold tabular-nums">{count}</span>
            </span>
          ))}
        </div>
      )}

      {audit && (
        <div className="mt-3 space-y-2">
          {audit.coverage.missingSourceTypes.length > 0 && (
            <p className={`text-[11px] leading-relaxed ${tone.text}`}>
              Missing expected source coverage: {audit.coverage.missingSourceTypes.join(', ')}.
            </p>
          )}

          {visibleIssues.length > 0 ? (
            <div className="rounded border border-admin-border-mid bg-white p-2">
              <div className="mb-1 text-[10px] font-bold uppercase text-admin-muted-2">Audit findings</div>
              <div className="flex flex-wrap gap-1.5">
                {visibleIssues.map(([code, count]) => (
                  <span key={code} className="rounded bg-admin-surface-2 px-2 py-0.5 text-[11px] text-admin-text-2">
                    {ISSUE_LABELS[code]}: <strong>{count}</strong>
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-emerald-700">No sampled chunk quality issues detected.</p>
          )}

          {audit.samples.length > 0 && (
            <ul className="space-y-1 text-[11px] text-admin-muted">
              {audit.samples.slice(0, 3).map((sample) => (
                <li key={sample.id} className="truncate">
                  {sample.sourceType}#{sample.chunkIndex ?? 'n/a'} {sample.sourceTitle ?? sample.id}: {sample.issues.map((issue) => ISSUE_LABELS[issue]).join(', ')}
                </li>
              ))}
            </ul>
          )}

          {audit.remediationActions.length > 0 && (
            <div className="rounded border border-admin-border-mid bg-white p-2">
              <div className="mb-1 text-[10px] font-bold uppercase text-admin-muted-2">Next actions</div>
              <ul className="space-y-1 text-[11px] text-admin-text-2">
                {audit.remediationActions.slice(0, 2).map((action) => (
                  <li key={action.id}>
                    <span className="font-bold">P{action.priority} {action.title}</span>
                    {action.commands[0] && (
                      <code className="ml-1 rounded bg-admin-surface-2 px-1 py-0.5 text-[10px]">
                        {action.commands[0]}
                      </code>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {!status.rag_ready && (
        <p className="mt-3 text-[11px] leading-relaxed text-amber-700">
          Run <code className="rounded bg-white px-1 py-0.5 text-[10px]">node db/rag_reindex_all.js</code> before relying on Jarvis product, blog, or attraction answers.
        </p>
      )}
    </section>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-2.5 ${highlight ? 'border-emerald-300 bg-white' : 'border-admin-border-mid bg-white'}`}>
      <div className="text-[10px] uppercase tracking-wide text-admin-muted-2">{label}</div>
      <div className={`mt-0.5 text-base font-extrabold tabular-nums ${highlight ? 'text-emerald-700' : 'text-admin-text-2'}`}>
        {value}
      </div>
    </div>
  );
}
