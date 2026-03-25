'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import {
  extractKeywords, createSearchAdKeyword, optimizeBids,
  loadKeywords, saveKeywords, archivePerformance, getTopKeywords,
  type SearchAdKeyword, type Platform, type KeywordTier, type BidRecommendation,
} from '@/lib/keyword-brain';
import { fetchAllPerformance } from '@/lib/search-ads-api';

// ── 탭/필터 상수 ─────────────────────────────────────────
const TIER_LABELS: Record<KeywordTier, string> = { core: '핵심', mid: '중위', longtail: '세부', negative: '제외' };
const TIER_COLORS: Record<KeywordTier, string> = { core: 'bg-blue-50 text-blue-700', mid: 'bg-amber-50 text-amber-700', longtail: 'bg-emerald-50 text-emerald-700', negative: 'bg-red-50 text-red-600' };

interface Package { id: string; title: string; destination?: string; duration?: number; airline?: string; departure_airport?: string; product_type?: string; price?: number; inclusions?: string[]; price_tiers?: { adult_price?: number }[]; display_name?: string; }

export default function SearchAdsPage() {
  const [keywords, setKeywords] = useState<SearchAdKeyword[]>([]);
  const [platform, setPlatform] = useState<Platform>('naver');
  const [tierFilter, setTierFilter] = useState<KeywordTier | 'all'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingBid, setEditingBid] = useState<string | null>(null);
  const [editBidValue, setEditBidValue] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  // 패널
  const [extractorOpen, setExtractorOpen] = useState(false);
  const [optimizerOpen, setOptimizerOpen] = useState(false);
  const [packages, setPackages] = useState<Package[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<Package | null>(null);
  const [extractedPreview, setExtractedPreview] = useState<ReturnType<typeof extractKeywords>>([]);
  const [recommendations, setRecommendations] = useState<BidRecommendation[]>([]);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  // 로드
  useEffect(() => {
    setKeywords(loadKeywords());
    fetch('/api/packages?limit=200')
      .then(r => r.json())
      .then(d => setPackages((d.data ?? d.packages ?? []).filter((p: Package) => p.destination)));
  }, []);

  // 필터링
  const filtered = useMemo(() => {
    let result = keywords.filter(k => k.platform === platform);
    if (tierFilter !== 'all') result = result.filter(k => k.tier === tierFilter);
    return result;
  }, [keywords, platform, tierFilter]);

  // KPI
  const totalKeywords = filtered.length;
  const activeKeywords = filtered.filter(k => k.status === 'active' && k.tier !== 'negative').length;
  const totalSpend = filtered.reduce((s, k) => s + k.spend, 0);
  const avgCtr = activeKeywords > 0 ? filtered.filter(k => k.status === 'active').reduce((s, k) => s + k.ctr, 0) / activeKeywords : 0;

  // 차트 데이터
  const chartData = useMemo(() =>
    filtered
      .filter(k => k.status === 'active' && k.tier !== 'negative' && k.impressions > 0)
      .sort((a, b) => b.ctr - a.ctr)
      .slice(0, 10)
      .map(k => ({ name: k.keyword.length > 10 ? k.keyword.slice(0, 10) + '...' : k.keyword, ctr: k.ctr, spend: k.spend / 1000 })),
  [filtered]);

  // ── 성과 동기화 ────────────────────────────────────────
  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const perf = await fetchAllPerformance(keywords);
      const updated = keywords.map(k => {
        const p = perf.find(pp => pp.keywordId === k.id);
        if (!p) return k;
        // 아카이브에 누적
        if (k.tier !== 'negative') {
          const dest = packages.find(pkg => pkg.id === k.productId)?.destination || '';
          if (dest) archivePerformance(dest, k.keyword, { impressions: p.impressions, clicks: p.clicks, ctr: p.ctr, cpc: p.cpc, conversions: p.conversions, spend: p.spend, roas: 0 });
        }
        return { ...k, impressions: p.impressions, clicks: p.clicks, ctr: p.ctr, cpc: p.cpc, conversions: p.conversions, spend: p.spend };
      });
      setKeywords(updated);
      saveKeywords(updated);
      setLastSync(new Date().toLocaleTimeString('ko-KR'));
      showToast('성과 동기화 완료');
    } catch { showToast('동기화 실패'); }
    finally { setSyncing(false); }
  }, [keywords, packages]);

  // ── 키워드 추출 ────────────────────────────────────────
  const handleExtract = useCallback((pkg: Package) => {
    setSelectedPkg(pkg);
    const extracted = extractKeywords(pkg);
    setExtractedPreview(extracted);
  }, []);

  const handleAddExtracted = useCallback((selectedExtracted: ReturnType<typeof extractKeywords>) => {
    const newKws = selectedExtracted.map(e => createSearchAdKeyword(e, platform, selectedPkg?.id));
    const updated = [...keywords, ...newKws];
    setKeywords(updated);
    saveKeywords(updated);
    setExtractorOpen(false);
    showToast(`${newKws.length}개 키워드 등록`);
  }, [keywords, platform, selectedPkg]);

  // ── 입찰가 수정 ────────────────────────────────────────
  const handleBidSave = useCallback((kwId: string) => {
    const newBid = parseInt(editBidValue);
    if (isNaN(newBid) || newBid < 0) return;
    const updated = keywords.map(k => k.id === kwId ? { ...k, bid: newBid } : k);
    setKeywords(updated);
    saveKeywords(updated);
    setEditingBid(null);
  }, [keywords, editBidValue]);

  // ── 상태 토글 ──────────────────────────────────────────
  const toggleStatus = useCallback((kwId: string) => {
    const updated = keywords.map(k => k.id === kwId ? { ...k, status: k.status === 'active' ? 'paused' as const : 'active' as const } : k);
    setKeywords(updated);
    saveKeywords(updated);
  }, [keywords]);

  // ── 일괄 조작 ──────────────────────────────────────────
  const bulkAdjust = useCallback((pct: number) => {
    const updated = keywords.map(k => {
      if (!selectedIds.has(k.id)) return k;
      return { ...k, bid: Math.max(70, Math.round(k.bid * (1 + pct / 100))) };
    });
    setKeywords(updated);
    saveKeywords(updated);
    setSelectedIds(new Set());
    showToast(`${selectedIds.size}개 키워드 입찰가 ${pct > 0 ? '+' : ''}${pct}% 조정`);
  }, [keywords, selectedIds]);

  const bulkDelete = useCallback(() => {
    if (!confirm(`${selectedIds.size}개 키워드를 삭제하시겠습니까?`)) return;
    const updated = keywords.filter(k => !selectedIds.has(k.id));
    setKeywords(updated);
    saveKeywords(updated);
    setSelectedIds(new Set());
    showToast('삭제 완료');
  }, [keywords, selectedIds]);

  // ── 최적화 ─────────────────────────────────────────────
  const handleOptimize = useCallback(() => {
    const recs = optimizeBids(filtered);
    setRecommendations(recs);
    setOptimizerOpen(true);
  }, [filtered]);

  const applyRecommendations = useCallback(() => {
    const updated = keywords.map(k => {
      const rec = recommendations.find(r => r.keywordId === k.id);
      if (!rec || rec.action === 'maintain') return k;
      if (rec.action === 'pause') return { ...k, status: 'paused' as const };
      return { ...k, bid: rec.recommendedBid };
    });
    setKeywords(updated);
    saveKeywords(updated);
    setOptimizerOpen(false);
    showToast('최적화 적용 완료');
  }, [keywords, recommendations]);

  return (
    <div className="space-y-4">
      {/* ── 헤더 ──────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-semibold text-slate-800">검색광고 최적화</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">키워드 자동 추출 · 입찰가 최적화 · 여행 빅데이터 학습</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setExtractorOpen(true)} className="px-3 py-1.5 bg-[#001f3f] text-white text-[13px] rounded hover:bg-blue-900 transition font-medium">
            키워드 추출
          </button>
          <button onClick={handleOptimize} disabled={filtered.length === 0} className="px-3 py-1.5 bg-emerald-600 text-white text-[13px] rounded hover:bg-emerald-700 disabled:bg-slate-300 transition font-medium">
            AI 최적화
          </button>
          <button onClick={handleSync} disabled={syncing} className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-[13px] rounded hover:bg-slate-50 disabled:opacity-50 transition">
            {syncing ? '동기화 중...' : '성과 동기화'}
          </button>
        </div>
      </div>

      {/* ── 플랫폼 탭 + KPI ───────────────────────────── */}
      <div className="flex gap-3 items-start">
        <div className="flex border border-slate-200 rounded overflow-hidden">
          {(['naver', 'google'] as Platform[]).map(p => (
            <button key={p} onClick={() => setPlatform(p)}
              className={`px-4 py-1.5 text-[13px] font-medium transition ${platform === p ? 'bg-[#001f3f] text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
              {p === 'naver' ? '네이버' : '구글'}
            </button>
          ))}
        </div>
        <div className="flex-1 grid grid-cols-4 gap-2">
          {[
            { label: '키워드', value: `${totalKeywords}`, sub: `활성 ${activeKeywords}` },
            { label: '평균 CTR', value: `${avgCtr.toFixed(1)}%`, sub: avgCtr >= 3 ? 'Good' : 'Low' },
            { label: '총 지출', value: `₩${(totalSpend / 10000).toFixed(0)}만`, sub: '' },
            { label: '동기화', value: lastSync || '-', sub: '' },
          ].map((kpi, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-lg px-3 py-2">
              <p className="text-[10px] text-slate-400">{kpi.label}</p>
              <p className="text-[16px] font-bold text-slate-800">{kpi.value}</p>
              {kpi.sub && <p className="text-[10px] text-slate-400">{kpi.sub}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Tier 필터 + 일괄 조작 ─────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <button onClick={() => setTierFilter('all')} className={`px-2.5 py-1 text-[11px] rounded transition ${tierFilter === 'all' ? 'bg-[#001f3f] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>전체</button>
          {(Object.keys(TIER_LABELS) as KeywordTier[]).map(t => (
            <button key={t} onClick={() => setTierFilter(t)} className={`px-2.5 py-1 text-[11px] rounded transition ${tierFilter === t ? 'bg-[#001f3f] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              {TIER_LABELS[t]}
            </button>
          ))}
        </div>
        {selectedIds.size > 0 && (
          <div className="flex gap-1">
            <span className="text-[11px] text-slate-500 mr-1">{selectedIds.size}개 선택</span>
            <button onClick={() => bulkAdjust(10)} className="px-2 py-1 text-[10px] bg-emerald-50 text-emerald-700 rounded border border-emerald-200 hover:bg-emerald-100">+10%</button>
            <button onClick={() => bulkAdjust(-10)} className="px-2 py-1 text-[10px] bg-amber-50 text-amber-700 rounded border border-amber-200 hover:bg-amber-100">-10%</button>
            <button onClick={() => bulkAdjust(20)} className="px-2 py-1 text-[10px] bg-blue-50 text-blue-700 rounded border border-blue-200 hover:bg-blue-100">+20%</button>
            <button onClick={bulkDelete} className="px-2 py-1 text-[10px] bg-red-50 text-red-600 rounded border border-red-200 hover:bg-red-100">삭제</button>
          </div>
        )}
      </div>

      {/* ── 차트 ──────────────────────────────────────── */}
      {chartData.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <p className="text-[12px] font-semibold text-slate-700 mb-2">CTR 상위 키워드</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `${v}%`} />
              <Tooltip formatter={(v: unknown, n: unknown) => [n === 'ctr' ? `${v}%` : `₩${Number(v).toFixed(0)}K`, n === 'ctr' ? 'CTR' : '지출'] as [string, string]} />
              <Bar dataKey="ctr" radius={[3, 3, 0, 0]}>
                {chartData.map((_, idx) => <Cell key={idx} fill={idx < 3 ? '#059669' : '#94a3b8'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── 키워드 테이블 ─────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="w-8 py-2 px-2"><input type="checkbox" onChange={e => {
                if (e.target.checked) setSelectedIds(new Set(filtered.map(k => k.id)));
                else setSelectedIds(new Set());
              }} className="rounded border-slate-300" /></th>
              <th className="text-[11px] font-semibold text-slate-500 py-2 px-2 text-left">키워드</th>
              <th className="text-[11px] font-semibold text-slate-500 py-2 px-2 text-center">매칭</th>
              <th className="text-[11px] font-semibold text-slate-500 py-2 px-2 text-center">등급</th>
              <th className="text-[11px] font-semibold text-slate-500 py-2 px-2 text-right">입찰가</th>
              <th className="text-[11px] font-semibold text-slate-500 py-2 px-2 text-right">노출</th>
              <th className="text-[11px] font-semibold text-slate-500 py-2 px-2 text-right">클릭</th>
              <th className="text-[11px] font-semibold text-slate-500 py-2 px-2 text-center">CTR</th>
              <th className="text-[11px] font-semibold text-slate-500 py-2 px-2 text-right">CPC</th>
              <th className="text-[11px] font-semibold text-slate-500 py-2 px-2 text-right">지출</th>
              <th className="text-[11px] font-semibold text-slate-500 py-2 px-2 text-center">상태</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={11} className="py-12 text-center text-slate-400 text-[13px]">키워드가 없습니다. 상품에서 키워드를 추출하세요.</td></tr>
            ) : (
              filtered.map(k => (
                <tr key={k.id} className="border-b border-slate-100 hover:bg-slate-50 group">
                  <td className="py-1.5 px-2"><input type="checkbox" checked={selectedIds.has(k.id)} onChange={e => {
                    const next = new Set(selectedIds);
                    e.target.checked ? next.add(k.id) : next.delete(k.id);
                    setSelectedIds(next);
                  }} className="rounded border-slate-300" /></td>
                  <td className="text-[12px] text-slate-800 py-1.5 px-2 font-medium">{k.keyword}</td>
                  <td className="text-[10px] text-slate-500 py-1.5 px-2 text-center">{k.matchType === 'broad' ? '확장' : k.matchType === 'phrase' ? '구문' : '정확'}</td>
                  <td className="py-1.5 px-2 text-center"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TIER_COLORS[k.tier]}`}>{TIER_LABELS[k.tier]}</span></td>
                  <td className="text-[12px] text-slate-700 py-1.5 px-2 text-right">
                    {editingBid === k.id ? (
                      <input type="number" value={editBidValue} onChange={e => setEditBidValue(e.target.value)}
                        onBlur={() => handleBidSave(k.id)} onKeyDown={e => e.key === 'Enter' && handleBidSave(k.id)}
                        autoFocus className="w-16 px-1 py-0.5 border border-[#005d90] rounded text-[12px] text-right" />
                    ) : (
                      <button onClick={() => { setEditingBid(k.id); setEditBidValue(String(k.bid)); }}
                        className="hover:bg-blue-50 px-1 rounded transition">₩{k.bid.toLocaleString()}</button>
                    )}
                  </td>
                  <td className="text-[12px] text-slate-600 py-1.5 px-2 text-right tabular-nums">{k.impressions.toLocaleString()}</td>
                  <td className="text-[12px] text-slate-600 py-1.5 px-2 text-right tabular-nums">{k.clicks.toLocaleString()}</td>
                  <td className={`text-[12px] py-1.5 px-2 text-center font-medium ${k.ctr >= 5 ? 'text-emerald-600' : k.ctr >= 3 ? 'text-blue-600' : k.ctr > 0 ? 'text-slate-700' : 'text-slate-400'}`}>{k.ctr > 0 ? `${k.ctr}%` : '-'}</td>
                  <td className="text-[12px] text-slate-600 py-1.5 px-2 text-right tabular-nums">{k.cpc > 0 ? `₩${k.cpc.toLocaleString()}` : '-'}</td>
                  <td className="text-[12px] text-slate-600 py-1.5 px-2 text-right tabular-nums">{k.spend > 0 ? `₩${k.spend.toLocaleString()}` : '-'}</td>
                  <td className="py-1.5 px-2 text-center">
                    <button onClick={() => toggleStatus(k.id)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition ${k.status === 'active' ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
                      {k.status === 'active' ? 'ON' : 'OFF'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── 키워드 추출 드로어 ─────────────────────────── */}
      {extractorOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setExtractorOpen(false)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <div className="relative w-full max-w-lg bg-white shadow-xl border-l border-slate-200 h-full flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between flex-shrink-0">
              <h2 className="text-[16px] font-semibold text-slate-800">키워드 추출기</h2>
              <button onClick={() => setExtractorOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-600"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* 상품 선택 */}
              <div>
                <label className="text-[11px] font-semibold text-slate-400 uppercase block mb-1">상품 선택</label>
                <select value={selectedPkg?.id || ''} onChange={e => {
                  const pkg = packages.find(p => p.id === e.target.value);
                  if (pkg) handleExtract(pkg);
                }} className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px] focus:ring-1 focus:ring-[#005d90]">
                  <option value="">상품 선택...</option>
                  {packages.map(p => <option key={p.id} value={p.id}>{p.title || p.display_name} ({p.destination})</option>)}
                </select>
              </div>

              {/* 추출 결과 */}
              {extractedPreview.length > 0 && (
                <>
                  <p className="text-[12px] text-slate-600">{extractedPreview.length}개 키워드 추출됨</p>
                  {(Object.keys(TIER_LABELS) as KeywordTier[]).map(tier => {
                    const tierKws = extractedPreview.filter(k => k.tier === tier);
                    if (tierKws.length === 0) return null;
                    return (
                      <div key={tier}>
                        <p className="text-[11px] font-semibold text-slate-500 mb-1">{TIER_LABELS[tier]} ({tierKws.length})</p>
                        <div className="space-y-1">
                          {tierKws.map((k, i) => (
                            <div key={i} className="flex items-center gap-2 bg-slate-50 rounded px-2 py-1.5">
                              <span className="flex-1 text-[12px] text-slate-800">{k.keyword}</span>
                              <span className="text-[10px] text-slate-400">{k.matchType === 'broad' ? '확장' : k.matchType === 'phrase' ? '구문' : '정확'}</span>
                              {k.suggestedBid > 0 && <span className="text-[10px] text-blue-600">₩{k.suggestedBid}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {/* 과거 데이터 인사이트 */}
                  {selectedPkg?.destination && (() => {
                    const topKws = getTopKeywords(selectedPkg.destination, 3);
                    if (topKws.length === 0) return null;
                    return (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <p className="text-[11px] font-semibold text-blue-700 mb-1">빅데이터 인사이트 ({selectedPkg.destination})</p>
                        {topKws.map((k, i) => (
                          <p key={i} className="text-[11px] text-blue-600">{i + 1}. {k.keyword} — CTR {k.avgCtr.toFixed(1)}% (샘플 {k.sampleCount}회)</p>
                        ))}
                      </div>
                    );
                  })()}

                  <div className="flex gap-2">
                    <button onClick={() => handleAddExtracted(extractedPreview.filter(k => k.tier !== 'negative'))}
                      className="flex-1 py-2 bg-[#001f3f] text-white text-[13px] rounded hover:bg-blue-900 transition font-medium">
                      키워드 등록 ({extractedPreview.filter(k => k.tier !== 'negative').length}개)
                    </button>
                    <button onClick={() => handleAddExtracted(extractedPreview)}
                      className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-[13px] rounded hover:bg-slate-50 transition">
                      제외 키워드 포함
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── AI 최적화 드로어 ───────────────────────────── */}
      {optimizerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setOptimizerOpen(false)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <div className="relative w-full max-w-lg bg-white shadow-xl border-l border-slate-200 h-full flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between flex-shrink-0">
              <h2 className="text-[16px] font-semibold text-slate-800">AI 입찰 최적화</h2>
              <button onClick={() => setOptimizerOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-600"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {recommendations.length === 0 ? (
                <p className="text-center text-slate-400 text-[13px] py-8">최적화할 키워드가 없습니다</p>
              ) : (
                recommendations.map(rec => (
                  <div key={rec.keywordId} className={`border rounded-lg p-3 ${
                    rec.action === 'increase' ? 'border-emerald-200 bg-emerald-50' :
                    rec.action === 'decrease' ? 'border-red-200 bg-red-50' :
                    rec.action === 'boost' ? 'border-blue-200 bg-blue-50' :
                    'border-slate-200 bg-slate-50'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[13px] font-medium text-slate-800">{rec.keyword}</span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        rec.action === 'increase' ? 'bg-emerald-100 text-emerald-700' :
                        rec.action === 'decrease' ? 'bg-red-100 text-red-600' :
                        rec.action === 'boost' ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {rec.action === 'increase' ? '인상' : rec.action === 'decrease' ? '하향' : rec.action === 'boost' ? '부스트' : '유지'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600">{rec.reason}</p>
                    {rec.currentBid !== rec.recommendedBid && (
                      <p className="text-[11px] mt-1 text-slate-500">₩{rec.currentBid.toLocaleString()} → ₩{rec.recommendedBid.toLocaleString()}</p>
                    )}
                  </div>
                ))
              )}
            </div>
            {recommendations.length > 0 && (
              <div className="bg-white border-t border-slate-200 px-5 py-3 flex-shrink-0">
                <button onClick={applyRecommendations} className="w-full py-2 bg-[#001f3f] text-white text-[13px] rounded hover:bg-blue-900 transition font-medium">
                  {recommendations.filter(r => r.action !== 'maintain').length}개 추천 일괄 적용
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[100] bg-[#001f3f] text-white px-5 py-3 rounded-lg text-[13px] shadow-lg">{toast}</div>
      )}
    </div>
  );
}
