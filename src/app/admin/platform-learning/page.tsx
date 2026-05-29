'use client';

import { useEffect, useState, useCallback } from 'react';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { fmtDateTime, fmtNum } from '@/lib/admin-utils';
import { RefreshCw, CheckCircle, AlertTriangle, XCircle, Database, TrendingUp, Activity, BarChart3, ThumbsUp, ThumbsDown } from 'lucide-react';

type Row = {
  id: string;
  created_at: string;
  source: string;
  session_id: string | null;
  tenant_id: string | null;
  affiliate_id: string | null;
  message_sha256: string | null;
  message_redacted: string | null;
  payload: Record<string, unknown>;
  consent_flags: Record<string, unknown>;
};

type CorrectionRow = {
  id: string;
  created_at: string;
  source: string;
  pattern: string;
  severity: string;
  is_active: boolean;
  applied_count: number;
  scope_tenant_id: string | null;
};

type MetricRow = {
  severity: string;
  cnt: number;
};

type Summary = {
  totalEvents: number;
  totalCorrections: number;
  activeCorrections: number;
  recentCritiques: number;
  blockCritiques: number;
  warnCritiques: number;
  passCritiques: number;
  hitlCount: number;
  topErrors: { severity: string; cnt: number }[];
  corrections: CorrectionRow[];
};

interface FeedbackStats {
  totalUp: number;
  totalDown: number;
  totalFeedback: number;
  positiveRate: number;
  bySource: Array<{ source: string; up: number; down: number; total: number }>;
  byDay: Array<{ date: string; up: number; down: number; total: number }>;
  latest: Array<{
    id: string;
    created_at: string;
    rating: string;
    source: string;
    session_id: string | null;
    payload: Record<string, unknown> | null;
  }>;
}

export default function PlatformLearningPage() {
  const [events, setEvents] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [tab, setTab] = useState<'events' | 'corrections' | 'critique' | 'feedback'>('events');
  const [feedbackStats, setFeedbackStats] = useState<FeedbackStats | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const limit = 40;

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await fetch('/api/admin/platform-learning/summary');
      const json = await res.json();
      if (res.ok) setSummary(json);
    } catch {
      // silent
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (source) q.set('source', source);
      const res = await fetch(`/api/admin/platform-learning?${q}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '로드 실패');
      setEvents(json.events ?? []);
      setTotal(json.total ?? 0);
      setNotice(json.notice ?? null);
    } catch {
      setEvents([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [offset, source]);

  const loadFeedbackStats = useCallback(async () => {
    setFeedbackLoading(true);
    try {
      const res = await fetch('/api/admin/platform-learning?stats=true');
      const json = await res.json();
      if (res.ok) setFeedbackStats(json.stats ?? null);
    } catch {
      setFeedbackStats(null);
    } finally {
      setFeedbackLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab === 'feedback') {
      void loadFeedbackStats();
    }
  }, [tab, loadFeedbackStats]);

  const toggleCorrection = async (id: string, active: boolean) => {
    await fetch(`/api/admin/platform-learning/corrections/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: active }),
    });
    void loadSummary();
  };

  // ── 요약 카드 ──
  const SummaryCard = ({ label, value, icon, color }: { label: string; value: string | number; icon: React.ReactNode; color: string }) => (
    <div className="bg-white rounded-admin-md border border-admin-border p-4 flex items-center gap-3 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <div className={`rounded-full p-2 ${color}`}>{icon}</div>
      <div>
        <p className="text-admin-xs text-admin-muted">{label}</p>
        <p className="text-admin-lg font-bold text-admin-text">{typeof value === 'number' ? fmtNum(value) : value}</p>
      </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="AI 학습 플라이휠"
        subtitle={
          <>QA 채팅·자비스 턴마다 적재되는 학습 신호와 자동 교정 패턴을 모니터링합니다.</>
        }
      />
      {notice && (
        <p className="text-status-warningFg text-admin-sm mb-4 bg-status-warningBg border border-warning/20 rounded-admin-sm px-3 py-2">{notice}</p>
      )}

      {/* ── 요약 카드 ── */}
      {summaryLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-admin-md border border-admin-border p-4 h-20 animate-pulse" />
          ))}
        </div>
      ) : summary ? (
        <div className="space-y-4 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="전체 이벤트" value={summary.totalEvents} icon={<Database size={18} />} color="bg-blue-100 text-blue-600" />
            <SummaryCard label="HITL 건수" value={summary.hitlCount} icon={<Activity size={18} />} color="bg-yellow-100 text-yellow-600" />
            <SummaryCard label="활성 교정 패턴" value={summary.activeCorrections} icon={<CheckCircle size={18} />} color="bg-green-100 text-green-600" />
            <SummaryCard label="최근 7일 Critique" value={summary.recentCritiques} icon={<BarChart3 size={18} />} color="bg-purple-100 text-purple-600" />
          </div>

          {/* critique 심각도 분포 */}
          <div className="flex gap-3 text-admin-xs">
            {summary.topErrors.map((e) => (
              <span
                key={e.severity}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium ${
                  e.severity === 'pass' ? 'bg-green-100 text-green-700' :
                  e.severity === 'warn' ? 'bg-yellow-100 text-yellow-700' :
                  e.severity === 'block' ? 'bg-red-100 text-red-700' :
                  'bg-admin-surface-2 text-admin-muted'
                }`}
              >
                {e.severity === 'block' ? <XCircle size={12} /> : e.severity === 'warn' ? <AlertTriangle size={12} /> : <CheckCircle size={12} />}
                {e.severity}: {fmtNum(e.cnt)}건
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── 탭 ── */}
      <div className="flex gap-1 mb-4 border-b border-admin-border-mid">
        {([
          { id: 'events', label: '이벤트 로그' },
          { id: 'corrections', label: '교정 패턴' },
          { id: 'critique', label: 'Critique 현황' },
          { id: 'feedback', label: '고객 피드백' },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-admin-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t.id
                ? 'border-brand text-brand'
                : 'border-transparent text-admin-muted hover:text-admin-text hover:border-admin-border'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── 탭: 이벤트 로그 ── */}
      {tab === 'events' && (
        <>
          <div className="flex flex-wrap gap-3 items-center mb-4">
            <select
              value={source}
              onChange={(e) => { setOffset(0); setSource(e.target.value); }}
              className="h-9 border border-admin-border-mid rounded-admin-sm px-2.5 text-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
            >
              <option value="">전체 소스</option>
              <option value="qa_chat">qa_chat</option>
              <option value="qa_escalation_cta">qa_escalation_cta</option>
              <option value="jarvis_v1">jarvis_v1</option>
              <option value="jarvis_v2_stream">jarvis_v2_stream</option>
            </select>
            <span className="text-admin-sm text-admin-muted">총 <b className="admin-num text-admin-text">{fmtNum(total)}</b>건</span>
            <Button variant="secondary" size="sm" onClick={() => load()}>
              <RefreshCw size={14} />
              새로고침
            </Button>
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white rounded-admin-md border border-admin-border shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-3 flex items-center gap-3">
                  <div className="h-3.5 bg-admin-surface-2 rounded animate-pulse flex-1" />
                  <div className="h-4 bg-admin-surface-2 rounded-full animate-pulse w-20" />
                </div>
              ))}
            </div>
          ) : events.length === 0 ? (
            <p className="text-admin-muted text-admin-sm py-8 text-center">데이터가 없거나 테이블이 아직 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {events.map((ev) => (
                <div key={ev.id} className="admin-card p-4 text-admin-sm">
                  <div className="flex flex-wrap gap-2 text-admin-xs text-admin-muted mb-2">
                    <span className="font-mono text-admin-text-2 font-semibold">{ev.source}</span>
                    <span>{fmtDateTime(ev.created_at)}</span>
                    {ev.tenant_id && <span className="font-mono">tenant: {ev.tenant_id.slice(0, 8)}…</span>}
                    {ev.affiliate_id && <span className="font-mono">affiliate: {ev.affiliate_id.slice(0, 8)}…</span>}
                    {ev.message_sha256 && (
                      <span className="truncate max-w-[200px] font-mono" title={ev.message_sha256}>
                        sha256: {ev.message_sha256.slice(0, 12)}…
                      </span>
                    )}
                  </div>
                  {ev.message_redacted && (
                    <p className="text-admin-text-2 text-admin-xs mb-2 whitespace-pre-wrap border-l-2 border-brand-light pl-2">
                      {ev.message_redacted}
                    </p>
                  )}
                  <pre className="text-[11px] bg-admin-surface-2 rounded-admin-sm p-2 overflow-x-auto text-admin-text-2 font-mono">
                    {JSON.stringify(ev.payload, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            {total > offset + limit && (
              <Button variant="ghost" size="sm" onClick={() => setOffset((o) => o + limit)}>
                더 보기 (다음 {limit}건)
              </Button>
            )}
            {offset > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setOffset((o) => Math.max(0, o - limit))}>
                이전 페이지
              </Button>
            )}
          </div>
        </>
      )}

      {/* ── 탭: 교정 패턴 ── */}
      {tab === 'corrections' && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-admin-sm text-admin-muted">
              전체 <b className="admin-num text-admin-text">{fmtNum(summary?.totalCorrections ?? 0)}</b>개 패턴
              (활성 <b className="admin-num text-admin-text">{fmtNum(summary?.activeCorrections ?? 0)}</b>개)
            </span>
            <Button variant="secondary" size="sm" onClick={() => loadSummary()}>
              <RefreshCw size={14} />
            </Button>
          </div>

          {summary?.corrections && summary.corrections.length > 0 ? (
            <div className="space-y-2">
              {summary.corrections.map((c) => (
                <div key={c.id} className="admin-card p-4 text-admin-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-admin-xs font-medium px-1.5 py-0.5 rounded-full ${
                          c.severity === 'block' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {c.severity}
                        </span>
                        <span className={`text-admin-xs font-medium px-1.5 py-0.5 rounded-full ${
                          c.is_active ? 'bg-green-100 text-green-700' : 'bg-admin-surface-2 text-admin-muted'
                        }`}>
                          {c.is_active ? '활성' : '비활성'}
                        </span>
                        <span className="font-mono text-admin-xs text-admin-muted">{c.source}</span>
                        <span className="text-admin-xs text-admin-muted">
                          적용 {fmtNum(c.applied_count)}회
                        </span>
                        {c.scope_tenant_id && (
                          <span className="font-mono text-admin-xs text-admin-muted">tenant: {c.scope_tenant_id.slice(0, 8)}…</span>
                        )}
                      </div>
                      <p className="text-admin-text font-medium">{c.pattern}</p>
                      <p className="text-admin-xs text-admin-muted mt-1">{fmtDateTime(c.created_at)}</p>
                    </div>
                    <button
                      onClick={() => toggleCorrection(c.id, !c.is_active)}
                      className={`text-admin-xs px-3 py-1 rounded-full border transition-colors shrink-0 ${
                        c.is_active
                          ? 'border-red-200 text-red-600 hover:bg-red-50'
                          : 'border-green-200 text-green-600 hover:bg-green-50'
                      }`}
                    >
                      {c.is_active ? '비활성화' : '활성화'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-admin-muted text-admin-sm py-8 text-center">등록된 교정 패턴이 없습니다.</p>
          )}
        </div>
      )}

      {/* ── 탭: Critique 현황 ── */}
      {tab === 'critique' && (
        <div>
          <p className="text-admin-sm text-admin-muted mb-4">
            AI 응답 품질 검증(critique) 분포. <b>block</b>은 사용자 노출 전 차단, <b>warn</b>은 플래그만 남기고 노출, <b>pass</b>는 정상 통과를 의미합니다.
          </p>
          {summary ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="admin-card p-5 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 text-green-600 mb-2">
                  <CheckCircle size={24} />
                </div>
                <p className="text-admin-2xl font-bold text-green-700">{fmtNum(summary.passCritiques)}</p>
                <p className="text-admin-xs text-admin-muted">Pass (정상)</p>
              </div>
              <div className="admin-card p-5 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-yellow-100 text-yellow-600 mb-2">
                  <AlertTriangle size={24} />
                </div>
                <p className="text-admin-2xl font-bold text-yellow-700">{fmtNum(summary.warnCritiques)}</p>
                <p className="text-admin-xs text-admin-muted">Warn (플래그)</p>
              </div>
              <div className="admin-card p-5 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 text-red-600 mb-2">
                  <XCircle size={24} />
                </div>
                <p className="text-admin-2xl font-bold text-red-700">{fmtNum(summary.blockCritiques)}</p>
                <p className="text-admin-xs text-admin-muted">Block (차단)</p>
              </div>
            </div>
          ) : (
            <p className="text-admin-muted text-admin-sm py-8 text-center">데이터를 불러올 수 없습니다.</p>
          )}
        </div>
      )}

      {/* ── 탭: 고객 피드백 ── */}
      {tab === 'feedback' && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-admin-sm text-admin-muted">ChatWidget 👍/👎 피드백 집계</span>
            <Button variant="secondary" size="sm" onClick={() => loadFeedbackStats()}>
              <RefreshCw size={14} />
            </Button>
          </div>

          {feedbackLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-white rounded-admin-md border border-admin-border p-6 h-28 animate-pulse" />
              ))}
            </div>
          ) : feedbackStats && feedbackStats.totalFeedback > 0 ? (
            <>
              {/* 긍정률 게이지 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="admin-card p-5 text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 text-green-600 mb-2">
                    <ThumbsUp size={24} />
                  </div>
                  <p className="text-admin-2xl font-bold text-green-700">{fmtNum(feedbackStats.totalUp)}</p>
                  <p className="text-admin-xs text-admin-muted">긍정 (👍)</p>
                </div>
                <div className="admin-card p-5 text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 text-red-600 mb-2">
                    <ThumbsDown size={24} />
                  </div>
                  <p className="text-admin-2xl font-bold text-red-700">{fmtNum(feedbackStats.totalDown)}</p>
                  <p className="text-admin-xs text-admin-muted">부정 (👎)</p>
                </div>
                <div className="admin-card p-5 text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 text-blue-600 mb-2">
                    <TrendingUp size={24} />
                  </div>
                  <p className="text-admin-2xl font-bold text-blue-700">
                    {(feedbackStats.positiveRate * 100).toFixed(1)}%
                  </p>
                  <p className="text-admin-xs text-admin-muted">긍정률 ({fmtNum(feedbackStats.totalFeedback)}건)</p>
                </div>
              </div>

              {/* 소스별 분포 */}
              <div className="admin-card p-4 mb-4">
                <h3 className="text-admin-sm font-bold text-admin-text mb-3">유입 경로(leadSource)별 분포</h3>
                <div className="space-y-2">
                  {feedbackStats.bySource.map((s) => (
                    <div key={s.source} className="flex items-center gap-3">
                      <span className="w-28 text-admin-xs text-admin-text-2 font-medium truncate">{s.source}</span>
                      <div className="flex-1 h-5 bg-admin-surface-2 rounded-full overflow-hidden flex">
                        {s.total > 0 && (
                          <>
                            <div
                              className="h-full bg-green-400 transition-all"
                              style={{ width: `${(s.up / s.total) * 100}%` }}
                              title={`👍 ${s.up}건`}
                            />
                            <div
                              className="h-full bg-red-400 transition-all"
                              style={{ width: `${(s.down / s.total) * 100}%` }}
                              title={`👎 ${s.down}건`}
                            />
                          </>
                        )}
                      </div>
                      <span className="text-admin-xs text-admin-muted w-16 text-right tabular-nums">
                        {fmtNum(s.total)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 일별 추이 */}
              <div className="admin-card p-4 mb-4">
                <h3 className="text-admin-sm font-bold text-admin-text mb-3">일별 피드백 추이 (최근 30일)</h3>
                <div className="space-y-1">
                  {feedbackStats.byDay.slice(-14).map((d) => {
                    const maxTotal = Math.max(...feedbackStats.byDay.map((x) => x.total), 1);
                    const barWidth = (d.total / maxTotal) * 100;
                    return (
                      <div key={d.date} className="flex items-center gap-2">
                        <span className="w-20 text-[11px] text-admin-muted tabular-nums">{d.date?.slice(5)}</span>
                        <div className="flex-1 h-4 bg-admin-surface-2 rounded-full overflow-hidden flex">
                          {d.total > 0 && (
                            <>
                              <div
                                className="h-full bg-green-400 transition-all"
                                style={{ width: `${(d.up / d.total) * barWidth}%` }}
                              />
                              <div
                                className="h-full bg-red-400 transition-all"
                                style={{ width: `${(d.down / d.total) * barWidth}%` }}
                              />
                            </>
                          )}
                        </div>
                        <span className="text-[11px] text-admin-muted w-12 text-right tabular-nums">{fmtNum(d.total)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 최근 피드백 목록 */}
              <div className="admin-card p-4">
                <h3 className="text-admin-sm font-bold text-admin-text mb-3">최근 피드백</h3>
                <div className="space-y-2">
                  {feedbackStats.latest.length === 0 ? (
                    <p className="text-admin-muted text-admin-xs">피드백 데이터가 없습니다.</p>
                  ) : (
                    feedbackStats.latest.map((f) => (
                      <div key={f.id} className="flex items-start gap-3 p-2 rounded-admin-sm hover:bg-admin-surface-2 transition-colors">
                        <span className={`mt-0.5 ${f.rating === 'up' ? 'text-green-500' : 'text-red-500'}`}>
                          {f.rating === 'up' ? '👍' : '👎'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-admin-xs">
                            <span className="font-semibold text-admin-text">{f.rating === 'up' ? '긍정' : '부정'}</span>
                            <span className="text-admin-muted">{fmtDateTime(f.created_at)}</span>
                            <span className="text-admin-muted font-mono">
                              {(f.payload as Record<string, unknown>)?.leadSource as string || '-'}
                            </span>
                          </div>
                          {f.session_id && (
                            <p className="text-[10px] text-admin-muted font-mono truncate mt-0.5">
                              session: {f.session_id}
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="admin-card p-8 text-center">
              <ThumbsUp size={32} className="mx-auto text-admin-muted mb-2" />
              <p className="text-admin-sm text-admin-muted">
                {feedbackStats ? '아직 수집된 피드백이 없습니다. ChatWidget에서 고객이 응답하면 여기에 표시됩니다.' : '데이터를 불러올 수 없습니다.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
