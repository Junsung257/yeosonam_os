'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { TravelItinerary } from '@/types/itinerary';
import type { PriceListItem } from '@/lib/parser';
import PriceSectionCard from '@/components/lp/PriceSection';
import ItineraryTableView from '@/components/itinerary/ItineraryTableView';
import type { AttractionData } from '@/lib/attraction-matcher';
import { resolvePrimaryAttraction, type AttractionRefScheduleItem } from '@/lib/attraction-reference';
import { pickAttractionPhotoUrl } from '@/lib/image-url';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';

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

function collectAttractionIdsFromItinerary(itinerary: TravelItinerary | null | undefined): string[] {
  const out = new Set<string>();
  for (const day of itinerary?.days ?? []) {
    for (const item of day.schedule ?? []) {
      const ids = (item as unknown as { attraction_ids?: (string | null)[] }).attraction_ids ?? [];
      for (const id of ids) {
        if (typeof id === 'string' && id.trim()) out.add(id.trim());
      }
    }
  }
  return [...out];
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
  const [attractions, setAttractions] = useState<AttractionData[]>([]);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const cardRef = useRef<HTMLDivElement>(null);

  const toggleExpand = (key: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  useEffect(() => {
    fetch(`/api/packages?id=${id}`)
      .then(r => r.json())
      .then(async (d) => {
        const nextPkg: PackageData | null = d.package ?? null;
        setPkg(nextPkg);

        const attractionIds = Array.isArray(d.attraction_ids)
          ? d.attraction_ids.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
          : collectAttractionIdsFromItinerary(nextPkg?.itinerary_data ?? null);
        const attrUrl = attractionIds.length > 0
          ? `/api/attractions?ids=${encodeURIComponent(attractionIds.join(','))}`
          : '/api/attractions?detail=1';

        await fetch(attrUrl)
          .then(r => r.json())
          .then(a => setAttractions(a.attractions || []))
          .catch(() => {});
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

        {/* 항공편 카드 */}
        {(meta.flight_out || meta.flight_in) && (() => {
          // flight_out: "BX7315 22:00 - 01:00" or "BX371 09:00 → 11:20" 등
          const parseFlightStr = (str: string | null) => {
            if (!str) return null;
            const match = str.match(/^([A-Z]{2}\d{2,5})\s*(\d{1,2}:\d{2})\s*[-→~]\s*(\d{1,2}:\d{2})/);
            if (match) return { code: match[1], dep: match[2], arr: match[3] };
            const codeMatch = str.match(/([A-Z]{2}\d{2,5})/);
            return codeMatch ? { code: codeMatch[1], dep: '', arr: '' } : null;
          };
          const outFlight = parseFlightStr(meta.flight_out);
          const inFlight = parseFlightStr(meta.flight_in);
          const airlineName = meta.airline || '';
          const depAirport = meta.departure_airport || '';
          const destName = meta.destination || '';
          // 출발지 코드 추론
          const depCode = depAirport.includes('김해') || depAirport.includes('부산') ? 'PUS' :
                          depAirport.includes('인천') ? 'ICN' : depAirport.includes('김포') ? 'GMP' : '';
          // 도착지 코드 추론
          const DEST_CODES: Record<string, string> = {
            '오사카':'KIX','도쿄':'NRT','후쿠오카':'FUK','삿포로':'CTS','다낭':'DAD',
            '하노이':'HAN','호치민':'SGN','나트랑':'CXR','푸꾸옥':'PQC','방콕':'BKK',
            '세부':'CEB','마닐라':'MNL','발리':'DPS','싱가포르':'SIN','마카오':'MFM',
            '홍콩':'HKG','대만':'TPE','장가계':'DYG','청도':'TAO','연길':'YNJ',
            '괌':'GUM','라오스':'VTE','치앙마이':'CNX',
          };
          const destCode = Object.entries(DEST_CODES).find(([k]) => destName.includes(k))?.[1] || '';

          const FlightCard = ({ flight, fromName, fromCode, toName, toCode, label }: {
            flight: { code: string; dep: string; arr: string } | null;
            fromName: string; fromCode: string; toName: string; toCode: string; label: string;
          }) => {
            if (!flight) return null;
            return (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-medium text-gray-400">{label}</span>
                  {airlineName && (
                    <span className="text-xs text-blue-600 font-medium">{airlineName}</span>
                  )}
                  <span className="text-xs font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{flight.code}</span>
                </div>
                <div className="flex items-center gap-3">
                  {/* 출발 */}
                  <div className="text-center flex-shrink-0">
                    <p className="text-xl font-bold text-gray-900">{flight.dep || '--:--'}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{fromName}</p>
                    {fromCode && <p className="text-[10px] text-gray-400">({fromCode})</p>}
                  </div>
                  {/* 연결선 */}
                  <div className="flex-1 flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                    <div className="flex-1 border-t-2 border-dashed border-blue-300 relative">
                      {flight.dep && flight.arr && (() => {
                        const [dh, dm] = flight.dep.split(':').map(Number);
                        const [ah, am] = flight.arr.split(':').map(Number);
                        let diff = (ah * 60 + am) - (dh * 60 + dm);
                        if (diff < 0) diff += 24 * 60;
                        const hours = Math.floor(diff / 60);
                        const mins = diff % 60;
                        return (
                          <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] text-emerald-600 font-medium whitespace-nowrap">
                            {hours > 0 ? `${hours}시간 ` : ''}{mins > 0 ? `${mins}분` : ''} 소요
                          </span>
                        );
                      })()}
                    </div>
                    <div className="w-0 h-0 border-l-[6px] border-l-blue-500 border-y-[4px] border-y-transparent flex-shrink-0" />
                  </div>
                  {/* 도착 */}
                  <div className="text-center flex-shrink-0">
                    <p className="text-xl font-bold text-gray-900">{flight.arr || '--:--'}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{toName}</p>
                    {toCode && <p className="text-[10px] text-gray-400">({toCode})</p>}
                  </div>
                </div>
              </div>
            );
          };

          return (
            <div className="px-4 pt-4 space-y-3">
              <FlightCard flight={outFlight} fromName={depAirport || '출발지'} fromCode={depCode} toName={destName} toCode={destCode} label="가는편" />
              <FlightCard flight={inFlight} fromName={destName} fromCode={destCode} toName={depAirport || '도착지'} toCode={depCode} label="오는편" />
            </div>
          );
        })()}

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
                    {day.schedule.map((item, j) => {
                      const refItem = item as unknown as AttractionRefScheduleItem;
                      const attr = resolvePrimaryAttraction(refItem, attractions as AttractionData[], meta.destination);
                      const attractionNote =
                        (item as unknown as { attraction_note?: string | null }).attraction_note ?? null;
                      const displayPhotoUrls = (attr?.photos ?? [])
                        .slice(0, 3)
                        .map(ph => pickAttractionPhotoUrl([ph]))
                        .filter((u): u is string => u != null);
                      const hasPhotos = displayPhotoUrls.length > 0;
                      const expandKey = `${day.day}-${j}`;
                      const isExpanded = expandedItems.has(expandKey);
                      const bulletColor =
                        attr?.badge_type === 'special' ? 'bg-violet-500' :
                        attr?.badge_type === 'shopping' ? 'bg-purple-500' :
                        attr?.badge_type === 'meal' || attr?.badge_type === 'restaurant' ? 'bg-orange-500' :
                        attr?.badge_type === 'hotel' ? 'bg-brand/60' :
                        attr?.badge_type === 'golf' ? 'bg-emerald-500' :
                        item.type === 'flight' ? 'bg-blue-500' :
                        item.type === 'hotel' ? 'bg-green-500' :
                        item.type === 'optional' ? 'bg-pink-500' :
                        item.type === 'shopping' ? 'bg-purple-400' :
                        attr ? 'bg-blue-400' : 'bg-gray-300';

                      return (
                      <div key={j} className={`px-4 py-3 ${
                        item.type === 'optional' ? 'bg-orange-50/50' :
                        item.type === 'shopping' ? 'bg-purple-50/50' :
                        item.type === 'flight' ? 'bg-blue-50/50' :
                        item.type === 'hotel' ? 'bg-green-50/50' : ''
                      }`}>
                        {/* 활동명 행 */}
                        <div className="flex items-start gap-2.5">
                          <span className={`inline-block w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${bulletColor}`} />
                          <div className="flex-1 min-w-0">
                            {item.time && (
                              <span className="text-[11px] text-gray-400 block mb-0.5">{item.time}</span>
                            )}
                            <p className={`text-sm leading-snug ${
                              item.type === 'flight' ? 'text-blue-700 font-medium' :
                              item.type === 'hotel' ? 'text-green-700' : 'text-gray-800'
                            }`}>
                              {item.transport && item.type === 'flight' && (
                                <span className="text-xs font-mono bg-blue-100 text-blue-700 px-1 rounded mr-1">{item.transport}</span>
                              )}
                              {item.activity}
                            </p>
                            {item.note && <p className="text-[11px] text-gray-400 mt-0.5">{item.note}</p>}
                          </div>
                        </div>

                        {/* 매칭된 관광지 블록 (하나투어 스타일) */}
                        {attr && (
                          <div className="ml-[18px] mt-2">
                            {/* 1. 관광지명 */}
                            <p className="font-bold text-[14px] text-blue-900">{attr.name}</p>
                            {/* 2. 한줄설명 */}
                            {(attr.short_desc || attractionNote) && (
                              <p className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">
                                {attr.short_desc || attractionNote}
                              </p>
                            )}
                            {/* 3. 사진 3장 그리드 */}
                            {hasPhotos && (
                              <div className="grid grid-cols-3 gap-1 rounded-xl overflow-hidden mt-2">
                                {displayPhotoUrls.map((url, pIdx) => (
                                  <SafeCoverImg
                                    key={`${url}-${pIdx}`}
                                    src={url}
                                    alt={attr.name}
                                    className="w-full h-24 object-cover"
                                    loading="lazy"
                                    fallback={<div className="w-full h-24 bg-gray-100" aria-hidden />}
                                  />
                                ))}
                              </div>
                            )}
                            {/* 4. 상세보기 버튼 */}
                            {attr.long_desc && (
                              <button
                                onClick={() => toggleExpand(expandKey)}
                                className="flex items-center gap-1 text-left group mt-1.5"
                              >
                                <span className="text-[13px] text-blue-900 group-hover:text-blue-700 font-medium">
                                  {attr.name}
                                </span>
                                <span className={`text-gray-400 text-sm transition-transform ${isExpanded ? 'rotate-90' : ''}`}>›</span>
                              </button>
                            )}
                            {/* 배지 */}
                            {attr.badge_type && attr.badge_type !== 'tour' && (
                              <span className={`inline-block mt-1.5 text-[10px] px-2 py-0.5 rounded font-medium border ${
                                attr.badge_type === 'special' ? 'border-violet-300 text-violet-700 bg-violet-50' :
                                attr.badge_type === 'shopping' ? 'border-purple-300 text-purple-700 bg-purple-50' :
                                attr.badge_type === 'optional' ? 'border-pink-300 text-pink-700 bg-pink-50' :
                                attr.badge_type === 'restaurant' ? 'border-orange-300 text-orange-700 bg-orange-50' :
                                attr.badge_type === 'hotel' ? 'border-blue-200 text-[#1B64DA] bg-brand-light' :
                                attr.badge_type === 'golf' ? 'border-emerald-300 text-emerald-700 bg-emerald-50' :
                                'border-gray-300 text-gray-600 bg-gray-50'
                              }`}>{
                                attr.badge_type === 'special' ? '스페셜포함' :
                                attr.badge_type === 'shopping' ? '쇼핑' :
                                attr.badge_type === 'optional' ? '선택관광' :
                                attr.badge_type === 'restaurant' ? '특식' :
                                attr.badge_type === 'hotel' ? '숙소' :
                                attr.badge_type === 'golf' ? '골프' : attr.badge_type
                              }</span>
                            )}
                            {/* 상세설명 (클릭 시 펼치기) */}
                            {isExpanded && attr.long_desc && (
                              <p className="text-[12px] text-gray-600 mt-2 leading-relaxed bg-gray-50 rounded-lg p-3">
                                {attr.long_desc}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      );
                    })}
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
