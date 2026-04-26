'use client';

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';

const BarChart = dynamic(() => import('recharts').then(m => ({ default: m.BarChart })), { ssr: false });
const Bar = dynamic(() => import('recharts').then(m => ({ default: m.Bar })), { ssr: false });
const XAxis = dynamic(() => import('recharts').then(m => ({ default: m.XAxis })), { ssr: false });
const YAxis = dynamic(() => import('recharts').then(m => ({ default: m.YAxis })), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then(m => ({ default: m.Tooltip })), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then(m => ({ default: m.ResponsiveContainer })), { ssr: false });
const Cell = dynamic(() => import('recharts').then(m => ({ default: m.Cell })), { ssr: false });

// ── 타입 ─────────────────────────────────────────────────
interface AdPayload {
  creativeId: string;
  campaignName: string;
  images: string[];
  headlineCopy: string;
  bodyCopy: string;
  targetAudience: string;
  dailyBudgetKrw: number;
}

interface CampaignInsight {
  id: string;
  name: string;
  creative_id: string;
  status: 'ACTIVE' | 'PAUSED' | 'DELETED';
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  conversions: number;
  spend: number;
  isDanger: boolean;
}

interface MetaAutoPublisherProps {
  onClose: () => void;
  creativeId?: string;
  campaignName?: string;
  slides?: { hook_copy?: string; main_text?: string }[];
}

// ── Kill Switch 조건 ─────────────────────────────────────
function isDangerCampaign(c: CampaignInsight): boolean {
  return c.status === 'ACTIVE' && c.ctr < 1 && c.spend > 50000;
}

// ══════════════════════════════════════════════════════════
export default function MetaAutoPublisher({ onClose, creativeId, campaignName, slides }: MetaAutoPublisherProps) {
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignInsight[]>([]);
  const [killing, setKilling] = useState<string | null>(null);
  const [autoKill, setAutoKill] = useState(false);
  const [budget, setBudget] = useState(50000);

  // ── Auto-Publishing ────────────────────────────────────
  const publishToMeta = useCallback(async () => {
    setPublishing(true);
    setPublishResult(null);

    const payload: AdPayload = {
      creativeId: creativeId || `YSN-GEN-${Date.now().toString(36).toUpperCase()}`,
      campaignName: campaignName || '여소남 카드뉴스 캠페인',
      images: [],
      headlineCopy: slides?.[0]?.hook_copy || '여소남 특가 여행',
      bodyCopy: slides?.[0]?.main_text || '지금 확인하세요',
      targetAudience: '25-55, 한국, 여행 관심',
      dailyBudgetKrw: budget,
    };

    try {
      const res = await fetch('/api/meta/creatives/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creative_id: payload.creativeId,
          campaign_name: payload.campaignName,
          headline: payload.headlineCopy,
          body_copy: payload.bodyCopy,
          daily_budget_krw: payload.dailyBudgetKrw,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setPublishResult({
          ok: true,
          msg: data.meta_ad_id
            ? `캠페인 라이브! Ad ID: ${data.meta_ad_id}`
            : `CONFIRMED 상태로 저장됨 (Meta API 키 미설정 시 시뮬레이션)`,
        });
      } else {
        setPublishResult({ ok: false, msg: data.error || '배포 실패' });
      }
    } catch (err) {
      setPublishResult({ ok: false, msg: err instanceof Error ? err.message : '네트워크 오류' });
    } finally {
      setPublishing(false);
    }
  }, [creativeId, campaignName, slides, budget]);

  // ── Live Insights Sync ─────────────────────────────────
  const fetchLiveInsights = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/meta/performance');
      if (res.ok) {
        const data = await res.json();
        const mapped: CampaignInsight[] = (data.campaigns || data.snapshots || []).map((c: Record<string, unknown>) => {
          const impressions = Number(c.impressions || 0);
          const clicks = Number(c.clicks || 0);
          const spend = Number(c.spend_krw || c.spend || 0);
          const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
          const cpc = clicks > 0 ? spend / clicks : 0;

          const insight: CampaignInsight = {
            id: String(c.campaign_id || c.id || ''),
            name: String(c.campaign_name || c.name || ''),
            creative_id: String(c.creative_id || ''),
            status: (String(c.status || 'ACTIVE').toUpperCase() as CampaignInsight['status']),
            impressions,
            clicks,
            ctr: Math.round(ctr * 100) / 100,
            cpc: Math.round(cpc),
            conversions: Number(c.conversions || c.attributed_bookings || 0),
            spend,
            isDanger: false,
          };
          insight.isDanger = isDangerCampaign(insight);
          return insight;
        });

        setCampaigns(mapped);
        setLastSync(new Date().toLocaleTimeString('ko-KR'));

        // Auto Kill
        if (autoKill) {
          for (const c of mapped) {
            if (c.isDanger) {
              await killCampaign(c.id);
            }
          }
        }
      }
    } catch { /* 실패 무시 */ }
    finally { setSyncing(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/id-trigger-only intentional
  }, [autoKill]);

  // ── Kill Switch ────────────────────────────────────────
  const killCampaign = useCallback(async (campaignId: string) => {
    setKilling(campaignId);
    try {
      const res = await fetch(`/api/meta/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PAUSED' }),
      });
      if (res.ok) {
        setCampaigns(prev => prev.map(c =>
          c.id === campaignId ? { ...c, status: 'PAUSED', isDanger: false } : c
        ));
      }
    } catch { /* */ }
    finally { setKilling(null); }
  }, []);

  // 초기 로드
  useEffect(() => { fetchLiveInsights(); }, [fetchLiveInsights]);

  const dangerCampaigns = campaigns.filter(c => c.isDanger);
  const activeCampaigns = campaigns.filter(c => c.status === 'ACTIVE');
  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  const avgCtr = activeCampaigns.length > 0
    ? activeCampaigns.reduce((s, c) => s + c.ctr, 0) / activeCampaigns.length
    : 0;

  const chartData = campaigns
    .filter(c => c.status === 'ACTIVE')
    .sort((a, b) => b.ctr - a.ctr)
    .slice(0, 8)
    .map(c => ({ name: c.creative_id || c.name.slice(0, 12), ctr: c.ctr, isDanger: c.isDanger }));

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl bg-white shadow-xl border-l border-slate-200 h-full flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="bg-[#001f3f] text-white px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-[16px] font-semibold">Meta Ads 컨트롤 센터</h2>
            <p className="text-[11px] text-blue-200 mt-0.5">퍼블리싱 · 실시간 모니터링 · Kill Switch</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-white/60 hover:text-white transition">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ═══ 섹션 1: Auto-Publishing ═══ */}
          <section className="bg-white border border-slate-200 rounded-lg p-4">
            <h3 className="text-[14px] font-semibold text-slate-800 mb-3">광고 퍼블리싱</h3>

            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center gap-1 border border-slate-200 rounded px-2 py-1.5">
                <span className="text-[10px] text-slate-400">일예산</span>
                <input type="number" value={budget} onChange={e => setBudget(parseInt(e.target.value) || 50000)}
                  step={10000} min={10000} className="w-20 border-none text-[13px] text-right focus:ring-0 bg-transparent p-0" />
                <span className="text-[10px] text-slate-400">원</span>
              </div>
              {creativeId && (
                <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-2 py-1 rounded">{creativeId}</span>
              )}
            </div>

            <button
              onClick={publishToMeta}
              disabled={publishing}
              className="w-full py-3 bg-[#001f3f] text-white text-[14px] font-semibold rounded-lg hover:bg-blue-900 disabled:bg-slate-300 transition flex items-center justify-center gap-2"
            >
              {publishing ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> 배포 중...</>
              ) : (
                'Meta 광고 즉시 라이브'
              )}
            </button>

            {publishResult && (
              <div className={`mt-3 px-3 py-2 rounded text-[12px] ${
                publishResult.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'
              }`}>
                {publishResult.msg}
              </div>
            )}
          </section>

          {/* ═══ 섹션 2: Live Insights ═══ */}
          <section className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[14px] font-semibold text-slate-800">실시간 성과</h3>
              <div className="flex items-center gap-2">
                {lastSync && <span className="text-[10px] text-slate-400">최근: {lastSync}</span>}
                <button
                  onClick={fetchLiveInsights}
                  disabled={syncing}
                  className="px-3 py-1 bg-white border border-slate-300 text-slate-700 text-[11px] rounded hover:bg-slate-50 disabled:opacity-50 transition"
                >
                  {syncing ? '동기화 중...' : '동기화'}
                </button>
              </div>
            </div>

            {/* KPI */}
            {campaigns.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mb-4">
                <div className="bg-slate-50 rounded p-2">
                  <p className="text-[10px] text-slate-400">캠페인</p>
                  <p className="text-lg font-bold text-slate-800">{campaigns.length}</p>
                </div>
                <div className="bg-slate-50 rounded p-2">
                  <p className="text-[10px] text-slate-400">평균 CTR</p>
                  <p className={`text-lg font-bold ${avgCtr >= 3 ? 'text-emerald-600' : avgCtr < 1 ? 'text-red-600' : 'text-slate-800'}`}>{avgCtr.toFixed(1)}%</p>
                </div>
                <div className="bg-slate-50 rounded p-2">
                  <p className="text-[10px] text-slate-400">총 지출</p>
                  <p className="text-lg font-bold text-slate-800">₩{(totalSpend / 10000).toFixed(0)}만</p>
                </div>
                <div className="bg-slate-50 rounded p-2">
                  <p className="text-[10px] text-slate-400">위험</p>
                  <p className={`text-lg font-bold ${dangerCampaigns.length > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{dangerCampaigns.length}</p>
                </div>
              </div>
            )}

            {/* 차트 */}
            {chartData.length > 0 && (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `${v}%`} />
                  <Tooltip formatter={(v: unknown) => [`${v}%`, 'CTR'] as [string, string]} />
                  <Bar dataKey="ctr" radius={[3, 3, 0, 0]}>
                    {chartData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.isDanger ? '#dc2626' : entry.ctr >= 3 ? '#059669' : '#94a3b8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}

            {campaigns.length === 0 && !syncing && (
              <p className="text-center text-slate-400 text-[12px] py-4">캠페인 데이터가 없습니다. 동기화를 실행하세요.</p>
            )}
          </section>

          {/* ═══ 섹션 3: Kill Switch ═══ */}
          <section className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[14px] font-semibold text-slate-800">Kill Switch</h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-[11px] text-slate-500">자동 Kill</span>
                <button
                  onClick={() => setAutoKill(!autoKill)}
                  className={`w-9 h-5 rounded-full transition relative ${autoKill ? 'bg-red-500' : 'bg-slate-300'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all ${autoKill ? 'left-4' : 'left-0.5'}`} />
                </button>
              </label>
            </div>

            <p className="text-[11px] text-slate-400 mb-3">CTR 1% 미만 + 지출 5만원 초과 캠페인 자동 감지</p>

            {/* 위험 캠페인 경고 */}
            {dangerCampaigns.length > 0 ? (
              <div className="space-y-2">
                {dangerCampaigns.map(c => (
                  <div key={c.id} className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-semibold text-red-700">{c.name || c.creative_id}</p>
                      <div className="flex gap-3 mt-0.5 text-[11px] text-red-600">
                        <span>CTR {c.ctr}%</span>
                        <span>지출 ₩{c.spend.toLocaleString()}</span>
                        <span>전환 {c.conversions}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => killCampaign(c.id)}
                      disabled={killing === c.id}
                      className="px-3 py-1.5 bg-red-600 text-white text-[12px] font-medium rounded hover:bg-red-700 disabled:bg-red-300 transition"
                    >
                      {killing === c.id ? '중단 중...' : '즉시 중단'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                <p className="text-[12px] text-emerald-700">위험 캠페인 없음 — 모든 광고 정상 운영 중</p>
              </div>
            )}

            {/* 전체 캠페인 미니 테이블 */}
            {campaigns.length > 0 && (
              <div className="mt-4 max-h-[200px] overflow-y-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-[10px] font-semibold text-slate-500 py-1 px-2 text-left">캠페인</th>
                      <th className="text-[10px] font-semibold text-slate-500 py-1 px-2 text-center">상태</th>
                      <th className="text-[10px] font-semibold text-slate-500 py-1 px-2 text-center">CTR</th>
                      <th className="text-[10px] font-semibold text-slate-500 py-1 px-2 text-right">지출</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map(c => (
                      <tr key={c.id} className="border-b border-slate-100">
                        <td className="text-[11px] text-slate-700 py-1 px-2 truncate max-w-[200px]">{c.creative_id || c.name}</td>
                        <td className="text-[10px] py-1 px-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded ${
                            c.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' :
                            c.status === 'PAUSED' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
                          }`}>{c.status}</span>
                        </td>
                        <td className={`text-[11px] py-1 px-2 text-center font-medium ${c.ctr >= 3 ? 'text-emerald-600' : c.ctr < 1 ? 'text-red-600' : 'text-slate-700'}`}>{c.ctr}%</td>
                        <td className="text-[11px] text-slate-700 py-1 px-2 text-right">₩{c.spend.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
