'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useToast } from '@/components/ui/Toast';

const SearchAdsCtrChart = dynamic(() => import('./SearchAdsCtrChart'), { ssr: false });
import {
  extractKeywords, createSearchAdKeyword, optimizeBids,
  loadKeywords, saveKeywords, archivePerformance, getTopKeywords,
  type SearchAdKeyword, type Platform, type KeywordTier, type BidRecommendation,
} from '@/lib/keyword-brain';
import SubNav from '@/components/admin/SubNav';
import SearchAdsReadinessPanel, { type SearchAdsReadinessSummary } from './SearchAdsReadinessPanel';

// ── 탭/필터 상수 ─────────────────────────────────────────
const TIER_LABELS: Record<KeywordTier, string> = { core: '핵심', mid: '중위', longtail: '세부', negative: '제외' };
const TIER_COLORS: Record<KeywordTier, string> = { core: 'bg-blue-50 text-blue-700', mid: 'bg-amber-50 text-amber-700', longtail: 'bg-emerald-50 text-emerald-700', negative: 'bg-red-50 text-red-600' };
const isMutableExternalKeywordId = (platform: Platform, id: string) =>
  platform === 'naver' ? /^nkw-[a-z0-9-]+$/i.test(id) : id.startsWith('customers/');

interface Package { id: string; title: string; destination?: string; duration?: number; airline?: string; departure_airport?: string; product_type?: string; price?: number; inclusions?: string[]; price_tiers?: { adult_price?: number }[]; display_name?: string; }
interface SearchAdPerformanceResponse {
  keywordId: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  conversions: number;
  spend: number;
}
interface SearchAdPlanRow {
  id: string;
  package_id: string;
  platform: Platform;
  plan_status: 'draft' | 'approved' | 'published' | 'failed' | 'archived';
  campaign_name: string;
  ad_group_name: string;
  tier: KeywordTier;
  match_type: 'exact' | 'phrase' | 'broad';
  keyword_text: string;
  suggested_bid_krw: number;
  monthly_search_volume: number | null;
  competition_level: 'low' | 'medium' | 'high' | null;
  travel_packages?: { title?: string | null; destination?: string | null; short_code?: string | null } | null;
}

export default function SearchAdsPage() {
  return (
    <div className="max-w-7xl mx-auto px-2 py-4 space-y-4">
      <SubNav basePath="/admin/search-ads" tabs={[
        { href: '/admin/marketing', label: '통합 대시보드' },
        { href: '/admin/search-ads', label: '캠페인/키워드' },
        { href: '/admin/keyword-stats', label: '키워드 성과' },
        { href: '/admin/keyword-optimization', label: '최적화 로그' },
      ]} />
      <SearchAdsContent />
    </div>
  );
}

function SearchAdsContent() {
  const [platform, setPlatform] = useState<Platform>('naver');
  const [tierFilter, setTierFilter] = useState<KeywordTier | 'all'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingBid, setEditingBid] = useState<string | null>(null);
  const [editBidValue, setEditBidValue] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [plansLoading, setPlansLoading] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  // 패널
  const [extractorOpen, setExtractorOpen] = useState(false);
  const [optimizerOpen, setOptimizerOpen] = useState(false);
  const [packages, setPackages] = useState<Package[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<Package | null>(null);
  const [extractedPreview, setExtractedPreview] = useState<ReturnType<typeof extractKeywords>>([]);
  const [recommendations, setRecommendations] = useState<BidRecommendation[]>([]);
  const [keywords, setKeywords] = useState<SearchAdKeyword[]>([]);
  const [planRows, setPlanRows] = useState<SearchAdPlanRow[]>([]);
  const [selectedPlanIds, setSelectedPlanIds] = useState<Set<string>>(new Set());
  const [adOsSummary, setAdOsSummary] = useState<SearchAdsReadinessSummary | null>(null);
  const [adOsError, setAdOsError] = useState<string | null>(null);
  const { toast: _t } = useToast();
  const showToast = useCallback(
    (msg: string) => _t(msg, /실패|오류/.test(msg) ? 'error' : /완료|등록|조정|적용/.test(msg) ? 'success' : 'info'),
    [_t],
  );

  const refreshPlans = useCallback(async () => {
    setPlansLoading(true);
    try {
      const res = await fetch('/api/admin/search-ads/auto-plan?limit=80');
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPlanRows(data.plans ?? []);
    } catch {
      showToast('광고 플랜 조회 실패');
    } finally {
      setPlansLoading(false);
    }
  }, [showToast]);

  // 로드
  useEffect(() => {
    setKeywords(loadKeywords());
    refreshPlans();
    fetch('/api/packages?limit=200')
      .then(r => r.json())
      .then(d => setPackages((d.data ?? d.packages ?? []).filter((p: Package) => p.destination)));
  }, [refreshPlans]);

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/ad-os/summary', { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok || !json.ok) {
          setAdOsSummary(null);
          setAdOsError(json.error || `HTTP ${res.status}`);
          return;
        }
        setAdOsSummary(json);
        setAdOsError(null);
      })
      .catch((error) => {
        if (!alive) return;
        setAdOsSummary(null);
        setAdOsError(error instanceof Error ? error.message : 'Ad OS 상태 조회 실패');
      });
    return () => {
      alive = false;
    };
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
      const res = await fetch('/api/admin/search-ads/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const perf = (data.performance ?? []) as SearchAdPerformanceResponse[];
      const syncPromises: Promise<unknown>[] = [];
      const updated = keywords.map(k => {
        const p = perf.find(pp => pp.keywordId === k.id);
        if (!p) return k;
        // Supabase + localStorage에 누적
        if (k.tier !== 'negative') {
          const dest = packages.find(pkg => pkg.id === k.productId)?.destination || '';
          if (dest) {
            const metrics = { impressions: p.impressions, clicks: p.clicks, ctr: p.ctr, cpc: p.cpc, conversions: p.conversions, spend: p.spend, roas: 0 };
            archivePerformance(dest, k.keyword, metrics);
            // Supabase 동기화
            syncPromises.push(
              fetch('/api/admin/keyword-sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ destination: dest, keyword: k.keyword, platform: k.platform, metrics }),
              }).catch(() => {/* silent */}),
            );
          }
        }
        return { ...k, impressions: p.impressions, clicks: p.clicks, ctr: p.ctr, cpc: p.cpc, conversions: p.conversions, spend: p.spend };
      });
      // 모든 Supabase 저장 완료 대기
      await Promise.allSettled(syncPromises);
      setKeywords(updated);
      saveKeywords(updated);
      setLastSync(new Date().toISOString().slice(11, 16));
      showToast(`성과 동기화 완료 (${syncPromises.length}건 Supabase 저장)`);
    } catch { showToast('동기화 실패'); }
    finally { setSyncing(false); }
  }, [keywords, packages, showToast]);

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
  }, [keywords, platform, selectedPkg, showToast]);

  const handleAutoPlan = useCallback(async () => {
    if (!selectedPkg) {
      showToast('상품을 먼저 선택하세요');
      return;
    }
    setPlanning(true);
    try {
      const res = await fetch('/api/admin/search-ads/auto-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package_id: selectedPkg.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      showToast(`검색광고 draft 생성 완료 (${data.saved ?? 0}개 저장)`);
      await refreshPlans();
    } catch {
      showToast('검색광고 draft 생성 실패');
    } finally {
      setPlanning(false);
    }
  }, [refreshPlans, selectedPkg, showToast]);

  const handlePlanStatus = useCallback(async (action: 'approve' | 'archive') => {
    const ids = [...selectedPlanIds];
    if (ids.length === 0) {
      showToast('광고 플랜을 먼저 선택하세요');
      return;
    }
    try {
      const res = await fetch('/api/admin/search-ads/auto-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSelectedPlanIds(new Set());
      await refreshPlans();
      showToast(action === 'approve' ? '발행 준비 완료' : '보관 완료');
    } catch {
      showToast('광고 플랜 상태 변경 실패');
    }
  }, [refreshPlans, selectedPlanIds, showToast]);

  // ── 입찰가 수정 ────────────────────────────────────────
  const handleBidSave = useCallback(async (kwId: string) => {
    const newBid = parseInt(editBidValue);
    if (isNaN(newBid) || newBid < 0) return;
    const target = keywords.find(k => k.id === kwId);
    if (target && isMutableExternalKeywordId(target.platform, target.id)) {
      const res = await fetch('/api/admin/search-ads/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_bid', keyword: target, bid: newBid }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !data.ok) {
        showToast('외부 광고 입찰가 변경 실패');
        return;
      }
    }
    const updated = keywords.map(k => k.id === kwId ? { ...k, bid: newBid } : k);
    setKeywords(updated);
    saveKeywords(updated);
    setEditingBid(null);
    showToast('입찰가 적용 완료');
  }, [keywords, editBidValue, showToast]);

  // ── 상태 토글 ──────────────────────────────────────────
  const toggleStatus = useCallback(async (kwId: string) => {
    const target = keywords.find(k => k.id === kwId);
    if (!target) return;
    const nextStatus = target.status === 'active' ? 'paused' as const : 'active' as const;
    if (nextStatus === 'paused' && isMutableExternalKeywordId(target.platform, target.id)) {
      const res = await fetch('/api/admin/search-ads/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause', keyword: target }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !data.ok) {
        showToast('외부 광고 키워드 정지 실패');
        return;
      }
    }
    const updated = keywords.map(k => k.id === kwId ? { ...k, status: nextStatus } : k);
    setKeywords(updated);
    saveKeywords(updated);
  }, [keywords, showToast]);

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
  }, [keywords, selectedIds, showToast]);

  const bulkDelete = useCallback(() => {
    if (!confirm(`${selectedIds.size}개 키워드를 삭제하시겠습니까?`)) return;
    const updated = keywords.filter(k => !selectedIds.has(k.id));
    setKeywords(updated);
    saveKeywords(updated);
    setSelectedIds(new Set());
    showToast('삭제 완료');
  }, [keywords, selectedIds, showToast]);

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
  }, [keywords, recommendations, showToast]);

  return (
    <div className="space-y-4">
      {/* ── 헤더 ──────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-admin-lg font-semibold text-admin-text-2">검색광고 최적화</h1>
          <p className="text-[11px] text-admin-muted mt-0.5">키워드 자동 추출 · 입찰가 최적화 · 여행 빅데이터 학습</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setExtractorOpen(true)} className="px-3 py-1.5 bg-blue-600 text-white text-admin-sm rounded hover:bg-blue-700 transition font-medium">
            키워드 추출
          </button>
          <button onClick={handleOptimize} disabled={filtered.length === 0} className="px-3 py-1.5 bg-emerald-600 text-white text-admin-sm rounded hover:bg-emerald-700 disabled:bg-slate-300 transition font-medium">
            AI 최적화
          </button>
          <button onClick={handleSync} disabled={syncing} className="px-3 py-1.5 bg-white border border-admin-border-strong text-admin-text-2 text-admin-sm rounded hover:bg-admin-bg disabled:opacity-50 transition">
            {syncing ? '동기화 중...' : '성과 동기화'}
          </button>
        </div>
      </div>

      <SearchAdsReadinessPanel summary={adOsSummary} error={adOsError} />

      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
        <div className="px-3 py-2 border-b border-admin-border-mid flex items-center justify-between gap-3">
          <div>
            <p className="text-admin-sm font-semibold text-admin-text-2">상품 광고 런치센터</p>
            <p className="text-[11px] text-admin-muted">상품 → 네이버/구글 키워드 draft → 발행 준비</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={selectedPkg?.id || ''} onChange={e => {
              const pkg = packages.find(p => p.id === e.target.value) ?? null;
              setSelectedPkg(pkg);
              if (pkg) handleExtract(pkg);
            }} className="w-64 border border-admin-border-mid rounded px-2 py-1.5 text-admin-xs focus:ring-1 focus:ring-[#005d90]">
              <option value="">상품 선택...</option>
              {packages.map(p => <option key={p.id} value={p.id}>{p.title || p.display_name} ({p.destination})</option>)}
            </select>
            <button onClick={handleAutoPlan} disabled={!selectedPkg || planning}
              className="px-3 py-1.5 bg-emerald-600 text-white text-admin-sm rounded hover:bg-emerald-700 disabled:opacity-50 transition font-medium">
              {planning ? '생성 중...' : '자동 광고 준비'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-4 border-b border-admin-border-mid">
          {[
            { label: 'Draft', value: planRows.filter(p => p.plan_status === 'draft').length },
            { label: '발행 준비', value: planRows.filter(p => p.plan_status === 'approved').length },
            { label: '네이버', value: planRows.filter(p => p.platform === 'naver').length },
            { label: '구글', value: planRows.filter(p => p.platform === 'google').length },
          ].map(kpi => (
            <div key={kpi.label} className="px-3 py-2 border-r last:border-r-0 border-admin-border-mid">
              <p className="text-[10px] text-admin-muted-2">{kpi.label}</p>
              <p className="text-admin-lg font-bold text-admin-text-2">{kpi.value}</p>
            </div>
          ))}
        </div>
        <div className="px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => handlePlanStatus('approve')} disabled={selectedPlanIds.size === 0}
              className="px-2.5 py-1 text-[11px] bg-blue-600 text-white rounded disabled:opacity-50">
              발행 준비
            </button>
            <button onClick={() => handlePlanStatus('archive')} disabled={selectedPlanIds.size === 0}
              className="px-2.5 py-1 text-[11px] bg-white border border-admin-border-strong text-admin-text-2 rounded disabled:opacity-50">
              보관
            </button>
            {selectedPlanIds.size > 0 && <span className="text-[11px] text-admin-muted">{selectedPlanIds.size}개 선택</span>}
          </div>
          <button onClick={refreshPlans} disabled={plansLoading}
            className="px-2.5 py-1 text-[11px] bg-white border border-admin-border-mid text-admin-muted rounded disabled:opacity-50">
            {plansLoading ? '불러오는 중...' : '새로고침'}
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-admin-bg border-y border-admin-border-mid">
              <tr>
                <th className="w-8 py-1.5 px-2"><input type="checkbox" onChange={e => {
                  if (e.target.checked) setSelectedPlanIds(new Set(planRows.filter(p => p.plan_status === 'draft').map(p => p.id)));
                  else setSelectedPlanIds(new Set());
                }} className="rounded border-admin-border-strong" /></th>
                <th className="text-[11px] font-semibold text-admin-muted py-1.5 px-2 text-left">상품</th>
                <th className="text-[11px] font-semibold text-admin-muted py-1.5 px-2 text-left">키워드</th>
                <th className="text-[11px] font-semibold text-admin-muted py-1.5 px-2 text-center">플랫폼</th>
                <th className="text-[11px] font-semibold text-admin-muted py-1.5 px-2 text-center">등급</th>
                <th className="text-[11px] font-semibold text-admin-muted py-1.5 px-2 text-right">입찰</th>
                <th className="text-[11px] font-semibold text-admin-muted py-1.5 px-2 text-center">상태</th>
              </tr>
            </thead>
            <tbody>
              {planRows.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-admin-muted-2 text-admin-sm">생성된 광고 플랜이 없습니다.</td></tr>
              ) : planRows.slice(0, 80).map(row => (
                <tr key={row.id} className="border-b border-admin-border hover:bg-admin-bg">
                  <td className="py-1.5 px-2"><input type="checkbox" checked={selectedPlanIds.has(row.id)} onChange={e => {
                    const next = new Set(selectedPlanIds);
                    e.target.checked ? next.add(row.id) : next.delete(row.id);
                    setSelectedPlanIds(next);
                  }} className="rounded border-admin-border-strong" /></td>
                  <td className="text-[11px] text-admin-muted py-1.5 px-2">{row.travel_packages?.short_code || row.travel_packages?.destination || row.package_id.slice(0, 8)}</td>
                  <td className="text-admin-xs text-admin-text-2 py-1.5 px-2 font-medium">{row.keyword_text}</td>
                  <td className="text-[10px] text-admin-muted py-1.5 px-2 text-center">{row.platform === 'naver' ? '네이버' : '구글'}</td>
                  <td className="py-1.5 px-2 text-center"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TIER_COLORS[row.tier]}`}>{TIER_LABELS[row.tier]}</span></td>
                  <td className="text-admin-xs text-admin-text-2 py-1.5 px-2 text-right">₩{row.suggested_bid_krw.toLocaleString()}</td>
                  <td className="text-[10px] text-admin-muted py-1.5 px-2 text-center">{row.plan_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 플랫폼 탭 + KPI ───────────────────────────── */}
      <div className="flex gap-3 items-start">
        <div className="flex border border-admin-border-mid rounded overflow-hidden">
          {(['naver', 'google'] as Platform[]).map(p => (
            <button key={p} onClick={() => setPlatform(p)}
              className={`px-4 py-1.5 text-admin-sm font-medium transition ${platform === p ? 'bg-blue-600 text-white' : 'bg-white text-admin-muted hover:bg-admin-bg'}`}>
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
            <div key={i} className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs px-3 py-2">
              <p className="text-[10px] text-admin-muted-2">{kpi.label}</p>
              <p className="text-admin-lg font-bold text-admin-text-2">{kpi.value}</p>
              {kpi.sub && <p className="text-[10px] text-admin-muted-2">{kpi.sub}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Tier 필터 + 일괄 조작 ─────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <button onClick={() => setTierFilter('all')} className={`px-2.5 py-1 text-[11px] rounded transition ${tierFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-admin-surface-2 text-admin-muted hover:bg-slate-200'}`}>전체</button>
          {(Object.keys(TIER_LABELS) as KeywordTier[]).map(t => (
            <button key={t} onClick={() => setTierFilter(t)} className={`px-2.5 py-1 text-[11px] rounded transition ${tierFilter === t ? 'bg-blue-600 text-white' : 'bg-admin-surface-2 text-admin-muted hover:bg-slate-200'}`}>
              {TIER_LABELS[t]}
            </button>
          ))}
        </div>
        {selectedIds.size > 0 && (
          <div className="flex gap-1">
            <span className="text-[11px] text-admin-muted mr-1">{selectedIds.size}개 선택</span>
            <button onClick={() => bulkAdjust(10)} className="px-2 py-1 text-[10px] bg-emerald-50 text-emerald-700 rounded border border-emerald-200 hover:bg-emerald-100">+10%</button>
            <button onClick={() => bulkAdjust(-10)} className="px-2 py-1 text-[10px] bg-amber-50 text-amber-700 rounded border border-amber-200 hover:bg-amber-100">-10%</button>
            <button onClick={() => bulkAdjust(20)} className="px-2 py-1 text-[10px] bg-blue-50 text-blue-700 rounded border border-blue-200 hover:bg-blue-100">+20%</button>
            <button onClick={bulkDelete} className="px-2 py-1 text-[10px] bg-red-50 text-red-600 rounded border border-red-200 hover:bg-red-100">삭제</button>
          </div>
        )}
      </div>

      {/* ── 차트 ──────────────────────────────────────── */}
      {chartData.length > 0 && (
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs p-3">
          <p className="text-admin-xs font-semibold text-admin-text-2 mb-2">CTR 상위 키워드</p>
          <SearchAdsCtrChart data={chartData} />
        </div>
      )}

      {/* ── 키워드 테이블 ─────────────────────────────── */}
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-admin-bg border-b border-admin-border-mid">
              <th className="w-8 py-2 px-2"><input type="checkbox" onChange={e => {
                if (e.target.checked) setSelectedIds(new Set(filtered.map(k => k.id)));
                else setSelectedIds(new Set());
              }} className="rounded border-admin-border-strong" /></th>
              <th className="text-[11px] font-semibold text-admin-muted py-2 px-2 text-left">키워드</th>
              <th className="text-[11px] font-semibold text-admin-muted py-2 px-2 text-center">매칭</th>
              <th className="text-[11px] font-semibold text-admin-muted py-2 px-2 text-center">등급</th>
              <th className="text-[11px] font-semibold text-admin-muted py-2 px-2 text-right">입찰가</th>
              <th className="text-[11px] font-semibold text-admin-muted py-2 px-2 text-right">노출</th>
              <th className="text-[11px] font-semibold text-admin-muted py-2 px-2 text-right">클릭</th>
              <th className="text-[11px] font-semibold text-admin-muted py-2 px-2 text-center">CTR</th>
              <th className="text-[11px] font-semibold text-admin-muted py-2 px-2 text-right">CPC</th>
              <th className="text-[11px] font-semibold text-admin-muted py-2 px-2 text-right">지출</th>
              <th className="text-[11px] font-semibold text-admin-muted py-2 px-2 text-center">상태</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={11} className="py-12 text-center text-admin-muted-2 text-admin-sm">키워드가 없습니다. 상품에서 키워드를 추출하세요.</td></tr>
            ) : (
              filtered.map(k => (
                <tr key={k.id} className="border-b border-admin-border hover:bg-admin-bg group">
                  <td className="py-1.5 px-2"><input type="checkbox" checked={selectedIds.has(k.id)} onChange={e => {
                    const next = new Set(selectedIds);
                    e.target.checked ? next.add(k.id) : next.delete(k.id);
                    setSelectedIds(next);
                  }} className="rounded border-admin-border-strong" /></td>
                  <td className="text-admin-xs text-admin-text-2 py-1.5 px-2 font-medium">{k.keyword}</td>
                  <td className="text-[10px] text-admin-muted py-1.5 px-2 text-center">{k.matchType === 'broad' ? '확장' : k.matchType === 'phrase' ? '구문' : '정확'}</td>
                  <td className="py-1.5 px-2 text-center"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TIER_COLORS[k.tier]}`}>{TIER_LABELS[k.tier]}</span></td>
                  <td className="text-admin-xs text-admin-text-2 py-1.5 px-2 text-right">
                    {editingBid === k.id ? (
                      <input type="number" value={editBidValue} onChange={e => setEditBidValue(e.target.value)}
                        onBlur={() => handleBidSave(k.id)} onKeyDown={e => e.key === 'Enter' && handleBidSave(k.id)}
                        autoFocus className="w-16 px-1 py-0.5 border border-[#005d90] rounded text-admin-xs text-right" />
                    ) : (
                      <button onClick={() => { setEditingBid(k.id); setEditBidValue(String(k.bid)); }}
                        className="hover:bg-blue-50 px-1 rounded transition">₩{k.bid.toLocaleString()}</button>
                    )}
                  </td>
                  <td className="text-admin-xs text-admin-muted py-1.5 px-2 text-right tabular-nums">{k.impressions.toLocaleString()}</td>
                  <td className="text-admin-xs text-admin-muted py-1.5 px-2 text-right tabular-nums">{k.clicks.toLocaleString()}</td>
                  <td className={`text-admin-xs py-1.5 px-2 text-center font-medium ${k.ctr >= 5 ? 'text-emerald-600' : k.ctr >= 3 ? 'text-blue-600' : k.ctr > 0 ? 'text-admin-text-2' : 'text-admin-muted-2'}`}>{k.ctr > 0 ? `${k.ctr}%` : '-'}</td>
                  <td className="text-admin-xs text-admin-muted py-1.5 px-2 text-right tabular-nums">{k.cpc > 0 ? `₩${k.cpc.toLocaleString()}` : '-'}</td>
                  <td className="text-admin-xs text-admin-muted py-1.5 px-2 text-right tabular-nums">{k.spend > 0 ? `₩${k.spend.toLocaleString()}` : '-'}</td>
                  <td className="py-1.5 px-2 text-center">
                    <button onClick={() => toggleStatus(k.id)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition ${k.status === 'active' ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-admin-surface-2 text-admin-muted-2 hover:bg-slate-200'}`}>
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
          <div className="relative w-full max-w-lg bg-white shadow-admin-lg border-l border-admin-border-mid h-full flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="bg-white border-b border-admin-border-mid px-5 py-3 flex items-center justify-between flex-shrink-0">
              <h2 className="text-admin-lg font-semibold text-admin-text-2">키워드 추출기</h2>
              <button onClick={() => setExtractorOpen(false)} className="p-1.5 text-admin-muted-2 hover:text-admin-muted"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* 상품 선택 */}
              <div>
                <label className="text-[11px] font-semibold text-admin-muted-2 uppercase block mb-1">상품 선택</label>
                <select value={selectedPkg?.id || ''} onChange={e => {
                  const pkg = packages.find(p => p.id === e.target.value);
                  if (pkg) handleExtract(pkg);
                }} className="w-full border border-admin-border-mid rounded px-3 py-1.5 text-admin-sm focus:ring-1 focus:ring-[#005d90]">
                  <option value="">상품 선택...</option>
                  {packages.map(p => <option key={p.id} value={p.id}>{p.title || p.display_name} ({p.destination})</option>)}
                </select>
              </div>

              {/* 추출 결과 */}
              {extractedPreview.length > 0 && (
                <>
                  <p className="text-admin-xs text-admin-muted">{extractedPreview.length}개 키워드 추출됨</p>
                  {(Object.keys(TIER_LABELS) as KeywordTier[]).map(tier => {
                    const tierKws = extractedPreview.filter(k => k.tier === tier);
                    if (tierKws.length === 0) return null;
                    return (
                      <div key={tier}>
                        <p className="text-[11px] font-semibold text-admin-muted mb-1">{TIER_LABELS[tier]} ({tierKws.length})</p>
                        <div className="space-y-1">
                          {tierKws.map((k, i) => (
                            <div key={i} className="flex items-center gap-2 bg-admin-bg rounded px-2 py-1.5">
                              <span className="flex-1 text-admin-xs text-admin-text-2">{k.keyword}</span>
                              <span className="text-[10px] text-admin-muted-2">{k.matchType === 'broad' ? '확장' : k.matchType === 'phrase' ? '구문' : '정확'}</span>
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
                      className="flex-1 py-2 bg-blue-600 text-white text-admin-sm rounded hover:bg-blue-700 transition font-medium">
                      키워드 등록 ({extractedPreview.filter(k => k.tier !== 'negative').length}개)
                    </button>
                    <button onClick={handleAutoPlan} disabled={planning}
                      className="px-4 py-2 bg-emerald-600 text-white text-admin-sm rounded hover:bg-emerald-700 disabled:opacity-50 transition">
                      {planning ? 'Draft 생성 중...' : '광고 Draft'}
                    </button>
                    <button onClick={() => handleAddExtracted(extractedPreview)}
                      className="px-4 py-2 bg-white border border-admin-border-strong text-admin-text-2 text-admin-sm rounded hover:bg-admin-bg transition">
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
          <div className="relative w-full max-w-lg bg-white shadow-admin-lg border-l border-admin-border-mid h-full flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="bg-white border-b border-admin-border-mid px-5 py-3 flex items-center justify-between flex-shrink-0">
              <h2 className="text-admin-lg font-semibold text-admin-text-2">AI 입찰 최적화</h2>
              <button onClick={() => setOptimizerOpen(false)} className="p-1.5 text-admin-muted-2 hover:text-admin-muted"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {recommendations.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10">
                  <svg className="w-8 h-8 text-admin-border-mid" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
                  <p className="text-admin-sm font-medium text-admin-muted">최적화할 키워드가 없습니다</p>
                </div>
              ) : (
                recommendations.map(rec => (
                  <div key={rec.keywordId} className={`border rounded-lg p-3 ${
                    rec.action === 'increase' ? 'border-emerald-200 bg-emerald-50' :
                    rec.action === 'decrease' ? 'border-red-200 bg-red-50' :
                    rec.action === 'boost' ? 'border-blue-200 bg-blue-50' :
                    'border-admin-border-mid bg-admin-bg'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-admin-sm font-medium text-admin-text-2">{rec.keyword}</span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        rec.action === 'increase' ? 'bg-emerald-100 text-emerald-700' :
                        rec.action === 'decrease' ? 'bg-red-100 text-red-600' :
                        rec.action === 'boost' ? 'bg-blue-100 text-blue-700' :
                        'bg-admin-surface-2 text-admin-muted'
                      }`}>
                        {rec.action === 'increase' ? '인상' : rec.action === 'decrease' ? '하향' : rec.action === 'boost' ? '부스트' : '유지'}
                      </span>
                    </div>
                    <p className="text-[11px] text-admin-muted">{rec.reason}</p>
                    {rec.currentBid !== rec.recommendedBid && (
                      <p className="text-[11px] mt-1 text-admin-muted">₩{rec.currentBid.toLocaleString()} → ₩{rec.recommendedBid.toLocaleString()}</p>
                    )}
                  </div>
                ))
              )}
            </div>
            {recommendations.length > 0 && (
              <div className="bg-white border-t border-admin-border-mid px-5 py-3 flex-shrink-0">
                <button onClick={applyRecommendations} className="w-full py-2 bg-blue-600 text-white text-admin-sm rounded hover:bg-blue-700 transition font-medium">
                  {recommendations.filter(r => r.action !== 'maintain').length}개 추천 일괄 적용
                </button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
