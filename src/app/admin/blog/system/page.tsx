'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { fmtDateTime } from '@/lib/admin-utils';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { Activity, AlertTriangle, ArrowLeft, Calendar, CheckCircle2, Clock as ClockIcon, Flame, PenLine, RefreshCw, Search } from 'lucide-react';

type CronHealthRow = Record<string, unknown>;

interface BlogSystemPayload {
  blog_cron_health: CronHealthRow[];
  blog_failures_24h: Array<{
    cron_name: string;
    status: string;
    started_at: string;
    elapsed_ms: number | null;
    error_count: number | null;
    error_messages: string[] | null;
  }>;
  blog_success_rate_7d_percent: Record<string, number>;
  blog_queue_counts: Record<string, number>;
  indexing_recent: Array<{
    url: string;
    google_status: string;
    google_error: string | null;
    indexnow_status: string;
    indexnow_error: string | null;
    reported_at: string;
  }>;
  hints: { cron_secret_configured: boolean; base_url_for_cron_fetch: string | null };
  generated_at: string;
}

interface BlogOpsSummary {
  level: 'healthy' | 'watch' | 'risk' | 'blocked';
  publish: { published_today: number; daily_target: number; remaining_today: number; level: string };
  queue: { counts: Record<string, number>; active_count: number; overdue_queued: number; stale_generating: number; level: string };
  indexing: {
    active_jobs: number;
    recent_failures: number;
    google_unknown_urls?: number;
    google_indexed_reports?: number;
    inspected_reports?: number;
    indexnow_success_rate: number | null;
    level: string;
  };
  cron: {
    unhealthy_count: number;
    core: Array<{
      cron_name: string;
      last_status: string;
      last_run_at: string | null;
      last_elapsed_ms: number | null;
      last_error_count: number | null;
      last_summary: Record<string, unknown> | null;
    }>;
  };
  contract: { passed: boolean; failed_checks: string[] };
}

export default function BlogSystemPage() {
  const [data, setData] = useState<BlogSystemPayload | null>(null);
  const [ops, setOps] = useState<BlogOpsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  /** 수동 실행(발행자 등) 응답 — 새로고침 전까지 유지 */
  const [actionLog, setActionLog] = useState<string | null>(null);
  /** 대시보드 API 로드 실패 메시지 */
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [res, opsRes] = await Promise.all([
        fetch('/api/ops/blog-system', { cache: 'no-store' }),
        fetch('/api/admin/blog/ops-summary', { cache: 'no-store' }),
      ]);
      const json = await res.json();
      const opsJson = await opsRes.json().catch(() => null);
      if (!res.ok) {
        setData(null);
        setLoadError(`API 오류: ${json.error || res.statusText}`);
      } else {
        setData(json as BlogSystemPayload);
      }
      if (opsRes.ok && opsJson?.ok !== false) setOps(opsJson as BlogOpsSummary);
    } catch (e) {
      setData(null);
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const trigger = async (action: string) => {
    setRunning(action);
    try {
      const res = await fetch('/api/blog/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      setActionLog(JSON.stringify(json, null, 2).slice(0, 4000));
      await load();
    } catch (e) {
      setActionLog('실패: ' + (e as Error).message);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader
        title="블로그 시스템 · 크론"
        subtitle={
          <>Vercel 대신 여기서 발행 파이프라인 상태를 봅니다. 스케줄 시각은 배포의 <code className="text-admin-2xs bg-admin-surface-2 px-1.5 py-0.5 rounded-admin-xs font-mono">vercel.json</code> 과 동일합니다.</>
        }
        actions={
          <>
            <Link href="/admin/ops">
              <Button variant="secondary" size="sm">
                <ClockIcon size={14} />
                전체 크론
              </Button>
            </Link>
            <Link href="/admin/blog/queue">
              <Button variant="secondary" size="sm">
                <Calendar size={14} />
                자동 발행 큐
              </Button>
            </Link>
            <Link href="/admin/blog">
              <Button variant="secondary" size="sm">
                <ArrowLeft size={14} />
                블로그 목록
              </Button>
            </Link>
            <Button variant="primary" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              새로고침
            </Button>
          </>
        }
      />

      {ops && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['오늘 발행', `${ops.publish.published_today}/${ops.publish.daily_target}`, ops.publish.remaining_today ? `남은 ${ops.publish.remaining_today}편` : '목표 달성', Activity, ops.publish.remaining_today ? 'text-danger' : 'text-success'],
            ['큐 문제', `${ops.queue.counts.failed || 0}`, `지연 ${ops.queue.overdue_queued} · 정체 ${ops.queue.stale_generating}`, AlertTriangle, (ops.queue.counts.failed || 0) ? 'text-danger' : 'text-success'],
            ['색인 작업', `${ops.indexing.active_jobs}`, ops.indexing.indexnow_success_rate == null ? '집계 대기' : `IndexNow ${ops.indexing.indexnow_success_rate}%`, Search, ops.indexing.active_jobs ? 'text-warning' : 'text-success'],
            ['계약 상태', ops.contract.passed ? '통과' : '점검', ops.contract.failed_checks.join(', ') || '핵심 계약 정상', CheckCircle2, ops.contract.passed ? 'text-success' : 'text-danger'],
          ].map(([label, value, hint, Icon, tone]) => (
            <div key={String(label)} className="admin-card p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-admin-xs font-semibold uppercase tracking-wider text-admin-muted">{String(label)}</p>
                <Icon size={15} className="text-admin-muted-2" />
              </div>
              <p className={`mt-2 text-admin-display font-bold admin-num ${tone}`}>{String(value)}</p>
              <p className="mt-1 text-admin-xs leading-5 text-admin-muted">{String(hint)}</p>
            </div>
          ))}
        </section>
      )}

      {ops?.cron.core?.length ? (
        <div className="admin-card overflow-hidden">
          <div className="px-3 py-2.5 bg-admin-surface-2 border-b border-admin-border text-admin-xs font-semibold text-admin-text-2">
            핵심 블로그 크론 상태
          </div>
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>크론</th>
                <th>상태</th>
                <th>최근 실행</th>
                <th className="text-right">시간</th>
                <th className="text-right">오류</th>
              </tr>
            </thead>
            <tbody>
              {ops.cron.core.map((row) => (
                <tr key={row.cron_name}>
                  <td className="font-mono text-admin-xs text-admin-text-2">{row.cron_name}</td>
                  <td>
                    <span className={`rounded-admin-xs px-2 py-0.5 text-admin-2xs font-semibold ${row.last_status === 'success' ? 'bg-status-successBg text-status-successFg' : 'bg-danger-light text-danger'}`}>
                      {row.last_status || '-'}
                    </span>
                  </td>
                  <td className="text-admin-xs text-admin-muted admin-num">{row.last_run_at ? fmtDateTime(row.last_run_at) : '-'}</td>
                  <td className="text-right text-admin-xs text-admin-muted admin-num">{row.last_elapsed_ms ? `${Math.round(row.last_elapsed_ms / 1000)}s` : '-'}</td>
                  <td className="text-right text-admin-xs text-admin-muted admin-num">{row.last_error_count || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* 환경 힌트 */}
      {data && (
        <div
          className={`rounded-admin-sm border px-3 py-2 text-admin-xs ${
            data.hints.cron_secret_configured
              ? 'bg-status-successBg border-success/20 text-status-successFg'
              : 'bg-status-warningBg border-warning/20 text-status-warningFg'
          }`}
        >
          <span className="font-semibold">CRON_SECRET:</span> {data.hints.cron_secret_configured ? '설정됨 (수동 발행·브리지에 필요)' : '없음 — 프로덕션 발행자가 401 날 수 있음'}
          {data.hints.base_url_for_cron_fetch && (
            <span className="block mt-1 text-admin-2xs opacity-90 font-mono">내부 호출 BASE: {data.hints.base_url_for_cron_fetch}</span>
          )}
        </div>
      )}

      {/* 수동 실행 */}
      <div className="admin-card p-4">
        <h2 className="text-admin-h3 text-admin-text mb-3">수동 실행 (큐 페이지와 동일 API)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(
            [
              ['run_scheduler', '스케줄러'],
              ['run_trend_miner', '트렌드'],
              ['run_publisher', '발행자'],
              ['run_lifecycle', '라이프사이클'],
            ] as const
          ).map(([action, label]) => (
            <button
              key={action}
              type="button"
              disabled={running !== null}
              onClick={() => trigger(action)}
              className="px-3 py-2.5 bg-admin-surface border border-admin-border-mid rounded-admin-sm text-admin-sm font-medium text-admin-text-2 hover:bg-admin-surface-2 hover:border-admin-border-strong disabled:opacity-50 transition-colors"
            >
              {running === action ? '…' : label}
            </button>
          ))}
        </div>
        {actionLog && (
          <pre className="mt-3 p-3 bg-admin-text text-admin-on-brand text-admin-2xs rounded-admin-sm overflow-x-auto max-h-64 whitespace-pre-wrap font-mono">
            {actionLog}
          </pre>
        )}
      </div>

      {loading && !data && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-3.5 bg-admin-surface-2 rounded animate-pulse" style={{ width: `${90 - i * 10}%` }} />
          ))}
        </div>
      )}

      {loadError && !loading && (
        <pre className="text-danger text-admin-xs whitespace-pre-wrap bg-danger-light border border-danger/20 rounded-admin-sm p-3 font-mono">{loadError}</pre>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(data.blog_queue_counts).map(([k, v]) => (
              <div key={k} className="admin-card px-4 py-3">
                <p className="text-admin-2xs text-admin-muted uppercase tracking-wider font-semibold">{k}</p>
                <p className="text-admin-h2 font-bold text-admin-text admin-num mt-1">{v}</p>
              </div>
            ))}
            {Object.keys(data.blog_queue_counts).length === 0 && (
              <p className="text-admin-xs text-admin-muted col-span-full">큐 집계 없음</p>
            )}
          </div>

          <div className="admin-card overflow-hidden">
            <div className="px-3 py-2.5 bg-admin-surface-2 border-b border-admin-border text-admin-xs font-semibold text-admin-text-2">
              블로그 관련 크론 요약 (cron_health)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-admin-xs">
                <tbody>
                  {data.blog_cron_health.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-admin-muted">뷰가 비었거나 아직 기록 없음</td>
                    </tr>
                  ) : (
                    data.blog_cron_health.map((row, i) => (
                      <tr key={i} className="border-b border-admin-border align-top last:border-0">
                        <td className="px-3 py-2 font-mono text-admin-2xs text-admin-muted whitespace-pre-wrap">
                          {JSON.stringify(row, null, 0)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="admin-card overflow-hidden">
            <div className="px-3 py-2.5 bg-admin-surface-2 border-b border-admin-border text-admin-xs font-semibold text-admin-text-2">
              최근 24시간 블로그 크론 비성공 로그
            </div>
            {data.blog_failures_24h.length === 0 ? (
              <p className="px-3 py-4 text-admin-xs text-admin-muted">없음</p>
            ) : (
              <ul className="divide-y divide-admin-border max-h-56 overflow-y-auto">
                {data.blog_failures_24h.map((f, i) => (
                  <li key={i} className="px-3 py-2 text-admin-xs">
                    <span className="font-semibold text-admin-text">{f.cron_name}</span>{' '}
                    <span className="text-danger font-semibold">{f.status}</span>{' '}
                    <span className="text-admin-muted-2 admin-num">{fmtDateTime(f.started_at)}</span>
                    {f.error_messages?.length ? (
                      <pre className="mt-1 text-danger whitespace-pre-wrap font-mono text-admin-2xs">{f.error_messages.join('\n')}</pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="admin-card p-3">
            <h3 className="text-admin-xs font-semibold text-admin-text-2 mb-2">7일 성공률 (블로그 크론만)</h3>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(data.blog_success_rate_7d_percent)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, pct]) => (
                  <span key={name} className="inline-flex items-center gap-1 px-2 py-1 bg-admin-surface-2 rounded-admin-xs text-admin-xs">
                    <span className="font-mono text-admin-text-2">{name}</span>
                    <span className={`font-bold admin-num ${pct >= 95 ? 'text-success' : pct >= 80 ? 'text-warning' : 'text-danger'}`}>{pct}%</span>
                  </span>
                ))}
              {Object.keys(data.blog_success_rate_7d_percent).length === 0 && (
                <span className="text-admin-xs text-admin-muted-2">7일간 로그 없음</span>
              )}
            </div>
          </div>

          <div className="admin-card overflow-hidden">
            <div className="px-3 py-2.5 bg-admin-surface-2 border-b border-admin-border text-admin-xs font-semibold text-admin-text-2">
              최근 색인 알림 (notifyIndexing)
            </div>
            {data.indexing_recent.length === 0 ? (
              <p className="px-3 py-4 text-admin-xs text-admin-muted">기록 없음</p>
            ) : (
              <ul className="divide-y divide-admin-border text-admin-xs max-h-64 overflow-y-auto">
                {data.indexing_recent.map((r, i) => (
                  <li key={i} className="px-3 py-2">
                    <div className="truncate text-brand font-mono text-admin-2xs" title={r.url}>
                      {r.url}
                    </div>
                    <div className="text-admin-muted mt-0.5 admin-num">
                      Google: <b className={r.google_status === 'ok' ? 'text-success' : 'text-danger'}>{r.google_status}</b>
                      {r.google_error ? ` (${r.google_error})` : ''} · IndexNow: <b className={r.indexnow_status === 'ok' ? 'text-success' : 'text-danger'}>{r.indexnow_status}</b>
                      {r.indexnow_error ? ` (${r.indexnow_error})` : ''} ·{' '}
                      {fmtDateTime(r.reported_at)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-admin-2xs text-admin-muted-2 admin-num">갱신: {fmtDateTime(data.generated_at)}</p>
        </>
      )}
    </div>
  );
}
