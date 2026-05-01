/**
 * /admin/scoring/funnel — 추천 깔때기 LTR 대시보드 (v3.4, 2026-04-30)
 *
 * v_recommendation_funnel + v_ltr_signals 시각화:
 *  - source × intent × rank별 conversion rate
 *  - LTR 학습 샘플 누적 진행 (1000건 도달 시 ready)
 *  - 정책 A/B 비교 (policy_ab_results 가 채워지면 표시)
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface FunnelRow {
  source: string;
  intent: string;
  recommended_rank: number;
  exposures: number;
  clicks: number;
  inquiries: number;
  bookings: number;
  cancellations: number;
  conversion_rate_pct: number | null;
  booking_rate_pct: number | null;
  booking_value_sum: number | null;
}

interface Summary {
  total_exposures: number;
  total_bookings: number;
  overall_booking_rate_pct: number;
  ltr_training_samples: number;
  ltr_ready: boolean;
}

interface AbResult {
  id: number;
  measured_at: string;
  policy_a_version: string | null;
  policy_b_version: string | null;
  exposures_a: number; exposures_b: number;
  bookings_a: number; bookings_b: number;
  booking_rate_a: number; booking_rate_b: number;
  winner: string | null;
  confidence: number | null;
}

interface AdminAlert {
  id: number;
  created_at: string;
  category: string;
  severity: string;
  title: string;
  message: string | null;
  ref_type: string | null;
  ref_id: string | null;
}

export default function ScoringFunnelPage() {
  const [funnel, setFunnel] = useState<FunnelRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [abResults, setAbResults] = useState<AbResult[]>([]);
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSource, setFilterSource] = useState<string>('');
  const [filterIntent, setFilterIntent] = useState<string>('');

  useEffect(() => {
    let aborted = false;
    setLoading(true);
    fetch('/api/admin/scoring/funnel')
      .then(r => r.json())
      .then(d => {
        if (aborted) return;
        setFunnel(d.funnel ?? []);
        setSummary(d.summary ?? null);
        setAbResults(d.ab_results ?? []);
        setAlerts(d.alerts ?? []);
      })
      .catch(() => {})
      .finally(() => !aborted && setLoading(false));
    return () => { aborted = true; };
  }, []);

  const ackAlert = async (id: number) => {
    await fetch(`/api/admin/alerts/${id}/ack`, { method: 'POST' }).catch(() => {});
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  const sources = Array.from(new Set(funnel.map(f => f.source)));
  const intents = Array.from(new Set(funnel.map(f => f.intent)));
  const filtered = funnel.filter(f =>
    (!filterSource || f.source === filterSource) &&
    (!filterIntent || f.intent === filterIntent),
  );

  const totalExposures = filtered.reduce((s, r) => s + (r.exposures || 0), 0);
  const totalClicks = filtered.reduce((s, r) => s + (r.clicks || 0), 0);
  const totalBookings = filtered.reduce((s, r) => s + (r.bookings || 0), 0);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">추천 깔때기 (LTR)</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            모바일 카드 / 자비스 / 리스트 뱃지 → 클릭 → 예약 funnel · 정책 A/B 효과 검증
          </p>
        </div>
        <Link href="/admin/scoring" className="text-xs text-violet-600 hover:underline">← 정책 편집</Link>
      </div>

      {/* Admin Alerts (미해결 알림 박스) */}
      {alerts.length > 0 && (
        <section className="bg-amber-50 border border-amber-300 rounded-xl p-4">
          <h2 className="text-sm font-bold text-amber-900 mb-2">🔔 미해결 알림 ({alerts.length})</h2>
          <ul className="space-y-2">
            {alerts.slice(0, 5).map(a => (
              <li key={a.id} className="flex items-start gap-2 bg-white rounded p-2.5 border border-amber-200">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0 ${
                  a.severity === 'critical' ? 'bg-rose-100 text-rose-700'
                  : a.severity === 'warning' ? 'bg-amber-100 text-amber-700'
                  : 'bg-slate-100 text-slate-700'
                }`}>{a.category}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-900 leading-snug">{a.title}</p>
                  {a.message && <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">{a.message}</p>}
                  <p className="text-[10px] text-slate-400 mt-0.5">{new Date(a.created_at).toLocaleString('ko-KR')}</p>
                </div>
                <button onClick={() => ackAlert(a.id)} className="text-[11px] text-violet-600 hover:underline flex-shrink-0">✓ 확인</button>
              </li>
            ))}
            {alerts.length > 5 && <li className="text-[11px] text-slate-500 text-center">+{alerts.length - 5}개 더</li>}
          </ul>
        </section>
      )}

      {/* 학습 샘플 진행도 */}
      {summary && (
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">LTR 학습 샘플 진행</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <KpiCard label="총 노출" value={summary.total_exposures.toLocaleString()} />
            <KpiCard label="총 예약" value={summary.total_bookings.toLocaleString()} />
            <KpiCard label="예약 전환율" value={`${summary.overall_booking_rate_pct.toFixed(2)}%`} />
            <KpiCard
              label="LTR 학습 가능"
              value={summary.ltr_ready ? '✓ Ready' : `${summary.ltr_training_samples} / 1000`}
              tone={summary.ltr_ready ? 'good' : 'pending'}
            />
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-400 to-emerald-500 transition-all"
              style={{ width: `${Math.min(100, (summary.ltr_training_samples / 1000) * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            {summary.ltr_ready
              ? '1000건 누적 — LightFM/listwise rerank 학습 권장'
              : `${1000 - summary.ltr_training_samples}건 더 필요 (자비스·카드·뱃지 노출 자동 누적)`}
          </p>
        </section>
      )}

      {/* 필터 */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-slate-700">필터:</span>
        <select
          value={filterSource}
          onChange={e => setFilterSource(e.target.value)}
          className="text-xs border border-slate-300 rounded px-2 py-1"
        >
          <option value="">모든 source</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={filterIntent}
          onChange={e => setFilterIntent(e.target.value)}
          className="text-xs border border-slate-300 rounded px-2 py-1"
        >
          <option value="">모든 intent</option>
          {intents.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
        <span className="text-xs text-slate-400 ml-auto">
          필터링: {filtered.length}행 · 노출 {totalExposures} · 클릭 {totalClicks} · 예약 {totalBookings}
        </span>
      </section>

      {/* funnel 테이블 */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-slate-600">
              <th className="text-left px-3 py-2">source</th>
              <th className="text-left px-3 py-2">intent</th>
              <th className="text-center px-3 py-2">rank</th>
              <th className="text-right px-3 py-2">노출</th>
              <th className="text-right px-3 py-2">클릭</th>
              <th className="text-right px-3 py-2">문의</th>
              <th className="text-right px-3 py-2">예약</th>
              <th className="text-right px-3 py-2">예약 전환율</th>
              <th className="text-right px-3 py-2">예약 매출</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-8 text-slate-400">로딩중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-8 text-slate-400">
                아직 데이터 없음. 자비스/모바일 카드/리스트 뱃지가 추천 노출하면 자동 누적됩니다.
              </td></tr>
            ) : filtered.map((r, i) => (
              <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50">
                <td className="px-3 py-2 font-medium">{r.source}</td>
                <td className="px-3 py-2 text-slate-600">{r.intent}</td>
                <td className="px-3 py-2 text-center">{r.recommended_rank || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.exposures.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.clicks.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.inquiries.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.bookings.toLocaleString()}</td>
                <td className={`px-3 py-2 text-right font-semibold ${
                  (r.booking_rate_pct ?? 0) >= 5 ? 'text-emerald-700'
                    : (r.booking_rate_pct ?? 0) >= 1 ? 'text-amber-700'
                    : 'text-slate-400'
                }`}>
                  {r.booking_rate_pct != null ? `${r.booking_rate_pct.toFixed(2)}%` : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                  {r.booking_value_sum ? `₩${(r.booking_value_sum / 10000).toFixed(0)}만` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 정책 A/B 비교 결과 (최근 10건) */}
      {abResults.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-800">정책 A/B 비교 결과</h2>
            <p className="text-xs text-slate-500 mt-0.5">매주 토요일 자동 측정 · 통계적 winner 판정 시 ✓ 표시</p>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr className="text-slate-600">
                <th className="text-left px-3 py-2">측정일</th>
                <th className="text-left px-3 py-2">A (active)</th>
                <th className="text-left px-3 py-2">B (challenger)</th>
                <th className="text-right px-3 py-2">예약율 A / B</th>
                <th className="text-center px-3 py-2">winner</th>
                <th className="text-right px-3 py-2">신뢰도</th>
              </tr>
            </thead>
            <tbody>
              {abResults.map(ab => {
                const winA = ab.winner && ab.policy_a_version && ab.winner === ab.policy_a_version;
                return (
                  <tr key={ab.id} className="border-b border-slate-100">
                    <td className="px-3 py-2 text-slate-500">{new Date(ab.measured_at).toLocaleDateString('ko-KR')}</td>
                    <td className="px-3 py-2 font-medium">{ab.policy_a_version}</td>
                    <td className="px-3 py-2 text-slate-600">{ab.policy_b_version}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {(Number(ab.booking_rate_a) * 100).toFixed(2)}% / {(Number(ab.booking_rate_b) * 100).toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-center">
                      {ab.winner ? (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${winA ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          ✓ {winA ? 'A' : 'B'}
                        </span>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {ab.confidence ? `${(Number(ab.confidence) * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <p className="text-[10px] text-slate-400">
        ※ v_recommendation_funnel + v_ltr_signals 기반 · 매주 월요일 09:00 UTC 자동 리포트 (
        <code className="bg-slate-100 px-1 rounded">/api/cron/ltr-funnel-report</code>
        ) · 매주 토요일 10:00 UTC 정책 A/B 비교 (
        <code className="bg-slate-100 px-1 rounded">/api/cron/policy-ab-compare</code>
        )
      </p>
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'pending' }) {
  const cls = tone === 'good' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
    : tone === 'pending' ? 'bg-amber-50 text-amber-800 border-amber-200'
    : 'bg-slate-50 text-slate-800 border-slate-200';
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-lg font-extrabold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
