'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { TravelItinerary } from '@/types/itinerary';
import type { PriceListItem } from '@/lib/parser';
import PriceSectionCard from '@/components/lp/PriceSection';
import ItineraryTableView from '@/components/itinerary/ItineraryTableView';

interface PriceTier {
  departure_day: string;
  departure_dates: string[];
  adult_price: number;
  status: string;
  note: string | null;
}

interface PackageData {
  id: string;
  title: string;
  itinerary_data: TravelItinerary | null;
  price_tiers: PriceTier[] | null;
  price_list?: PriceListItem[] | null;
  single_supplement?: string | null;
  guide_tip?: string | null;
}

/** Backward compat: price_tiers(구조) → PriceListItem[] 변환 */
function tiersToList(tiers: PriceTier[]): PriceListItem[] {
  return tiers.map(t => ({
    period: t.departure_day ? `매주 ${t.departure_day}요일` : t.departure_dates.join(', ') + '일',
    rules: [{
      condition:  t.departure_dates.length > 0 ? t.departure_dates.join(', ') + '일' : '전 출발일',
      price_text: t.adult_price ? t.adult_price.toLocaleString('ko-KR') + '원' : '문의',
      price:      t.adult_price ?? null,
      badge:      t.status === 'confirmed' ? '확정'
                : t.status === 'soldout'   ? '마감'
                : null,
    }],
    notes: t.note ?? null,
  }));
}

const DAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function formatKoDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}(${DAYS_KO[d.getDay()]})`;
}

function formatPrice(n: number) {
  return n.toLocaleString('ko-KR') + '원';
}

export default function ItineraryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [pkg, setPkg] = useState<PackageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'schedule' | 'info'>('overview');
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/packages?id=${id}`)
      .then(r => r.json())
      .then(d => {
        setPkg(d.package ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const handleGenerateImage = async () => {
    setGenerating(true);
    try {
      // 인쇄형(table) → Puppeteer API / 모바일형(card) → html2canvas
      if (tab === 'schedule' && viewMode === 'table') {
        const res = await fetch(`/api/itinerary/${id}/screenshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'detail', departureDate: selectedDate || undefined }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        data.jpgs.forEach((base64: string, idx: number) => {
          const link = document.createElement('a');
          link.href = `data:image/jpeg;base64,${base64}`;
          const label = idx === 0 ? '요금표' : '일정표';
          const dateStr = selectedDate ? `_${selectedDate}` : '';
          link.download = `${pkg?.title ?? '일정표'}${dateStr}_${label}.jpg`;
          link.click();
        });
      } else if (tab === 'schedule' && viewMode === 'card' && cardRef.current) {
        const html2canvas = (await import('html2canvas')).default;
        const canvas = await html2canvas(cardRef.current, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#f9fafb',
        });
        const link = document.createElement('a');
        const dateStr = selectedDate ? `_${selectedDate}` : '';
        link.href = canvas.toDataURL('image/jpeg', 0.92);
        link.download = `${pkg?.title ?? '일정표'}${dateStr}_일정표.jpg`;
        link.click();
      } else {
        // 기본: Puppeteer (요금표/포함불포함 탭)
        const res = await fetch(`/api/itinerary/${id}/screenshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'detail', departureDate: selectedDate || undefined }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        data.jpgs.forEach((base64: string, idx: number) => {
          const link = document.createElement('a');
          link.href = `data:image/jpeg;base64,${base64}`;
          const label = idx === 0 ? '요금표' : '일정표';
          const dateStr = selectedDate ? `_${selectedDate}` : '';
          link.download = `${pkg?.title ?? '일정표'}${dateStr}_${label}.jpg`;
          link.click();
        });
      }
    } catch (err) {
      alert('이미지 생성 실패: ' + (err instanceof Error ? err.message : '오류'));
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">일정표 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (!pkg || !pkg.itinerary_data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-700 mb-2">일정표를 찾을 수 없습니다</p>
          <p className="text-sm text-gray-400 mb-4">상품 ID: {id}</p>
          <button onClick={() => router.back()} className="text-blue-600 text-sm">← 돌아가기</button>
        </div>
      </div>
    );
  }

  const { itinerary_data: it, price_tiers: tiers } = pkg;
  const { meta, highlights, days, optional_tours } = it;

  // 선택 날짜의 확정 가격 찾기
  let confirmedPrice: number | null = null;
  if (selectedDate && tiers) {
    const day = new Date(selectedDate).getDate().toString();
    const tier = tiers.find(t => t.departure_dates.includes(day));
    confirmedPrice = tier?.adult_price ?? null;
  }

  const minPrice = tiers ? Math.min(...tiers.map(t => t.adult_price)) : null;
  const maxPrice = tiers ? Math.max(...tiers.map(t => t.adult_price)) : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-500 text-lg">←</button>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-gray-900 text-sm truncate">{meta.title}</h1>
            <p className="text-xs text-gray-400">{meta.nights}박{meta.days}일 · {meta.destination}</p>
          </div>
          <a
            href={`/itinerary/${id}/print?mode=detail${selectedDate ? `&date=${selectedDate}` : ''}`}
            target="_blank"
            className="text-xs text-blue-600 border border-blue-300 rounded-lg px-2 py-1"
          >
            A4 보기
          </a>
        </div>
      </div>

      <div className="max-w-lg mx-auto pb-32">
        {/* 히어로 배너 */}
        <div className="bg-gradient-to-br from-blue-700 to-blue-900 text-white px-5 py-6">
          {meta.product_type && (
            <span className="text-xs bg-white/20 rounded px-2 py-0.5 mb-2 inline-block">
              {meta.product_type}
            </span>
          )}
          <h2 className="text-xl font-bold mb-1">{meta.title}</h2>
          <p className="text-blue-200 text-sm mb-3">
            {meta.departure_airport && `${meta.departure_airport} 출발 · `}
            {meta.airline && `${meta.airline} · `}
            최소 {meta.min_participants}명
          </p>
          {minPrice && maxPrice && (
            <p className="text-white font-semibold">
              {minPrice === maxPrice
                ? formatPrice(minPrice)
                : `${formatPrice(minPrice)} ~ ${formatPrice(maxPrice)}`}
              <span className="text-blue-200 text-xs ml-1">/ 1인</span>
            </p>
          )}
          {meta.hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {meta.hashtags.map((tag, i) => (
                <span key={i} className="text-xs bg-white/15 rounded-full px-2 py-0.5">{tag}</span>
              ))}
            </div>
          )}
        </div>

        {/* 탭 */}
        <div className="bg-white border-b border-gray-200 flex">
          {(['overview', 'schedule', 'info'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium transition ${
                tab === t ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'
              }`}
            >
              {t === 'overview' ? '요금표' : t === 'schedule' ? '일정표' : '포함/불포함'}
            </button>
          ))}
        </div>

        {/* 요금표 탭 */}
        {tab === 'overview' && (
          <div className="space-y-0">
            {meta.ticketing_deadline && (
              <div className="mx-4 mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                ⚠️ {meta.ticketing_deadline} 항공권 발권조건
              </div>
            )}
            <PriceSectionCard
              title={meta.title}
              destination={meta.destination}
              priceList={
                // 우선순위: DB price_list → tiers 변환 폴백 → 빈 배열
                (pkg.price_list && pkg.price_list.length > 0)
                  ? pkg.price_list
                  : tiers && tiers.length > 0
                    ? tiersToList(tiers)
                    : []
              }
              singleSupplement={pkg.single_supplement ?? undefined}
              guideTrip={pkg.guide_tip ?? undefined}
            />
          </div>
        )}

        {/* 일정표 탭 */}
        {tab === 'schedule' && (
          <div className="p-4 space-y-3">
            {/* 뷰 모드 토글 */}
            <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm shadow-sm">
              <button
                onClick={() => setViewMode('card')}
                className={`flex-1 py-2.5 font-medium transition ${
                  viewMode === 'card'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                📱 모바일형
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`flex-1 py-2.5 font-medium transition ${
                  viewMode === 'table'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                🖨️ 인쇄형 (A4)
              </button>
            </div>

            {/* ── 인쇄형 테이블 뷰 ── */}
            {viewMode === 'table' && (
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white p-4">
                <ItineraryTableView
                  itinerary={it}
                  departureDate={selectedDate}
                  confirmedPrice={confirmedPrice}
                />
              </div>
            )}

            {/* ── 모바일 카드 뷰 ── */}
            {viewMode === 'card' && (
            <div ref={cardRef} className="space-y-3">
            {days.map((day, i) => {
              const resolvedDate = selectedDate ? addDays(selectedDate, i) : null;
              return (
                <div key={day.day} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 bg-blue-600 text-white flex items-center justify-between">
                    <span className="font-bold text-sm">Day {day.day}</span>
                    <span className="text-blue-200 text-xs">
                      {resolvedDate ? formatKoDate(resolvedDate) : day.regions.join(' → ')}
                    </span>
                  </div>
                  {/* 식사 */}
                  <div className="px-4 py-2 border-b border-gray-50 flex gap-3 text-xs text-gray-500">
                    <span className={day.meals.breakfast ? 'text-gray-800 font-medium' : 'line-through'}>
                      조식{day.meals.breakfast && day.meals.breakfast_note ? ` (${day.meals.breakfast_note})` : ''}
                    </span>
                    <span className={day.meals.lunch ? 'text-gray-800 font-medium' : 'line-through'}>
                      중식{day.meals.lunch && day.meals.lunch_note ? ` (${day.meals.lunch_note})` : ''}
                    </span>
                    <span className={day.meals.dinner ? 'text-gray-800 font-medium' : 'line-through'}>
                      석식{day.meals.dinner && day.meals.dinner_note ? ` (${day.meals.dinner_note})` : ''}
                    </span>
                  </div>
                  {/* 일정 항목 */}
                  <div className="divide-y divide-gray-50">
                    {day.schedule.map((item, j) => (
                      <div key={j} className={`px-4 py-2.5 flex gap-3 ${
                        item.type === 'optional' ? 'bg-orange-50' :
                        item.type === 'shopping' ? 'bg-purple-50' :
                        item.type === 'flight' ? 'bg-blue-50' :
                        item.type === 'hotel' ? 'bg-green-50' : ''
                      }`}>
                        {item.time && (
                          <span className="text-xs text-gray-400 w-12 flex-shrink-0 pt-0.5">{item.time}</span>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${
                            item.type === 'optional' ? 'text-orange-700' :
                            item.type === 'flight' ? 'text-blue-700 font-medium' :
                            item.type === 'hotel' ? 'text-green-700' : 'text-gray-800'
                          }`}>
                            {item.transport && item.type === 'flight' && (
                              <span className="text-xs font-mono bg-blue-100 text-blue-700 px-1 rounded mr-1">{item.transport}</span>
                            )}
                            {item.activity}
                          </p>
                          {item.note && <p className="text-xs text-gray-400 mt-0.5">{item.note}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* 호텔 */}
                  {day.hotel && (
                    <div className="px-4 py-2 bg-green-50 border-t border-green-100 flex items-center gap-2">
                      <span className="text-green-700 text-xs">🏨</span>
                      <span className="text-xs text-green-800">
                        {day.hotel.name}
                        {day.hotel.grade && ` (${day.hotel.grade})`}
                        {day.hotel.note && ` ${day.hotel.note}`}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}

            {/* 선택관광 */}
            {optional_tours.length > 0 && (
              <div className="bg-white rounded-xl border border-orange-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-orange-100">
                  <h3 className="font-semibold text-sm text-orange-800">선택관광 (별도판매가)</h3>
                </div>
                <div className="divide-y divide-orange-50">
                  {optional_tours.map((tour, i) => (
                    <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                      <span className="text-sm text-gray-800">{tour.name}</span>
                      <div className="text-right">
                        {tour.price_krw && (
                          <span className="text-sm font-semibold text-orange-700">₩{tour.price_krw.toLocaleString()}</span>
                        )}
                        {tour.price_usd && (
                          <span className="text-sm font-semibold text-orange-700">${tour.price_usd}</span>
                        )}
                        {tour.note && <p className="text-xs text-gray-400">{tour.note}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            </div>
            )}
          </div>
        )}

        {/* 포함/불포함 탭 */}
        {tab === 'info' && (
          <div className="p-4 space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="font-semibold text-sm text-green-700">✅ 포함내역</h3>
              </div>
              <ul className="divide-y divide-gray-50">
                {highlights.inclusions.map((item, i) => (
                  <li key={i} className="px-4 py-2.5 text-sm text-gray-700">{item}</li>
                ))}
              </ul>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="font-semibold text-sm text-red-600">❌ 불포함내역</h3>
              </div>
              <ul className="divide-y divide-gray-50">
                {highlights.excludes.map((item, i) => (
                  <li key={i} className="px-4 py-2.5 text-sm text-gray-700">{item}</li>
                ))}
              </ul>
            </div>

            {highlights.shopping && (
              <div className="bg-white rounded-xl border border-purple-200 p-4">
                <p className="text-sm font-semibold text-purple-700 mb-1">🛍 쇼핑</p>
                <p className="text-sm text-gray-700">{highlights.shopping}</p>
              </div>
            )}

            {highlights.remarks.length > 0 && (
              <div className="bg-amber-50 rounded-xl border border-amber-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-amber-100">
                  <h3 className="font-semibold text-sm text-amber-800">⚠️ 비고 / RMK</h3>
                </div>
                <ul className="divide-y divide-amber-50">
                  {highlights.remarks.map((item, i) => (
                    <li key={i} className="px-4 py-2.5 text-sm text-amber-900">{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 하단 고정 바 — 날짜 선택 + 이미지 생성 */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 safe-area-bottom">
        <div className="max-w-lg mx-auto space-y-2">
          <div className="flex gap-2">
            <input
              type="date"
              value={selectedDate || ''}
              onChange={e => setSelectedDate(e.target.value || null)}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="출발일 선택 (선택사항)"
            />
            {confirmedPrice && (
              <div className="flex-shrink-0 bg-blue-50 rounded-lg px-3 py-2 text-sm font-semibold text-blue-700 flex items-center">
                {formatPrice(confirmedPrice)}
              </div>
            )}
          </div>
          <button
            onClick={handleGenerateImage}
            disabled={generating}
            className="w-full bg-blue-600 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {generating ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                이미지 생성 중...
              </>
            ) : (
              tab === 'schedule' && viewMode === 'card'
              ? `📸 카드 저장${selectedDate ? ` (${formatKoDate(selectedDate)})` : ''}`
              : `📄 A4 이미지 생성${selectedDate ? ` (${formatKoDate(selectedDate)})` : ''}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
