'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, SlidersHorizontal } from 'lucide-react';
import { PageHeader } from '@/components/admin/patterns';
import type { BookingOpsRuleHealth, BookingOpsSummary } from '@/lib/booking-ops';

function toneFor(rule: BookingOpsRuleHealth): string {
  if (rule.staleOver48h > 0 || rule.tuneScore >= 25) return 'border-red-200 bg-red-50 text-red-900';
  if (rule.tuneScore >= 10 || rule.autoResolveRatePct < 20) return 'border-amber-200 bg-amber-50 text-amber-900';
  return 'border-emerald-200 bg-emerald-50 text-emerald-900';
}

function recommendationFor(rule: BookingOpsRuleHealth): string {
  if (rule.staleOver48h > 0) return '담당자 재배정 또는 자동해결 조건을 먼저 확인하세요.';
  if (rule.autoResolveRatePct < 20 && rule.open >= 5) return '조건이 너무 넓을 수 있습니다. 생성 조건과 예외 키워드를 좁히는 것을 권장합니다.';
  if (rule.snoozed >= 5) return '운영자가 자주 미루는 룰입니다. CTA 문구나 처리 기준을 더 명확히 바꾸세요.';
  if (rule.open === 0) return '현재 안정권입니다. 규칙 변경보다 유지 관찰이 적합합니다.';
  return '현재 기준은 유지하되 48시간 초과가 생기는지 관찰하세요.';
}

export default function BookingOpsRulesPage() {
  const [summary, setSummary] = useState<BookingOpsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/booking-ops/summary?limit=20', { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      setSummary((await res.json()) as BookingOpsSummary);
    } catch {
      setSummary(null);
      setError('예약 룰 상태를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rules = useMemo(
    () => [...(summary?.ruleHealth ?? [])].sort((a, b) => b.tuneScore - a.tuneScore),
    [summary],
  );

  const totals = useMemo(() => ({
    open: rules.reduce((sum, rule) => sum + rule.open, 0),
    stale: rules.reduce((sum, rule) => sum + rule.staleOver48h, 0),
    snoozed: rules.reduce((sum, rule) => sum + rule.snoozed, 0),
    autoResolved: rules.reduce((sum, rule) => sum + rule.autoResolved24h, 0),
  }), [rules]);

  return (
    <div className="min-h-screen bg-admin-bg p-6">
      <PageHeader
        title="예약 룰 튜닝"
        subtitle="예약 액션큐를 만드는 자동화 룰의 피로도와 자동해결 상태를 점검합니다."
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link
          href="/admin/bookings"
          className="rounded-admin-sm border border-admin-border-mid bg-white px-3 py-1.5 text-admin-xs font-semibold text-admin-text-2 hover:bg-admin-surface-2"
        >
          예약관리
        </Link>
        <Link
          href="/admin/inbox"
          className="rounded-admin-sm border border-admin-border-mid bg-white px-3 py-1.5 text-admin-xs font-semibold text-admin-text-2 hover:bg-admin-surface-2"
        >
          예약 액션큐
        </Link>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-admin-sm border border-admin-border-mid bg-white px-3 py-1.5 text-admin-xs font-semibold text-admin-text-2 hover:bg-admin-surface-2"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          새로고침
        </button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <Metric label="열린 작업" value={totals.open} />
        <Metric label="48시간 초과" value={totals.stale} danger={totals.stale > 0} />
        <Metric label="보류" value={totals.snoozed} />
        <Metric label="24h 자동해결" value={totals.autoResolved} />
      </div>

      <section className="mt-5 rounded-admin-md border border-admin-border bg-white shadow-admin-xs">
        <div className="flex items-center justify-between gap-3 border-b border-admin-border px-4 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-admin-base font-bold text-admin-text">
              <SlidersHorizontal size={16} />
              룰별 점검
            </h2>
            <p className="mt-0.5 text-admin-xs text-admin-muted">
              점수가 높을수록 운영자를 자주 멈추게 만드는 룰입니다.
            </p>
          </div>
        </div>

        <div className="p-4">
          {loading && !summary ? (
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-28 animate-pulse rounded-admin-sm bg-admin-surface-2" />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-admin-sm border border-red-100 bg-red-50 px-4 py-5 text-red-800">
              <p className="text-admin-sm font-bold">룰 상태 확인 실패</p>
              <p className="mt-1 text-admin-xs">{error}</p>
            </div>
          ) : rules.length === 0 ? (
            <div className="rounded-admin-sm border border-dashed border-emerald-200 bg-emerald-50/50 px-4 py-6 text-center text-admin-sm text-emerald-800">
              현재 조정이 필요한 룰 신호가 없습니다.
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {rules.map((rule) => (
                <Link
                  key={rule.taskType}
                  href={`/admin/inbox?type=${encodeURIComponent(rule.taskType)}`}
                  className={`rounded-admin-sm border p-4 transition hover:shadow-admin-xs ${toneFor(rule)}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-admin-sm font-extrabold">{rule.taskTypeLabel}</h3>
                      <p className="mt-1 text-admin-xs opacity-80">{rule.tuneReason}</p>
                    </div>
                    <div className="shrink-0 rounded-admin-sm bg-white/70 px-2 py-1 text-right">
                      <p className="text-[10px] font-bold opacity-60">튜닝 점수</p>
                      <p className="text-admin-sm font-extrabold tabular-nums">{Math.round(rule.tuneScore)}</p>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                    <RuleMetric label="오픈" value={rule.open} />
                    <RuleMetric label="보류" value={rule.snoozed} />
                    <RuleMetric label="48h" value={rule.staleOver48h} />
                    <RuleMetric label="자동" value={`${rule.autoResolveRatePct}%`} />
                  </div>

                  <p className="mt-3 rounded-admin-sm bg-white/70 px-3 py-2 text-[12px] leading-relaxed">
                    {recommendationFor(rule)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-admin-md border border-admin-border bg-white px-4 py-3 shadow-admin-xs">
      <p className="text-admin-xs font-semibold text-admin-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${danger ? 'text-red-600' : 'text-admin-text'}`}>
        {value.toLocaleString('ko-KR')}
      </p>
    </div>
  );
}

function RuleMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-admin-sm bg-white/70 px-2 py-2">
      <p className="text-[10px] font-bold opacity-60">{label}</p>
      <p className="mt-0.5 text-[12px] font-extrabold tabular-nums">{value}</p>
    </div>
  );
}
