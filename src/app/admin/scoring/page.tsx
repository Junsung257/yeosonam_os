'use client';

import { useCallback, useEffect, useState } from 'react';
import PolicyWeightsCompare from '@/components/admin/PolicyWeightsCompare';

interface ScoringPolicy {
  id: string;
  version: string;
  weights: Record<string, number>;
  hotel_premium: Record<string, number>;
  flight_premium: { direct: number; transit: number };
  hedonic_coefs: {
    shopping_per_count: number;
    meal_per_count: number;
    hotel_grade_step: number;
    computed_from: string;
    sample_size: number;
    computed_at: string | null;
  };
  market_rates: Record<string, number>;
  fallback_rules: Record<string, number>;
  notes?: string | null;
  updated_at?: string;
}

interface MarketRate {
  id: string;
  tour_name: string;
  destination: string | null;
  market_rate_krw: number;
  source: string;
  notes: string | null;
}

const WEIGHT_LABELS: Record<string, string> = {
  // base 6 (v1.0)
  price: '가격',
  hotel: '호텔 등급',
  meal: '식사 횟수',
  free_options: '무료 옵션 수',
  shopping_avoidance: '쇼핑 회피',
  reliability: '랜드사 신뢰도',
  // v3.2 P1 (2026-04-30)
  climate_fit: '계절 적합도',
  popularity: '한국인 인기도',
  korean_meal: '한식 횟수',
  free_time: '자유시간 비율',
};

const WEIGHT_DESCRIPTIONS: Record<string, string> = {
  price: '낮을수록 ↑ (실효가 기준)',
  hotel: '호텔 등급 평균',
  meal: '전체 식사 횟수',
  free_options: '무료 포함 옵션 개수',
  shopping_avoidance: '쇼핑 일정이 적을수록 ↑',
  reliability: '랜드사 캔슬·환불·디스퓻 점수',
  climate_fit: 'destination_climate.fitness (출발월 기준)',
  popularity: 'Naver+Wiki 한국인 검색 트래픽',
  korean_meal: '한식·삼겹살·불고기 등 (효도·시니어)',
  free_time: '자유시간/휴식 schedule 비율 (커플)',
};

const HOTEL_GRADES = ['3성', '준4성', '4성', '준5성', '5성'];

const fmtKRW = (n: number) => `${(n / 10000).toFixed(1)}만`;

export default function ScoringAdminPage() {
  const [policy, setPolicy] = useState<ScoringPolicy | null>(null);
  const [rates, setRates] = useState<MarketRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [matching, setMatching] = useState(false);
  const [reliabilityFitting, setReliabilityFitting] = useState(false);
  const [unmapped, setUnmapped] = useState<Array<{ id: string; title: string }>>([]);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // 그룹 미리보기
  const [previewDest, setPreviewDest] = useState('');
  const [previewDate, setPreviewDate] = useState('');
  const [previewWindow, setPreviewWindow] = useState(3);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPolicyId, setPreviewPolicyId] = useState<string>('');
  const [allPolicies, setAllPolicies] = useState<Array<{ id: string; version: string; is_active: boolean; notes: string | null }>>([]);
  type PreviewItem = {
    package_id: string; title: string; departure_date: string | null;
    list_price: number; effective_price: number; topsis_score: number; rank: number;
    breakdown: { why: string[]; deductions: { free_options: number; hotel_premium: number; flight_premium: number; shopping_avoidance: number } };
    features: { shopping_count: number; hotel_avg_grade: number | null; meal_count: number; free_option_count: number; is_direct_flight: boolean };
  };
  const [previewResult, setPreviewResult] = useState<{ group_key: string; group_size: number; ranked: PreviewItem[] } | null>(null);

  // 폼 상태 (사용자가 편집 중인 값)
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [hotelPremium, setHotelPremium] = useState<Record<string, number>>({});
  const [flightDirect, setFlightDirect] = useState<number>(0);
  const [brandMaxBonus, setBrandMaxBonus] = useState<number>(60000);

  // 옵션 시장가 추가 폼
  const [newRateName, setNewRateName] = useState('');
  const [newRateDest, setNewRateDest] = useState('');
  const [newRateValue, setNewRateValue] = useState<number>(50000);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [polRes, rateRes, policiesRes] = await Promise.all([
        fetch('/api/admin/scoring/policy').then(r => r.json()),
        fetch('/api/admin/scoring/market-rates').then(r => r.json()),
        fetch('/api/admin/scoring/policies').then(r => r.json()),
      ]);
      if (polRes.policy) {
        setPolicy(polRes.policy);
        setWeights({ ...polRes.policy.weights });
        setHotelPremium({ ...polRes.policy.hotel_premium });
        setFlightDirect(polRes.policy.flight_premium?.direct ?? 0);
        setBrandMaxBonus(polRes.policy.hotel_brand_max_bonus ?? 60000);
      }
      setRates(rateRes.rates ?? []);
      setAllPolicies(policiesRes.policies ?? []);
    } catch {
      showToast('error', '로드 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);

  const handleSavePolicy = async () => {
    if (weightSum <= 0) { showToast('error', '가중치 합이 0입니다'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/admin/scoring/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weights,
          hotel_premium: hotelPremium,
          hotel_brand_max_bonus: brandMaxBonus,
          flight_premium: { direct: flightDirect, transit: 0 },
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? '저장 실패');
      setPolicy(j.policy);
      showToast('success', '정책 저장됨 (자동 정규화됨)');
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const handleRecompute = async () => {
    if (!confirm('전체 패키지 점수를 지금 재계산할까요? 1~2분 소요')) return;
    setRecomputing(true);
    try {
      const r = await fetch('/api/admin/scoring/recompute', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? '재계산 실패');
      showToast('success', `재계산 완료 — ${j.second.groups}개 그룹 / ${j.second.packages}개 상품 (${(j.ms / 1000).toFixed(1)}초)`);
      loadAll();
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : '재계산 실패');
    } finally {
      setRecomputing(false);
    }
  };

  const handleAddRate = async () => {
    if (!newRateName.trim()) { showToast('error', '옵션명 필수'); return; }
    try {
      const r = await fetch('/api/admin/scoring/market-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tour_name: newRateName.trim(),
          destination: newRateDest.trim() || null,
          market_rate_krw: newRateValue,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? '추가 실패');
      showToast('success', `${newRateName} 추가됨`);
      setNewRateName(''); setNewRateDest(''); setNewRateValue(50000);
      loadAll();
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : '추가 실패');
    }
  };

  const handleMatchLandOps = async () => {
    setMatching(true);
    try {
      const r = await fetch('/api/admin/scoring/match-land-operators', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? '매핑 실패');
      setUnmapped(j.unmapped_packages ?? []);
      showToast('success',
        `매핑 완료 — 부킹 ${j.matched_via_bookings}, 별칭 ${j.matched_via_aliases}, 미매핑 ${j.unmapped_count}/${j.total}`);
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : '매핑 실패');
    } finally {
      setMatching(false);
    }
  };

  const handleReliabilityFit = async () => {
    setReliabilityFitting(true);
    try {
      const r = await fetch('/api/admin/scoring/reliability', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? '신뢰도 산출 실패');
      showToast('success',
        `신뢰도 갱신 — ${j.operators_updated}/${j.operators_total} 갱신, ${j.operators_default_kept} 신상품(default)`);
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : '신뢰도 산출 실패');
    } finally {
      setReliabilityFitting(false);
    }
  };

  const handlePreview = async () => {
    if (!previewDest.trim()) { showToast('error', '목적지 필수'); return; }
    setPreviewLoading(true);
    try {
      const params = new URLSearchParams({ destination: previewDest.trim() });
      if (previewDate) params.set('departure_date', previewDate);
      params.set('window', String(previewWindow));
      params.set('limit', '10');
      if (previewPolicyId) params.set('policy_id', previewPolicyId);
      const r = await fetch(`/api/packages/recommend-best?${params.toString()}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? '조회 실패');
      setPreviewResult(j);
      if (!j.ranked?.length) showToast('error', '해당 그룹에 패키지가 없습니다');
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : '조회 실패');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDeleteRate = async (id: string) => {
    if (!confirm('삭제할까요?')) return;
    const r = await fetch(`/api/admin/scoring/market-rates/${id}`, { method: 'DELETE' });
    if (r.ok) { showToast('success', '삭제됨'); loadAll(); }
    else showToast('error', '삭제 실패');
  };

  if (loading) return <div className="p-8 text-sm text-slate-500">로딩 중...</div>;
  if (!policy) return <div className="p-8 text-sm text-red-600">활성 정책이 없습니다. 마이그레이션을 확인하세요.</div>;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <header>
        <h1 className="text-xl font-bold text-slate-900">패키지 점수 정책</h1>
        <p className="text-xs text-slate-500 mt-1">
          버전 <span className="font-mono">{policy.version}</span>
          {policy.updated_at && <span className="ml-2">· 수정 {new Date(policy.updated_at).toLocaleString('ko-KR')}</span>}
        </p>
      </header>

      {toast && (
        <div className={`fixed top-4 right-4 px-4 py-2 rounded-lg text-sm shadow-lg z-50 ${
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}>{toast.msg}</div>
      )}

      {/* 가중치 */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">기준 가중치 (10 axis)</h2>
          <p className="text-xs text-slate-500 mt-0.5">합이 1.0이 되도록 자동 정규화. base 6 + P1 4 (climate·popularity·korean_meal·free_time).</p>
        </div>

        {/* Base 6 */}
        <div>
          <p className="text-[11px] font-bold text-slate-700 mb-2">기본 axis</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {(['price', 'hotel', 'meal', 'free_options', 'shopping_avoidance', 'reliability'] as const).map(k => (
              <div key={k}>
                <label className="block text-xs text-slate-600 mb-1">
                  {WEIGHT_LABELS[k]}
                </label>
                <input
                  type="number" min={0} max={1} step={0.05}
                  className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"
                  value={weights[k] ?? 0}
                  onChange={e => setWeights({ ...weights, [k]: parseFloat(e.target.value) || 0 })}
                />
                <div className="text-[10px] text-slate-400 mt-0.5" title={WEIGHT_DESCRIPTIONS[k]}>
                  정규화 {weightSum > 0 ? ((weights[k] ?? 0) / weightSum * 100).toFixed(1) : '0.0'}% · {WEIGHT_DESCRIPTIONS[k]}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* P1 4 */}
        <div>
          <p className="text-[11px] font-bold text-violet-700 mb-2">P1 axis (Intent 정밀도)</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(['climate_fit', 'popularity', 'korean_meal', 'free_time'] as const).map(k => (
              <div key={k}>
                <label className="block text-xs text-violet-700 font-semibold mb-1">
                  {WEIGHT_LABELS[k]}
                </label>
                <input
                  type="number" min={0} max={1} step={0.025}
                  className="w-full text-sm border border-violet-200 bg-violet-50/30 rounded px-2 py-1.5"
                  value={weights[k] ?? 0}
                  onChange={e => setWeights({ ...weights, [k]: parseFloat(e.target.value) || 0 })}
                />
                <div className="text-[10px] text-slate-400 mt-0.5" title={WEIGHT_DESCRIPTIONS[k]}>
                  정규화 {weightSum > 0 ? ((weights[k] ?? 0) / weightSum * 100).toFixed(1) : '0.0'}% · {WEIGHT_DESCRIPTIONS[k]}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-xs text-slate-500">
          현재 합: {weightSum.toFixed(2)} (자동 정규화 후 1.00)
        </div>
      </section>

      {/* 5개 정책 weights 비교 그래프 */}
      <PolicyWeightsCompare />

      {/* 호텔 프리미엄 */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">호텔 등급별 등가 금액 (KRW)</h2>
          <p className="text-xs text-slate-500 mt-0.5">실효가격에서 차감되는 호텔 가치. 등급 높을수록 큰 값.</p>
        </div>
        <div className="grid grid-cols-5 gap-3">
          {HOTEL_GRADES.map(g => (
            <div key={g}>
              <label className="block text-xs text-slate-600 mb-1">{g}</label>
              <input
                type="number" min={0} step={10000}
                className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"
                value={hotelPremium[g] ?? 0}
                onChange={e => setHotelPremium({ ...hotelPremium, [g]: parseInt(e.target.value) || 0 })}
              />
              <div className="text-[10px] text-slate-400 mt-0.5">{fmtKRW(hotelPremium[g] ?? 0)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 브랜드 티어 보너스 */}
      <section className="bg-white border border-amber-200 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-amber-800">호텔 브랜드 보너스 상한 (KRW/박)</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            같은 성급 내 브랜드 tier에 따라 최대 이 금액만큼 추가 차감. 0 = 비활성화.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number" min={0} step={10000}
            className="w-40 text-sm border border-amber-300 rounded px-2 py-1.5"
            value={brandMaxBonus}
            onChange={e => setBrandMaxBonus(parseInt(e.target.value) || 0)}
          />
          <span className="text-xs text-slate-500">{fmtKRW(brandMaxBonus)}</span>
        </div>
        <div className="text-xs text-slate-500 bg-amber-50 rounded p-3 space-y-1">
          <p className="font-semibold text-amber-800">계산 예시 (5성, 기본 15만/박 기준)</p>
          {[
            { label: 'Aman / 아만 (1.0)', bonus: brandMaxBonus },
            { label: 'Four Seasons / 파크하얏트 (0.95)', bonus: Math.round((0.95 - 0.5) * brandMaxBonus * 2) },
            { label: 'JW Marriott / 콘래드 (0.85)', bonus: Math.round((0.85 - 0.5) * brandMaxBonus * 2) },
            { label: '일반 5성 (0.5, 미매칭)', bonus: 0 },
          ].map(({ label, bonus }) => (
            <div key={label} className="flex justify-between">
              <span>{label}</span>
              <span className="font-mono text-emerald-700">+{fmtKRW(bonus)} → {fmtKRW(150000 + bonus)}/박</span>
            </div>
          ))}
        </div>

        {/* 브랜드 티어 레퍼런스 테이블 */}
        <details className="mt-2">
          <summary className="text-xs text-amber-700 font-semibold cursor-pointer">브랜드 티어 테이블 보기 (읽기 전용)</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="bg-amber-50 text-amber-900">
                  <th className="text-left px-2 py-1.5 border border-amber-200">브랜드</th>
                  <th className="text-left px-2 py-1.5 border border-amber-200">적용 성급</th>
                  <th className="text-right px-2 py-1.5 border border-amber-200">within_star_score</th>
                  <th className="text-right px-2 py-1.5 border border-amber-200">보너스/박</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { brand: 'Aman / 아만', stars: '5성', score: 1.00 },
                  { brand: 'Six Senses / 식스센스', stars: '5성', score: 0.97 },
                  { brand: 'Park Hyatt / 파크하얏트', stars: '5성', score: 0.95 },
                  { brand: 'Four Seasons / 포시즌', stars: '5성', score: 0.95 },
                  { brand: 'Ritz-Carlton / 리츠칼튼', stars: '5성', score: 0.92 },
                  { brand: 'Mandarin Oriental / 만다린오리엔탈', stars: '5성', score: 0.90 },
                  { brand: 'St. Regis / 세인트레지스', stars: '5성', score: 0.88 },
                  { brand: 'Rosewood / 로즈우드', stars: '5성', score: 0.87 },
                  { brand: 'W Hotels / W호텔', stars: '4·5성', score: 0.85 },
                  { brand: 'Conrad / 콘래드', stars: '5성', score: 0.85 },
                  { brand: 'JW Marriott / JW메리어트', stars: '5성', score: 0.82 },
                  { brand: 'Westin / 웨스틴', stars: '4·5성', score: 0.80 },
                  { brand: 'Hyatt Regency / 하얏트리젠시', stars: '4·5성', score: 0.78 },
                  { brand: 'InterContinental / 인터컨티넨탈', stars: '4·5성', score: 0.78 },
                  { brand: 'Hilton / 힐튼', stars: '4·5성', score: 0.75 },
                  { brand: 'Sheraton Grand / 쉐라톤그랜드', stars: '5성', score: 0.72 },
                  { brand: 'Sofitel / 소피텔', stars: '4·5성', score: 0.70 },
                  { brand: 'Pullman / 풀만', stars: '4·5성', score: 0.68 },
                  { brand: 'Crowne Plaza / 크라운플라자', stars: '4·5성', score: 0.65 },
                  { brand: '일반 미매칭', stars: '전체', score: 0.50 },
                ].map(({ brand, stars, score }) => {
                  const bonus = score > 0.5 ? Math.round((score - 0.5) * brandMaxBonus * 2) : 0;
                  return (
                    <tr key={brand} className="even:bg-slate-50">
                      <td className="px-2 py-1 border border-slate-200">{brand}</td>
                      <td className="px-2 py-1 border border-slate-200 text-slate-500">{stars}</td>
                      <td className="px-2 py-1 border border-slate-200 text-right font-mono">{score.toFixed(2)}</td>
                      <td className="px-2 py-1 border border-slate-200 text-right font-mono text-emerald-700">
                        {bonus > 0 ? `+${fmtKRW(bonus)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {/* 직항 보너스 */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">직항 프리미엄 (KRW)</h2>
        <input
          type="number" min={0} step={10000}
          className="w-40 text-sm border border-slate-300 rounded px-2 py-1.5"
          value={flightDirect}
          onChange={e => setFlightDirect(parseInt(e.target.value) || 0)}
        />
        <span className="ml-2 text-xs text-slate-500">{fmtKRW(flightDirect)}</span>
      </section>

      {/* 헤도닉 (읽기 전용) */}
      <section className="bg-slate-50 border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-2">헤도닉 학습 (자동 갱신, 읽기 전용)</h2>
        <p className="text-xs text-slate-500 mb-3">매일 새벽 cron이 시장 데이터로 implicit price 자동 학습.</p>
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          <div>
            <dt className="text-slate-500">쇼핑 1회당 회피 가치</dt>
            <dd className="font-mono text-slate-900">{fmtKRW(policy.hedonic_coefs.shopping_per_count)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">식사 1회당 가치</dt>
            <dd className="font-mono text-slate-900">{fmtKRW(policy.hedonic_coefs.meal_per_count)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">호텔 등급 1단계당</dt>
            <dd className="font-mono text-slate-900">{fmtKRW(policy.hedonic_coefs.hotel_grade_step)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">출처</dt>
            <dd className="text-slate-900">{policy.hedonic_coefs.computed_from} · 표본 {policy.hedonic_coefs.sample_size}개</dd>
          </div>
          <div>
            <dt className="text-slate-500">마지막 학습</dt>
            <dd className="text-slate-900">{policy.hedonic_coefs.computed_at ? new Date(policy.hedonic_coefs.computed_at).toLocaleString('ko-KR') : '아직 없음'}</dd>
          </div>
        </dl>
      </section>

      {/* 액션 버튼 */}
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={handleSavePolicy} disabled={saving}
          className="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700 disabled:opacity-50"
        >{saving ? '저장 중...' : '정책 저장'}</button>
        <button
          onClick={handleRecompute} disabled={recomputing}
          className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50"
        >{recomputing ? '재계산 중...' : '지금 전체 재계산'}</button>
        <button
          onClick={handleMatchLandOps} disabled={matching}
          className="px-4 py-2 bg-sky-600 text-white text-sm rounded-lg hover:bg-sky-700 disabled:opacity-50"
        >{matching ? '매핑 중...' : '랜드사 자동 매핑'}</button>
        <button
          onClick={handleReliabilityFit} disabled={reliabilityFitting}
          className="px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 disabled:opacity-50"
        >{reliabilityFitting ? '계산 중...' : '신뢰도 갱신'}</button>
      </div>

      {/* 미매핑 패키지 리포트 */}
      {unmapped.length > 0 && (
        <section className="bg-yellow-50 border border-yellow-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-amber-900">매핑 미해결 패키지 ({unmapped.length}개)</h2>
          <p className="text-xs text-amber-800 mt-1 mb-3">랜드사를 어드민 패키지 페이지에서 수동 지정하세요.</p>
          <ul className="text-xs space-y-1 max-h-64 overflow-y-auto">
            {unmapped.map(p => (
              <li key={p.id} className="text-slate-700">
                <span className="font-mono text-[10px] text-slate-400">{p.id.slice(0, 8)}</span> {p.title}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 그룹 미리보기 — 정책 변경 효과 즉시 검증 */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">그룹 미리보기 (정책 시뮬레이션)</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            가중치 변경 후 같은 목적지·날짜 그룹에서 어떻게 순위가 바뀌는지 즉시 확인.
            ⚠ 어드민 전용 — 점수 숫자가 노출됩니다.
          </p>
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs text-slate-600 mb-1">목적지</label>
            <input value={previewDest} onChange={e => setPreviewDest(e.target.value)}
              placeholder="다낭 / 장가계 / 나트랑"
              className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"/>
          </div>
          <div className="w-44">
            <label className="block text-xs text-slate-600 mb-1">출발일 (선택)</label>
            <input type="date" value={previewDate} onChange={e => setPreviewDate(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"/>
          </div>
          <div className="w-24">
            <label className="block text-xs text-slate-600 mb-1">±일</label>
            <input type="number" min={0} max={30} value={previewWindow}
              onChange={e => setPreviewWindow(parseInt(e.target.value) || 0)}
              className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"/>
          </div>
          <button onClick={handlePreview} disabled={previewLoading}
            className="px-4 py-1.5 bg-slate-700 text-white text-sm rounded hover:bg-slate-800 disabled:opacity-50">
            {previewLoading ? '조회 중...' : '미리보기'}
          </button>
        </div>

        {allPolicies.length > 1 && (
          <div className="flex items-center gap-2 text-xs">
            <label className="text-slate-600">정책 (A/B 비교):</label>
            <select value={previewPolicyId} onChange={e => setPreviewPolicyId(e.target.value)}
              className="text-xs border border-slate-300 rounded px-2 py-1">
              <option value="">활성 정책 (default)</option>
              {allPolicies.map(p => (
                <option key={p.id} value={p.id}>
                  {p.version} {p.is_active ? '(active)' : '(shadow)'}
                </option>
              ))}
            </select>
          </div>
        )}

        {previewResult && previewResult.ranked.length > 0 && (
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-50 px-3 py-2 text-xs text-slate-600">
              그룹 <span className="font-mono">{previewResult.group_key}</span> · 총 {previewResult.group_size}개
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-2 py-2 text-center w-8">#</th>
                  <th className="px-2 py-2 text-left">상품명</th>
                  <th className="px-2 py-2 text-right">표시가</th>
                  <th className="px-2 py-2 text-right">실효가</th>
                  <th className="px-2 py-2 text-right">점수</th>
                  <th className="px-2 py-2 text-left">사유</th>
                </tr>
              </thead>
              <tbody>
                {previewResult.ranked.map(item => (
                  <tr key={item.package_id} className={`border-t border-slate-100 ${item.rank === 1 ? 'bg-amber-50' : ''}`}>
                    <td className="px-2 py-2 text-center font-bold">
                      {item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : item.rank}
                    </td>
                    <td className="px-2 py-2 text-slate-800">
                      <div>{item.title}</div>
                      <div className="text-[10px] text-slate-400">
                        {item.departure_date ?? '—'} · 호텔 {item.features.hotel_avg_grade?.toFixed(1) ?? '—'}성 ·
                        식 {item.features.meal_count} · 무료옵션 {item.features.free_option_count} ·
                        쇼핑 {item.features.shopping_count}회 {item.features.is_direct_flight && '· 직항'}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-slate-700">
                      {item.list_price.toLocaleString()}
                    </td>
                    <td className="px-2 py-2 text-right font-mono font-semibold text-slate-900">
                      {item.effective_price.toLocaleString()}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-violet-700">
                      {item.topsis_score.toFixed(3)}
                    </td>
                    <td className="px-2 py-2 text-[10px] text-slate-600">
                      {item.breakdown.why.slice(0, 3).join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 옵션 시장가 카탈로그 */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">옵션 시장가 카탈로그</h2>
          <p className="text-xs text-slate-500 mt-0.5">무료로 포함된 옵션의 시장가. 실효가격에서 차감되어 가성비 비교에 사용.</p>
        </div>

        {/* 추가 폼 */}
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-xs text-slate-600 mb-1">옵션명</label>
            <input value={newRateName} onChange={e => setNewRateName(e.target.value)}
              placeholder="예: 2층버스 시티투어"
              className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"/>
          </div>
          <div className="w-32">
            <label className="block text-xs text-slate-600 mb-1">목적지 (선택)</label>
            <input value={newRateDest} onChange={e => setNewRateDest(e.target.value)}
              placeholder="다낭"
              className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"/>
          </div>
          <div className="w-32">
            <label className="block text-xs text-slate-600 mb-1">시장가 (KRW)</label>
            <input type="number" min={0} step={10000} value={newRateValue}
              onChange={e => setNewRateValue(parseInt(e.target.value) || 0)}
              className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"/>
          </div>
          <button onClick={handleAddRate}
            className="px-3 py-1.5 bg-slate-700 text-white text-sm rounded hover:bg-slate-800">추가</button>
        </div>

        {/* 목록 */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">옵션명</th>
                <th className="px-3 py-2 text-left">목적지</th>
                <th className="px-3 py-2 text-right">시장가</th>
                <th className="px-3 py-2 text-left">출처</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rates.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400 text-xs">아직 등록된 시장가가 없습니다</td></tr>
              ) : rates.map(r => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-800">{r.tour_name}</td>
                  <td className="px-3 py-2 text-slate-600">{r.destination ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.market_rate_krw.toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{r.source}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => handleDeleteRate(r.id)}
                      className="text-xs text-red-600 hover:underline">삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
