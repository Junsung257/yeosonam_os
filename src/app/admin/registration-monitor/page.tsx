'use client';

/**
 * @file /admin/registration-monitor/page.tsx
 * @description 등록 정확도 모니터링 대시보드 — V2 추세 + 풀자동 전환 트리거 평가.
 *
 * 박제 사유 (2026-05-13): registration_auto_policy 풀자동 전환 시점을
 * 사장님이 한 화면에서 평가하고, SQL 안 치고 클릭으로 임계치 조정.
 */

import { useEffect, useState, useCallback } from 'react';

interface TriggerCondition {
  id: string;
  label: string;
  actual: number | string;
  threshold: number;
  passed: boolean;
  description: string;
}

interface Policy {
  auto_publish_above: number;
  confirm_queue_above: number;
  pending_review_above: number;
  reject_leak_score_above: number;
  full_auto_enabled: boolean;
  trigger_max_reject_rate_30d: number;
  trigger_max_leak_per_week: number;
  trigger_min_cove_pass_rate: number;
  trigger_min_reflexion_count: number;
}

interface MonitorData {
  policy: Policy;
  last30dStats: {
    total_registrations: number;
    rejected_count: number;
    reject_rate: number;
    confirm_queue_count: number;
    auto_publish_count: number;
    avg_confidence: number;
    weekly_leak_count: number;
    cove_pass_rate: number;
    reflexion_count: number;
  };
  triggerEval: {
    conditions: TriggerCondition[];
    all_passed: boolean;
    recommendation: string;
    summary: string;
  };
  recentLog: Array<{
    id: number;
    package_id: string | null;
    internal_code: string | null;
    confidence: number;
    fill_score: number;
    xvalid_score: number;
    leak_score: number;
    auto_gate: string;
    failed_checks_count: number;
    leak_incidents_count: number;
    created_at: string;
  }>;
  dailyTrend: Array<{ date: string; count: number; avg_confidence: number; rejected: number }>;
}

const gateLabel: Record<string, { text: string; cls: string }> = {
  auto_publish:   { text: '자동',    cls: 'bg-emerald-100 text-emerald-700' },
  confirm_queue:  { text: '컨펌',    cls: 'bg-amber-100  text-amber-700'    },
  pending_review: { text: '검토',    cls: 'bg-orange-100 text-orange-700'   },
  rejected:       { text: '거절',    cls: 'bg-red-100    text-red-700'      },
};

export default function RegistrationMonitorPage() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/registration-monitor');
      const d = await res.json();
      setData(d);
    } catch {
      setToast('로드 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const updatePolicy = async (patch: Partial<Policy> & { notes?: string }) => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/registration-monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setToast('정책 업데이트 완료');
      setTimeout(() => setToast(null), 2500);
      await load();
    } catch (e) {
      setToast(`실패: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-admin-muted">로드 중...</div>;
  if (!data) return <div className="p-8 text-red-500">데이터 없음</div>;

  const { policy, last30dStats, triggerEval, recentLog, dailyTrend } = data;
  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

  return (
    <main className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">등록 정확도 모니터링</h1>
        <button onClick={() => void load()} className="text-admin-sm px-3 py-1 bg-admin-surface-2 rounded">새로고침</button>
      </div>

      {toast && <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded text-sm">{toast}</div>}

      {/* ── 풀자동 전환 트리거 평가 ────────────────────────────── */}
      <section className={`rounded-lg border p-5 ${triggerEval.all_passed ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
        <h2 className="text-admin-sm font-bold mb-3">풀자동 전환 평가</h2>
        <p className="text-admin-sm mb-4">{triggerEval.summary}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {triggerEval.conditions.map(c => (
            <div key={c.id} className={`p-3 rounded border ${c.passed ? 'bg-white border-emerald-200' : 'bg-white border-red-200'}`}>
              <div className="text-[10px] text-admin-muted">{c.label}</div>
              <div className={`text-lg font-bold ${c.passed ? 'text-emerald-600' : 'text-red-600'}`}>{c.actual}</div>
              <div className="text-[10px] text-admin-muted-2">{c.description}</div>
            </div>
          ))}
        </div>
        {triggerEval.all_passed && !policy.full_auto_enabled && (
          <button
            disabled={saving}
            onClick={() => void updatePolicy({ full_auto_enabled: true, notes: `풀자동 전환 ${new Date().toISOString()}` })}
            className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded font-semibold disabled:opacity-50"
          >
            🚀 풀자동 전환 활성화
          </button>
        )}
        {policy.full_auto_enabled && (
          <button
            disabled={saving}
            onClick={() => void updatePolicy({ full_auto_enabled: false, notes: `컨펌 큐 복귀 ${new Date().toISOString()}` })}
            className="mt-4 px-4 py-2 bg-gray-600 text-white rounded font-semibold disabled:opacity-50"
          >
            컨펌 큐 복귀
          </button>
        )}
      </section>

      {/* ── 30일 통계 ──────────────────────────────────────────── */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="총 등록" value={last30dStats.total_registrations} />
        <Stat label="평균 신뢰도" value={pct(last30dStats.avg_confidence)} />
        <Stat label="자동 발행" value={last30dStats.auto_publish_count} hint="confidence≥95%" />
        <Stat label="컨펌 큐" value={last30dStats.confirm_queue_count} hint="70~95%" />
        <Stat label="거절" value={last30dStats.rejected_count} hint="<50% 또는 leak" tone={last30dStats.rejected_count > 0 ? 'warn' : 'ok'} />
      </section>

      {/* ── 임계치 정책 (인라인 조정) ─────────────────────────── */}
      <section className="bg-white border border-admin-border rounded-lg p-5">
        <h2 className="text-admin-sm font-bold mb-3">임계치 정책</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-admin-sm">
          <ThresholdRow
            label="자동 발행 ≥"
            value={policy.auto_publish_above}
            onChange={v => void updatePolicy({ auto_publish_above: v })}
            disabled={saving}
          />
          <ThresholdRow
            label="컨펌 큐 ≥"
            value={policy.confirm_queue_above}
            onChange={v => void updatePolicy({ confirm_queue_above: v })}
            disabled={saving}
          />
          <ThresholdRow
            label="검토 필요 ≥"
            value={policy.pending_review_above}
            onChange={v => void updatePolicy({ pending_review_above: v })}
            disabled={saving}
          />
          <ThresholdRow
            label="leak 거절 ≥"
            value={policy.reject_leak_score_above}
            onChange={v => void updatePolicy({ reject_leak_score_above: v })}
            disabled={saving}
          />
        </div>
      </section>

      {/* ── 일별 추세 (30일) ──────────────────────────────────── */}
      <section className="bg-white border border-admin-border rounded-lg p-5">
        <h2 className="text-admin-sm font-bold mb-3">일별 추세 (30일)</h2>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {dailyTrend.length === 0 ? (
            <p className="text-admin-muted text-sm">데이터 없음</p>
          ) : dailyTrend.map(d => (
            <div key={d.date} className="flex items-center gap-3 text-admin-sm">
              <span className="w-20 text-admin-muted">{d.date}</span>
              <div className="flex-1 bg-admin-surface-2 rounded h-4 relative overflow-hidden">
                <div
                  className={`h-full ${d.avg_confidence >= 0.9 ? 'bg-emerald-400' : d.avg_confidence >= 0.7 ? 'bg-amber-400' : 'bg-red-400'}`}
                  style={{ width: `${d.avg_confidence * 100}%` }}
                />
              </div>
              <span className="w-12 text-right font-mono text-xs">{pct(d.avg_confidence)}</span>
              <span className="w-8 text-right text-xs text-admin-muted">{d.count}건</span>
              {d.rejected > 0 && <span className="w-12 text-right text-xs text-red-500">거절 {d.rejected}</span>}
            </div>
          ))}
        </div>
      </section>

      {/* ── 최근 등록 20건 ────────────────────────────────────── */}
      <section className="bg-white border border-admin-border rounded-lg p-5">
        <h2 className="text-admin-sm font-bold mb-3">최근 등록 20건</h2>
        <table className="w-full text-admin-sm">
          <thead className="text-left text-admin-muted text-[11px] border-b">
            <tr>
              <th className="py-2">시각</th>
              <th>코드</th>
              <th>게이트</th>
              <th>신뢰도</th>
              <th>채움</th>
              <th>정합</th>
              <th>누출</th>
              <th>실패</th>
              <th>Leak</th>
            </tr>
          </thead>
          <tbody>
            {recentLog.map(r => (
              <tr key={r.id} className="border-b border-admin-border/30">
                <td className="py-1.5 text-[11px] text-admin-muted">{r.created_at.slice(5, 16).replace('T', ' ')}</td>
                <td className="font-mono text-[11px]">{r.internal_code ?? '—'}</td>
                <td>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${gateLabel[r.auto_gate]?.cls ?? 'bg-gray-100'}`}>
                    {gateLabel[r.auto_gate]?.text ?? r.auto_gate}
                  </span>
                </td>
                <td className={`font-bold ${r.confidence >= 0.9 ? 'text-emerald-600' : r.confidence >= 0.7 ? 'text-amber-600' : 'text-red-600'}`}>
                  {pct(r.confidence)}
                </td>
                <td className="text-xs">{pct(r.fill_score)}</td>
                <td className="text-xs">{pct(r.xvalid_score)}</td>
                <td className={`text-xs ${r.leak_score > 0 ? 'text-red-500' : ''}`}>{pct(r.leak_score)}</td>
                <td className="text-xs">{r.failed_checks_count > 0 ? <span className="text-amber-600">{r.failed_checks_count}</span> : '—'}</td>
                <td className="text-xs">{r.leak_incidents_count > 0 ? <span className="text-red-500">⚠ {r.leak_incidents_count}</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className={`p-3 rounded border ${tone === 'warn' ? 'bg-red-50 border-red-200' : 'bg-white border-admin-border'}`}>
      <div className="text-[10px] text-admin-muted">{label}</div>
      <div className={`text-xl font-bold ${tone === 'warn' ? 'text-red-600' : 'text-admin-text-2'}`}>{value}</div>
      {hint && <div className="text-[10px] text-admin-muted-2 mt-0.5">{hint}</div>}
    </div>
  );
}

function ThresholdRow({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled: boolean }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-admin-muted">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={local}
          onChange={e => setLocal(Number(e.target.value))}
          className="w-20 px-2 py-1 border rounded text-admin-sm"
        />
        <button
          disabled={disabled || local === value}
          onClick={() => onChange(local)}
          className="text-[10px] px-2 py-1 bg-blue-600 text-white rounded disabled:opacity-40"
        >
          저장
        </button>
      </div>
    </div>
  );
}
