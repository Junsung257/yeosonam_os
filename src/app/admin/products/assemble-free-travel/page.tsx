'use client';

/**
 * 반자유여행 조립기 PoC
 *
 * Step 1: 도시 + 날짜 + 인원 입력 → MRT 검색
 * Step 2: 호텔 1개 + 액티비티 N개 선택 (CS 필터 뱃지)
 * Step 3: 가격 설정 + 확인 → 상품 등록
 */

import { useState, useCallback } from 'react';
import type { StayResult, ActivityResult, FlightResult } from '@/lib/travel-providers/types';

// ─── 타입 ────────────────────────────────────────────────────────────────────

const CS_MIN_RATING  = 4.5;
const CS_MIN_REVIEWS = 100;

function csOk(item: StayResult | ActivityResult): boolean {
  const rating = item.rating;
  const count  = item.reviewCount;
  if (rating !== undefined && rating < CS_MIN_RATING)  return false;
  if (count  !== undefined && count  < CS_MIN_REVIEWS) return false;
  return true;
}

// ─── 서브 컴포넌트 ────────────────────────────────────────────────────────────

function CsBadge({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full ${ok ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-500'}`}>
      {ok ? '✓ CS' : '✗ CS'}
    </span>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
            i + 1 < current ? 'bg-blue-600 border-blue-600 text-white' :
            i + 1 === current ? 'bg-blue-600 border-blue-600 text-white' :
            'bg-white border-gray-300 text-gray-400'
          }`}>{i + 1 < current ? '✓' : i + 1}</div>
          {i < total - 1 && <div className={`w-8 h-0.5 ${i + 1 < current ? 'bg-blue-600' : 'bg-gray-200'}`} />}
        </div>
      ))}
    </div>
  );
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────────────────────

export default function AssembleFreeTravelPage() {
  const [step, setStep]   = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Step 1 입력
  const [city, setCity]           = useState('');
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');
  const [adults, setAdults]       = useState(2);
  const [children, setChildren]   = useState(0);

  // Step 2 결과 + 선택
  const [hotels, setHotels]           = useState<StayResult[]>([]);
  const [activities, setActivities]   = useState<ActivityResult[]>([]);
  const [selectedHotel, setSelectedHotel]     = useState<StayResult | null>(null);
  const [selectedActs, setSelectedActs]       = useState<Set<string>>(new Set());
  const [selectedFlight, setSelectedFlight]   = useState<FlightResult | null>(null);

  // Step 3 설정
  const [margin, setMargin]   = useState(10);
  const [registered, setRegistered] = useState<{ internal_code: string; title: string } | null>(null);

  const nights = dateFrom && dateTo
    ? Math.max(1, Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400_000))
    : 3;

  // Step 1 → 2: 검색
  const handleSearch = useCallback(async () => {
    if (!city.trim() || !dateFrom || !dateTo) {
      setError('도시, 날짜 모두 입력해주세요.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [hotelsRes, actsRes] = await Promise.all([
        fetch(`/api/travel/search-stays?keyword=${encodeURIComponent(city)}&checkIn=${dateFrom}&checkOut=${dateTo}&adults=${adults}`),
        fetch(`/api/travel/search-activities?destination=${encodeURIComponent(city)}&limit=20`),
      ]);
      const hotelJson = await hotelsRes.json() as { results?: StayResult[] };
      const actJson   = await actsRes.json()   as { results?: ActivityResult[] };
      setHotels(hotelJson.results ?? []);
      setActivities(actJson.results ?? []);
      setSelectedHotel(null);
      setSelectedActs(new Set());
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : '검색 실패');
    } finally {
      setLoading(false);
    }
  }, [city, dateFrom, dateTo, adults]);

  const toggleActivity = (id: string) => {
    setSelectedActs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });
  };

  // Step 3 → 완료: 상품 등록
  const handleRegister = useCallback(async () => {
    if (!selectedHotel) return;
    const selectedActsList = activities.filter(a => selectedActs.has(a.providerId));
    if (selectedActsList.length === 0) {
      setError('투어/액티비티를 1개 이상 선택해주세요.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/products/assemble-free-travel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: city,
          nights,
          adults,
          children,
          dateFrom,
          dateTo,
          hotel:      selectedHotel,
          activities: selectedActsList,
          flight:     selectedFlight ?? undefined,
          margin,
        }),
      });
      const json = await res.json() as {
        ok?: boolean;
        product?: { internal_code: string; title: string };
        error?: string;
        existing_code?: string;
      };
      if (!res.ok) throw new Error(json.error ?? '등록 실패');
      setRegistered(json.product ?? null);
      setStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : '등록 실패');
    } finally {
      setLoading(false);
    }
  }, [selectedHotel, selectedActs, activities, city, nights, adults, children, dateFrom, dateTo, selectedFlight, margin]);

  // 가격 미리보기
  const hotelPrice   = (selectedHotel?.pricePerNight ?? 0) * nights * adults;
  const actsPrice    = activities
    .filter(a => selectedActs.has(a.providerId))
    .reduce((s, a) => s + (a.price ?? 0) * adults, 0);
  const basePrice    = hotelPrice + actsPrice;
  const sellingPrice = Math.ceil(basePrice * (1 + margin / 100) / 10000) * 10000;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">반자유여행 조립기</h1>
      <p className="text-sm text-gray-500 mb-6">MRT 호텔 + 투어를 조합해 반자유여행 상품을 조립합니다. CS 필터 (평점 4.5↑ + 리뷰 100↑) 강제.</p>

      <StepIndicator current={step} total={3} />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-4">{error}</div>
      )}

      {/* ── Step 1: 입력 ── */}
      {step === 1 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-gray-800">1단계: 여행 정보 입력</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">목적지 도시</label>
              <input
                value={city}
                onChange={e => setCity(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
                placeholder="예: 다낭, 방콕, 나트랑"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">출발일</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">귀국일</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">성인</label>
              <input type="number" min={1} max={20} value={adults} onChange={e => setAdults(parseInt(e.target.value, 10))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">아동</label>
              <input type="number" min={0} max={10} value={children} onChange={e => setChildren(parseInt(e.target.value, 10))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
            </div>
          </div>
          <button
            onClick={handleSearch}
            disabled={loading || !city.trim() || !dateFrom || !dateTo}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50 hover:bg-blue-700"
          >
            {loading ? '검색 중...' : '호텔 + 액티비티 검색'}
          </button>
        </div>
      )}

      {/* ── Step 2: 선택 ── */}
      {step === 2 && (
        <div className="space-y-5">
          {/* 호텔 */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-800">호텔 선택 (1개)</h2>
              <span className="text-xs text-gray-500">{hotels.length}건</span>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {hotels.map((h, i) => {
                const ok = csOk(h);
                const sel = selectedHotel?.providerId === h.providerId;
                return (
                  <button
                    key={i}
                    onClick={() => ok && setSelectedHotel(h)}
                    disabled={!ok}
                    className={`w-full text-left p-3 rounded-xl border transition-all flex items-center gap-3 ${
                      sel ? 'border-blue-500 bg-blue-50' : ok ? 'border-gray-200 hover:border-blue-300' : 'border-gray-100 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    {h.imageUrl && <img src={h.imageUrl} alt={h.name} className="w-14 h-14 rounded-lg object-cover shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900 leading-tight">{h.name}</p>
                        <CsBadge ok={ok} />
                        {sel && <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full">선택됨</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                        {h.rating != null && <span>★{h.rating.toFixed(1)}</span>}
                        {h.reviewCount && <span>리뷰 {h.reviewCount.toLocaleString()}건</span>}
                        <span className="text-blue-600 font-medium">{h.pricePerNight.toLocaleString()}원/박</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 액티비티 */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-800">액티비티 선택 (최대 5개)</h2>
              <span className="text-xs text-gray-500">{selectedActs.size}/5 선택됨</span>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {activities.map((a, i) => {
                const ok  = csOk(a);
                const sel = selectedActs.has(a.providerId);
                return (
                  <button
                    key={i}
                    onClick={() => ok && toggleActivity(a.providerId)}
                    disabled={!ok || (!sel && selectedActs.size >= 5)}
                    className={`w-full text-left p-3 rounded-xl border transition-all flex items-center gap-3 ${
                      sel ? 'border-blue-500 bg-blue-50' : ok && selectedActs.size < 5 ? 'border-gray-200 hover:border-blue-300' : 'border-gray-100 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    {a.imageUrl && <img src={a.imageUrl} alt={a.name} className="w-12 h-12 rounded-lg object-cover shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900 leading-tight line-clamp-1">{a.name}</p>
                        <CsBadge ok={ok} />
                        {sel && <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full">선택됨</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                        {a.rating != null && <span>★{a.rating.toFixed(1)}</span>}
                        {a.duration && <span>{a.duration}</span>}
                        <span className="text-blue-600 font-medium">{a.price.toLocaleString()}원~</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(1)} className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50">
              이전
            </button>
            <button
              onClick={() => { setError(null); setStep(3); }}
              disabled={!selectedHotel || selectedActs.size === 0}
              className="flex-2 flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-blue-700"
            >
              다음 — 가격 설정
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: 가격 + 확인 ── */}
      {step === 3 && selectedHotel && (
        <div className="space-y-4">
          {/* 선택 요약 */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-800 mb-3">3단계: 가격 설정 + 등록</h2>

            <div className="bg-gray-50 rounded-lg p-4 space-y-1.5 text-sm mb-4">
              <div className="flex justify-between">
                <span className="text-gray-600">호텔 ({nights}박)</span>
                <span className="font-medium">{hotelPrice.toLocaleString()}원</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">투어/액티비티 ({selectedActs.size}건)</span>
                <span className="font-medium">{actsPrice.toLocaleString()}원</span>
              </div>
              <div className="flex justify-between text-gray-400 text-xs">
                <span>기준: 성인 {adults}명</span>
              </div>
              <div className="border-t border-gray-200 pt-1.5 flex justify-between">
                <span className="text-gray-600">합산 원가</span>
                <span className="font-semibold">{basePrice.toLocaleString()}원</span>
              </div>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <label className="text-sm font-medium text-gray-700 shrink-0">마진율 (%)</label>
              <input
                type="number"
                min={0}
                max={50}
                value={margin}
                onChange={e => setMargin(Math.max(0, Math.min(50, parseInt(e.target.value, 10) || 0)))}
                className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
              <span className="text-sm text-gray-500">→</span>
              <span className="text-lg font-extrabold text-blue-600 tabular-nums">{sellingPrice.toLocaleString()}원</span>
            </div>

            <div className="border-t border-gray-100 pt-3 space-y-1 text-xs text-gray-500">
              <p>호텔: {selectedHotel.name} ★{selectedHotel.rating?.toFixed(1)} — {(selectedHotel.pricePerNight).toLocaleString()}원/박</p>
              {activities
                .filter(a => selectedActs.has(a.providerId))
                .map((a, i) => <p key={i}>투어 {i + 1}: {a.name} — {a.price.toLocaleString()}원/인</p>)
              }
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50">
              이전
            </button>
            <button
              onClick={handleRegister}
              disabled={loading}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-blue-700"
            >
              {loading ? '등록 중...' : '상품 등록'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: 완료 ── */}
      {step === 4 && registered && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
          <div className="text-4xl mb-3">✅</div>
          <h2 className="text-lg font-bold text-green-800 mb-1">상품 등록 완료</h2>
          <p className="text-sm text-green-700 mb-1">코드: <span className="font-mono font-bold">{registered.internal_code}</span></p>
          <p className="text-sm text-gray-600 mb-4">{registered.title}</p>
          <div className="flex gap-3 justify-center">
            <a href="/admin/products" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">
              상품 관리
            </a>
            <button
              onClick={() => { setStep(1); setRegistered(null); setCity(''); setDateFrom(''); setDateTo(''); setSelectedHotel(null); setSelectedActs(new Set()); }}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50"
            >
              다시 조립
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
