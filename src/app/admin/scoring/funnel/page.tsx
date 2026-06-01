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

interface FeedbackRow {
  id: number;
  package_id: string;
  package_title: string | null;
  destination: string | null;
  source: string;
  intent: string | null;
  recommended_rank: number | null;
  outcome: string | null;
  notes: string | null;
  recommended_at: string;
  has_feedback: boolean;
}

interface FeedbackSummary {
  total: number;
  feedbackRows: number;
  selectedRows: number;
  rejectedRows: number;
  hotelCheckRows: number;
}

export default function ScoringFunnelPage() {
  const [funnel, setFunnel] = useState<FunnelRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [abResults, setAbResults] = useState<AbResult[]>([]);
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [feedbackRows, setFeedbackRows] = useState<FeedbackRow[]>([]);
  const [feedbackSummary, setFeedbackSummary] = useState<FeedbackSummary | null>(null);
  const [feedbackSavingId, setFeedbackSavingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterSource, setFilterSource] = useState<string>('');
  const [filterIntent, setFilterIntent] = useState<string>('');

  useEffect(() => {
    let aborted = false;
    setLoading(true);
    Promise.all([
      fetch('/api/admin/scoring/funnel').then(r => r.json()),
      fetch('/api/admin/scoring/feedback').then(r => r.json()).catch(() => null),
    ])
      .then(([d, feedback]) => {
        if (aborted) return;
        setFunnel(d.funnel ?? []);
        setSummary(d.summary ?? null);
        setAbResults(d.ab_results ?? []);
        setAlerts(d.alerts ?? []);
        setFeedbackRows(feedback?.rows ?? []);
        setFeedbackSummary(feedback?.summary ?? null);
      })
      .catch(() => {})
      .finally(() => !aborted && setLoading(false));
    return () => { aborted = true; };
  }, []);

  const ackAlert = async (id: number) => {
    await fetch(`/api/admin/alerts/${id}/ack`, { method: 'POST' }).catch(() => {});
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  const saveFeedback = async (id: number, feedback: string) => {
    setFeedbackSavingId(id);
    try {
      const res = await fetch('/api/admin/scoring/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, feedback }),
      });
      if (!res.ok) throw new Error('feedback failed');
      const refreshed = await fetch('/api/admin/scoring/feedback').then(r => r.json());
      setFeedbackRows(refreshed.rows ?? []);
      setFeedbackSummary(refreshed.summary ?? null);
    } catch {
      // 피드백 저장 실패가 funnel 화면 자체를 막지 않게 둔다.
    } finally {
      setFeedbackSavingId(null);
    }
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
          <h1 className="text-xl font-extrabold text-admin-text">추천 깔때기 (LTR)</h1>
          <p className="text-xs text-admin-muted mt-0.5">
            모바일 카드 / 자비스 / 리스트 뱃지 → 클릭 → 예약 funnel · 정책 A/B 효과 검증
          </p>
        </div>
        <Link href="/admin/scoring" className="text-xs text-violet-600 hover:underline">← 정책 편집</Link>
      </div>

      {/* Admin Alerts (미해결 알림 박스) */}
      {alerts.length > 0 && (
        <section className="bg-amber-50 border border-amber-300 rounded-admin-md p-4">
          <h2 className="text-sm font-bold text-amber-900 mb-2">🔔 미해결 알림 ({alerts.length})</h2>
          <ul className="space-y-2">
            {alerts.slice(0, 5).map(a => (
              <li key={a.id} className="flex items-start gap-2 bg-white rounded p-2.5 border border-amber-200">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0 ${
                  a.severity === 'critical' ? 'bg-rose-100 text-rose-700'
                  : a.severity === 'warning' ? 'bg-amber-100 text-amber-700'
                  : 'bg-admin-surface-2 text-admin-text-2'
                }`}>{a.category}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-admin-text leading-snug">{a.title}</p>
                  {a.message && <p className="text-[11px] text-admin-muted mt-0.5 leading-snug">{a.message}</p>}
                  <p className="text-[10px] text-admin-muted-2 mt-0.5">{new Date(a.created_at).toLocaleString('ko-KR')}</p>
                </div>
                <button onClick={() => ackAlert(a.id)} className="text-[11px] text-violet-600 hover:underline flex-shrink-0">✓ 확인</button>
              </li>
            ))}
            {alerts.length > 5 && <li className="text-[11px] text-admin-muted text-center">+{alerts.length - 5}개 더</li>}
          </ul>
        </section>
      )}

      {/* 학습 샘플 진행도 */}
      {summary && (
        <section className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5">
          <h2 className="text-sm font-semibold text-admin-text-2 mb-3">LTR 학습 샘플 진행</h2>
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
          <div className="h-2 bg-admin-surface-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-400 to-emerald-500 transition-all"
              style={{ width: `${Math.min(100, (summary.ltr_training_samples / 1000) * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-admin-muted mt-2">
            {summary.ltr_ready
              ? '1000건 누적 — LightFM/listwise rerank 학습 권장'
              : `${1000 - summary.ltr_training_samples}건 더 필요 (자비스·카드·뱃지 노출 자동 누적)`}
          </p>
        </section>
      )}

      {/* 필터 */}
      <section className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-5 space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-admin-text-2">상담 피드백 루프</h2>
            <p className="text-xs text-admin-muted mt-0.5">
              상담원이 추천 결과를 선택/거절/호텔확인으로 표시해 LTR 학습용 신호를 남깁니다.
            </p>
          </div>
          {feedbackSummary && (
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-full bg-admin-bg px-2 py-1 font-semibold text-admin-text-2">최근 {feedbackSummary.total}건</span>
              <span className="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">선택 {feedbackSummary.selectedRows}</span>
              <span className="rounded-full bg-red-50 px-2 py-1 font-semibold text-red-700">거절 {feedbackSummary.rejectedRows}</span>
              <span className="rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-700">호텔확인 {feedbackSummary.hotelCheckRows}</span>
            </div>
          )}
        </div>

        {feedbackRows.length === 0 ? (
          <div className="rounded-admin-sm bg-admin-bg p-4 text-xs text-admin-muted">
            아직 추천 노출/클릭 데이터가 없습니다. 상품 카드나 자비스 추천이 노출되면 여기에 쌓입니다.
          </div>
        ) : (
          <div className="overflow-hidden rounded-admin-sm border border-admin-border">
            <table className="w-full text-xs">
              <thead className="bg-admin-bg text-admin-muted">
                <tr>
                  <th className="px-3 py-2 text-left">상품</th>
                  <th className="px-3 py-2 text-left">신호</th>
                  <th className="px-3 py-2 text-left">결과</th>
                  <th className="px-3 py-2 text-right">피드백</th>
                </tr>
              </thead>
              <tbody>
                {feedbackRows.slice(0, 12).map((row) => (
                  <tr key={row.id} className="border-t border-admin-border">
                    <td className="px-3 py-2">
                      <p className="font-semibold text-admin-text line-clamp-1">{row.package_title ?? row.package_id.slice(0, 8)}</p>
                      <p className="mt-0.5 text-[11px] text-admin-muted">{row.destination ?? '목적지 없음'} · {new Date(row.recommended_at).toLocaleString('ko-KR')}</p>
                    </td>
                    <td className="px-3 py-2 text-admin-muted">
                      {row.source} · {row.intent ?? 'intent 없음'} · rank {row.recommended_rank ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                        row.outcome === 'booking' || row.outcome === 'inquiry'
                          ? 'bg-emerald-50 text-emerald-700'
                          : row.outcome === 'cancelled'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-admin-bg text-admin-muted'
                      }`}>
                        {row.outcome ?? '미확정'}
                      </span>
                      {row.has_feedback && <span className="ml-1.5 text-[11px] font-semibold text-violet-700">피드백 있음</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          disabled={feedbackSavingId === row.id}
                          onClick={() => saveFeedback(row.id, 'customer_selected')}
                          className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 disabled:opacity-50"
                        >
                          선택
                        </button>
                        <button
                          type="button"
                          disabled={feedbackSavingId === row.id}
                          onClick={() => saveFeedback(row.id, 'customer_rejected')}
                          className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 disabled:opacity-50"
                        >
                          거절
                        </button>
                        <button
                          type="button"
                          disabled={feedbackSavingId === row.id}
                          onClick={() => saveFeedback(row.id, 'needs_hotel_check')}
                          className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 disabled:opacity-50"
                        >
                          호텔
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-4 flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-admin-text-2">필터:</span>
        <select
          value={filterSource}
          onChange={e => setFilterSource(e.target.value)}
          className="text-xs border border-admin-border-strong rounded px-2 py-1"
        >
          <option value="">모든 source</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={filterIntent}
          onChange={e => setFilterIntent(e.target.value)}
          className="text-xs border border-admin-border-strong rounded px-2 py-1"
        >
          <option value="">모든 intent</option>
          {intents.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
        <span className="text-xs text-admin-muted-2 ml-auto">
          필터링: {filtered.length}행 · 노출 {totalExposures} · 클릭 {totalClicks} · 예약 {totalBookings}
        </span>
      </section>

      {/* funnel 테이블 */}
      <section className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-admin-bg border-b border-admin-border-mid">
            <tr className="text-admin-muted">
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
              <tr><td colSpan={9} className="text-center py-8 text-admin-muted-2">로딩중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-8 text-admin-muted-2">
                아직 데이터 없음. 자비스/모바일 카드/리스트 뱃지가 추천 노출하면 자동 누적됩니다.
              </td></tr>
            ) : filtered.map((r, i) => (
              <tr key={i} className="border-b border-admin-border hover:bg-admin-bg/50">
                <td className="px-3 py-2 font-medium">{r.source}</td>
                <td className="px-3 py-2 text-admin-muted">{r.intent}</td>
                <td className="px-3 py-2 text-center">{r.recommended_rank || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.exposures.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.clicks.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.inquiries.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.bookings.toLocaleString()}</td>
                <td className={`px-3 py-2 text-right font-semibold ${
                  (r.booking_rate_pct ?? 0) >= 5 ? 'text-emerald-700'
                    : (r.booking_rate_pct ?? 0) >= 1 ? 'text-amber-700'
                    : 'text-admin-muted-2'
                }`}>
                  {r.booking_rate_pct != null ? `${r.booking_rate_pct.toFixed(2)}%` : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-admin-text-2">
                  {r.booking_value_sum ? `₩${(r.booking_value_sum / 10000).toFixed(0)}만` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 정책 A/B 비교 결과 (최근 10건) */}
      {abResults.length > 0 && (
        <section className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
          <div className="px-5 py-3 border-b border-admin-border">
            <h2 className="text-sm font-semibold text-admin-text-2">정책 A/B 비교 결과</h2>
            <p className="text-xs text-admin-muted mt-0.5">매주 토요일 자동 측정 · 통계적 winner 판정 시 ✓ 표시</p>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-admin-bg">
              <tr className="text-admin-muted">
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
                  <tr key={ab.id} className="border-b border-admin-border">
                    <td className="px-3 py-2 text-admin-muted">{new Date(ab.measured_at).toLocaleDateString('ko-KR')}</td>
                    <td className="px-3 py-2 font-medium">{ab.policy_a_version}</td>
                    <td className="px-3 py-2 text-admin-muted">{ab.policy_b_version}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {(Number(ab.booking_rate_a) * 100).toFixed(2)}% / {(Number(ab.booking_rate_b) * 100).toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-center">
                      {ab.winner ? (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${winA ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          ✓ {winA ? 'A' : 'B'}
                        </span>
                      ) : <span className="text-admin-muted-2">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-admin-muted">
                      {ab.confidence ? `${(Number(ab.confidence) * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <p className="text-[10px] text-admin-muted-2">
        ※ v_recommendation_funnel + v_ltr_signals 기반 · 매주 월요일 09:00 UTC 자동 리포트 (
        <code className="bg-admin-surface-2 px-1 rounded">/api/cron/ltr-funnel-report</code>
        ) · 매주 토요일 10:00 UTC 정책 A/B 비교 (
        <code className="bg-admin-surface-2 px-1 rounded">/api/cron/policy-ab-compare</code>
        )
      </p>
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'pending' }) {
  const cls = tone === 'good' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
    : tone === 'pending' ? 'bg-amber-50 text-amber-800 border-amber-200'
    : 'bg-admin-bg text-admin-text-2 border-admin-border-mid';
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-lg font-extrabold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
