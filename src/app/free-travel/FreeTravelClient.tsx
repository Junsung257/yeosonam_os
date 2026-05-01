'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import type { FlightResult, StayResult, ActivityResult } from '@/lib/travel-providers/types';

// ─── 타입 ────────────────────────────────────────────────────────────────────

interface ComparisonPackage {
  id: string;
  title: string;
  price: number;
  highlights: string[];
  savings: number;
}

interface ComparisonData {
  totalMin: number;
  totalMax: number;
  available: boolean;
  packages: ComparisonPackage[];
  message: string;
  quoteBreakdown?: {
    flights: number;
    hotels: number;
    activities: number;
    hotelNightlyAverage: number;
    occupancyRooms: number;
  };
}

interface SearchParams {
  departure:       string;
  destination:     string;
  destinationIata?: string;
  nights:          number;
  adults:          number;
  children:        number;
  dateFrom:        string;
  dateTo:          string;
  skipFlights?:    boolean;
  companionType?:  string | null;
  hotelBudgetBand?: string | null;
  travelPace?: string | null;
}

interface FareCalendarEntry {
  date:  string;
  price: number;
}

interface PromotionAirline {
  airline:      string;
  iata?:        string;
  discountRate?: number;
  providerUrl?: string;
  imageUrl?:    string;
}

interface StayDetailPanel {
  description?:       string;
  amenities?:         string[];
  checkInTime?:       string;
  checkOutTime?:      string;
  cancellationPolicy?: string;
}

interface TnaDetailPanel {
  description?: string;
  includes?:    string[];
  meetingPoint?: string;
}

interface TnaOptionItem {
  optionId:    string;
  name:        string;
  price:       number;
  adultPrice?: number;
  childPrice?: number;
  available?:  boolean;
  currency?:   string;
}

interface SearchState {
  status: 'idle' | 'searching' | 'done' | 'error';
  statusMessage: string;
  requestId: string | null;
  params: SearchParams | null;
  flights: FlightResult[];
  hotels: StayResult[];
  activities: ActivityResult[];
  hotelsEstimated: boolean;
  activitiesEstimated: boolean;
  dayPlans: DayPlan[];
  comparison: ComparisonData | null;
  aiSummary: string;
  sessionId: string | null;
  errorMessage: string | null;
}

interface DayPlanHotelOption {
  type: 'recommended' | 'alternative';
  name: string;
  pricePerNight: number;
  location?: string;
  reason: string;
  affiliateLink?: string;
}

interface DayPlanActivity {
  title: string;
  price: number;
  reason: string;
  affiliateLink?: string;
}

interface DayPlan {
  day: number;
  date: string;
  title: string;
  move: string;
  highlight: string;
  hotels: DayPlanHotelOption[];
  activities: DayPlanActivity[];
}

// ─── 서브 컴포넌트 ────────────────────────────────────────────────────────────

function FlightCard({ f }: { f: FlightResult }) {
  const link = f.affiliateLink ?? f.providerUrl;
  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] p-4 flex flex-col gap-1.5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-[#3182F6]">{f.airline || '항공사'}</span>
        {f.flightCode && <span className="text-[11px] text-[#8B95A1]">{f.flightCode}</span>}
      </div>
      <div className="flex items-center gap-2 text-[13px] text-[#4E5968]">
        <span>{f.departure.airport}</span>
        <span className="text-[#C9D0D6]">→</span>
        <span>{f.arrival.airport}</span>
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[18px] font-extrabold text-[#191F28] tabular-nums">
          {f.price.toLocaleString()}
          <span className="text-[12px] font-normal text-[#8B95A1] ml-0.5">원~</span>
        </span>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] font-semibold text-white bg-[#3182F6] px-3 py-1.5 rounded-full hover:bg-[#1b6cf2] transition-colors"
          >
            예약
          </a>
        )}
      </div>
    </div>
  );
}

function HotelCard({
  h,
  checkIn,
  checkOut,
  adults,
  childCount,
}: {
  h: StayResult;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  childCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail]     = useState<StayDetailPanel | null>(null);
  const [loading, setLoading]   = useState(false);
  const link = h.affiliateLink ?? h.providerUrl;
  const gid  = h.providerId;

  const toggleDetail = async () => {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (detail || !gid || !checkIn || !checkOut) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/free-travel/stay-detail?gid=${encodeURIComponent(gid)}&checkIn=${checkIn}&checkOut=${checkOut}&adults=${adults ?? 2}&children=${childCount ?? 0}`,
      );
      if (res.ok) {
        const json = await res.json() as { detail?: StayDetailPanel };
        if (json.detail) setDetail(json.detail);
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden shadow-sm">
      {h.imageUrl && (
        <img src={h.imageUrl} alt={h.name} className="w-full h-32 object-cover" loading="lazy" />
      )}
      <div className="p-3 flex flex-col gap-1">
        <p className="text-[14px] font-semibold text-[#191F28] leading-tight line-clamp-2">{h.name}</p>
        {h.rating != null && (
          <div className="flex items-center gap-1">
            <span className="text-amber-400 text-[11px]">★</span>
            <span className="text-[11px] text-[#4E5968]">{h.rating.toFixed(1)}</span>
            {h.reviewCount && <span className="text-[10px] text-[#8B95A1]">({h.reviewCount.toLocaleString()})</span>}
          </div>
        )}
        <div className="flex items-center justify-between mt-1">
          <div>
            <span className="text-[16px] font-extrabold text-[#191F28] tabular-nums">{h.pricePerNight.toLocaleString()}</span>
            <span className="text-[11px] text-[#8B95A1] ml-0.5">원/박</span>
          </div>
          <div className="flex items-center gap-1.5">
            {checkIn && gid && (
              <button
                onClick={toggleDetail}
                className="text-[11px] font-medium text-[#8B95A1] border border-[#E5E7EB] px-2 py-0.5 rounded-full hover:border-[#3182F6] hover:text-[#3182F6] transition-colors"
              >
                {expanded ? '접기' : '상세'}
              </button>
            )}
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold text-[#3182F6] border border-[#3182F6] px-2.5 py-1 rounded-full hover:bg-[#3182F6] hover:text-white transition-colors"
              >
                보기
              </a>
            )}
          </div>
        </div>
      </div>

      {/* 상세 패널 */}
      {expanded && (
        <div className="border-t border-[#F3F4F6] px-3 pb-3 pt-2 bg-[#FAFAFA]">
          {loading ? (
            <div className="flex items-center gap-2 py-1.5">
              <svg className="animate-spin w-3.5 h-3.5 text-[#3182F6]" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              <span className="text-[12px] text-[#8B95A1]">상세 정보 불러오는 중...</span>
            </div>
          ) : detail ? (
            <div className="space-y-2">
              {detail.description && (
                <p className="text-[12px] text-[#4E5968] leading-relaxed line-clamp-4">{detail.description}</p>
              )}
              {detail.amenities && detail.amenities.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {detail.amenities.slice(0, 6).map((am, i) => (
                    <span key={i} className="text-[10px] bg-white text-[#4E5968] border border-[#E5E7EB] px-1.5 py-0.5 rounded-full">{am}</span>
                  ))}
                </div>
              )}
              {(detail.checkInTime || detail.checkOutTime) && (
                <div className="flex gap-3 text-[11px] text-[#8B95A1]">
                  {detail.checkInTime  && <span>체크인 {detail.checkInTime}</span>}
                  {detail.checkOutTime && <span>체크아웃 {detail.checkOutTime}</span>}
                </div>
              )}
              {detail.cancellationPolicy && (
                <p className="text-[11px] text-[#8B95A1] leading-snug">{detail.cancellationPolicy}</p>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-[#8B95A1] py-1">상세 정보를 가져올 수 없습니다.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityCard({ a, defaultDate }: { a: ActivityResult; defaultDate?: string }) {
  const [expanded, setExpanded]           = useState(false);
  const [detail, setDetail]               = useState<TnaDetailPanel | null>(null);
  const [loading, setLoading]             = useState(false);
  const [selectedDate, setSelectedDate]   = useState(defaultDate ?? '');
  const [options, setOptions]             = useState<TnaOptionItem[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const link = a.affiliateLink ?? a.providerUrl;
  const gid  = a.providerId;

  const toggleDetail = async () => {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (detail || !gid || !link) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/free-travel/tna-detail?gid=${encodeURIComponent(gid)}&url=${encodeURIComponent(link)}`,
      );
      if (res.ok) {
        const json = await res.json() as { detail?: TnaDetailPanel };
        if (json.detail) setDetail(json.detail);
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  };

  const fetchOptions = async (date: string) => {
    if (!gid || !link || !date) return;
    setOptionsLoading(true);
    setOptions([]);
    try {
      const res = await fetch(
        `/api/free-travel/tna-options?gid=${encodeURIComponent(gid)}&url=${encodeURIComponent(link)}&date=${date}`,
      );
      if (res.ok) {
        const json = await res.json() as { options?: TnaOptionItem[] };
        setOptions(json.options ?? []);
      }
    } catch { /* silent */ } finally {
      setOptionsLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden shadow-sm">
      <div className="p-3 flex items-start gap-3">
        {a.imageUrl && (
          <img src={a.imageUrl} alt={a.name} className="w-14 h-14 rounded-xl object-cover shrink-0" loading="lazy" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-[#191F28] leading-tight line-clamp-2">{a.name}</p>
          {a.duration && <p className="text-[11px] text-[#8B95A1] mt-0.5">{a.duration}</p>}
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[14px] font-bold text-[#3182F6] tabular-nums">{a.price.toLocaleString()}원~</span>
            <div className="flex items-center gap-1.5">
              {gid && link && (
                <button
                  onClick={toggleDetail}
                  className="text-[11px] font-medium text-[#8B95A1] border border-[#E5E7EB] px-2 py-0.5 rounded-full hover:border-[#3182F6] hover:text-[#3182F6] transition-colors"
                >
                  {expanded ? '접기' : '상세'}
                </button>
              )}
              {link && (
                <a href={link} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-[#8B95A1] underline hover:text-[#3182F6]">예약</a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 상세 패널 */}
      {expanded && (
        <div className="border-t border-[#F3F4F6] px-3 pb-3 pt-2 bg-[#FAFAFA]">
          {loading ? (
            <div className="flex items-center gap-2 py-1">
              <svg className="animate-spin w-3 h-3 text-[#3182F6]" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              <span className="text-[11px] text-[#8B95A1]">불러오는 중...</span>
            </div>
          ) : detail ? (
            <div className="space-y-2">
              {detail.description && (
                <p className="text-[12px] text-[#4E5968] leading-relaxed line-clamp-4">{detail.description}</p>
              )}
              {detail.includes && detail.includes.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {detail.includes.slice(0, 4).map((item, i) => (
                    <span key={i} className="text-[10px] bg-green-50 text-green-700 border border-green-100 px-1.5 py-0.5 rounded-full">{item}</span>
                  ))}
                </div>
              )}
              {detail.meetingPoint && (
                <p className="text-[11px] text-[#8B95A1]">📍 {detail.meetingPoint}</p>
              )}

              {/* 날짜별 가격·재고 조회 */}
              <div className="pt-2 border-t border-[#EBEBEB]">
                <p className="text-[10px] font-semibold text-[#4E5968] mb-1.5">날짜별 가격·재고</p>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={e => {
                    setSelectedDate(e.target.value);
                    if (e.target.value) fetchOptions(e.target.value);
                  }}
                  className="w-full border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 text-[11px] outline-none focus:border-[#3182F6] bg-white"
                />
                {optionsLoading && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <svg className="animate-spin w-3 h-3 text-[#3182F6]" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                    </svg>
                    <span className="text-[11px] text-[#8B95A1]">옵션 조회 중...</span>
                  </div>
                )}
                {options.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {options.slice(0, 4).map((opt, i) => (
                      <div key={i} className="flex items-center justify-between bg-white border border-[#E5E7EB] rounded-lg px-2.5 py-1.5">
                        <span className="text-[11px] text-[#4E5968] leading-tight flex-1 pr-2 line-clamp-1">{opt.name}</span>
                        <div className="text-right shrink-0">
                          <span className={`text-[12px] font-bold tabular-nums ${opt.available === false ? 'text-[#C9D0D6] line-through' : 'text-[#3182F6]'}`}>
                            {(opt.adultPrice ?? opt.price).toLocaleString()}원
                          </span>
                          {opt.available === false && (
                            <p className="text-[9px] text-red-400 leading-none">마감</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!optionsLoading && options.length === 0 && selectedDate && (
                  <p className="text-[11px] text-[#8B95A1] mt-1.5">선택 가능한 옵션이 없습니다.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-[#8B95A1] py-1">상세 정보를 가져올 수 없습니다.</p>
          )}
        </div>
      )}
    </div>
  );
}

function FareCalendarWidget({
  entries,
  loading,
  nights,
  adults,
  destination,
  departure,
  onSelect,
}: {
  entries: FareCalendarEntry[];
  loading: boolean;
  nights: number;
  adults: number;
  destination: string;
  departure: string;
  onSelect: (msg: string) => void;
}) {
  if (loading) {
    return (
      <section className="bg-white border border-[#E5E7EB] rounded-2xl p-4 shadow-sm">
        <p className="text-[13px] font-semibold text-[#191F28] mb-2">📅 날짜별 항공 최저가</p>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="shrink-0 w-20 h-16 bg-[#F7F8FA] rounded-xl animate-pulse" />
          ))}
        </div>
      </section>
    );
  }
  if (entries.length === 0) return null;

  const minPrice = Math.min(...entries.map(e => e.price));

  return (
    <section className="bg-white border border-[#E5E7EB] rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[13px] font-semibold text-[#191F28]">📅 날짜별 항공 최저가</p>
        <span className="text-[10px] text-[#8B95A1]">날짜 탭 클릭 시 재검색</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none snap-x">
        {entries.slice(0, 14).map(e => {
          const d = new Date(e.date);
          const mon = (d.getMonth() + 1) + '월';
          const day = d.getDate() + '일';
          const isMin = e.price === minPrice;
          return (
            <button
              key={e.date}
              onClick={() => {
                const dateTo = new Date(d.getTime() + nights * 86400_000).toISOString().slice(0, 10);
                onSelect(`${departure}출발 ${destination} ${e.date}~${dateTo} 성인${adults}`);
              }}
              className={`shrink-0 snap-start flex flex-col items-center px-3 py-2.5 rounded-xl border transition-all ${
                isMin
                  ? 'bg-[#3182F6] border-[#3182F6] text-white'
                  : 'bg-[#F7F8FA] border-[#E5E7EB] text-[#4E5968] hover:border-[#3182F6] hover:bg-[#EBF3FE]'
              }`}
            >
              <span className="text-[10px] font-medium opacity-80">{mon}</span>
              <span className="text-[13px] font-bold">{day}</span>
              <span className="text-[11px] font-semibold tabular-nums mt-0.5">
                {Math.round(e.price / 10000)}만
              </span>
              {isMin && (
                <span className="text-[9px] font-bold mt-0.5 opacity-90">최저</span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-[#8B95A1] mt-2">* 예상 가격. 실제 예약가는 다를 수 있습니다.</p>
    </section>
  );
}

function DecoyComparison({ comparison }: { comparison: ComparisonData }) {
  return (
    <section className="bg-gradient-to-br from-[#EBF3FE] to-[#DBEAFE] rounded-3xl p-5 md:p-6">
      <h2 className="text-[16px] font-bold text-[#191F28] mb-1">자유여행 vs 여소남 패키지</h2>
      <p className="text-[13px] text-[#4E5968] mb-4">같은 여행, 가격을 비교해보세요.</p>

      {/* 자유여행 총액 */}
      <div className="bg-white/70 rounded-2xl p-4 mb-3">
        <p className="text-[12px] text-[#8B95A1] font-medium mb-1">자유여행 예상 비용</p>
        <div className="flex items-baseline gap-1">
          <span className="text-[22px] font-extrabold text-[#191F28] tabular-nums">
            {comparison.totalMin.toLocaleString()}
          </span>
          <span className="text-[13px] text-[#8B95A1]">원 ~</span>
          <span className="text-[16px] font-bold text-[#8B95A1] tabular-nums">
            {comparison.totalMax.toLocaleString()}원
          </span>
        </div>
        <p className="text-[11px] text-[#8B95A1] mt-0.5">항공 + 숙박 + 액티비티 3개 기준</p>
      </div>

      {/* 패키지 비교 */}
      {comparison.packages.length > 0 && (
        <div className="flex flex-col gap-2">
          {comparison.packages.map(p => (
            <Link key={p.id} href={`/packages/${p.id}`}
              className="bg-white rounded-2xl p-4 flex items-center justify-between group hover:shadow-md transition-shadow">
              <div className="flex-1 min-w-0 pr-3">
                <p className="text-[13px] font-semibold text-[#191F28] leading-tight line-clamp-1">{p.title}</p>
                {p.highlights.slice(0, 2).map((h, i) => (
                  <span key={i} className="inline-block text-[10px] text-[#3182F6] bg-[#EBF3FE] px-1.5 py-0.5 rounded-full mr-1 mt-1">{h}</span>
                ))}
              </div>
              <div className="text-right shrink-0">
                <p className="text-[16px] font-extrabold text-[#191F28] tabular-nums">{p.price.toLocaleString()}원</p>
                {p.savings > 0 && (
                  <span className="inline-block bg-red-50 text-red-500 text-[10px] font-bold px-2 py-0.5 rounded-full mt-0.5">
                    {p.savings.toLocaleString()}원 절약
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      <p className="text-[12px] text-[#8B95A1] mt-3 text-center">{comparison.message}</p>
    </section>
  );
}

// ─── SSE 파서 ────────────────────────────────────────────────────────────────

async function fetchSSEPlan(
  message: string,
  requestId: string,
  signal: AbortSignal,
  onEvent: (event: string, data: unknown) => void,
) {
  const response = await fetch('/api/free-travel/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, requestId }),
    signal,
  });

  if (!response.ok) throw new Error(`서버 오류 (${response.status})`);
  if (!response.body) throw new Error('스트림 없음');

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = '';
  let event     = '';
  let data      = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event: '))      event = line.slice(7);
        else if (line.startsWith('data: '))  data  = line.slice(6);
        else if (line === '' && event && data) {
          try { onEvent(event, JSON.parse(data)); } catch { /* skip */ }
          event = '';
          data  = '';
        }
      }
    }
  } finally {
    reader.cancel(); // 언마운트·abort 시 스트림 정리
  }
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

const HOW_IT_WORKS = [
  { emoji: '✍️', title: '목적지·날짜 입력', desc: '자연어로 편하게 입력하세요' },
  { emoji: '⚡', title: '실시간 가격 비교', desc: '마이리얼트립 최저가 자동 검색' },
  { emoji: '💰', title: '여소남 패키지 비교', desc: '자유여행 vs 패키지 절약액 확인' },
];

const FAQ = [
  { q: '검색 결과는 얼마나 정확한가요?', a: '마이리얼트립 실시간 API에서 가져온 실제 가격입니다. 예약 시점에 변동될 수 있어 링크를 클릭해 최종 확인을 권장합니다.' },
  { q: '자유여행 예약은 어디서 하나요?', a: '각 항공·호텔·액티비티 카드의 "예약" 버튼을 클릭하면 마이리얼트립 예약 페이지로 연결됩니다.' },
  { q: '여소남 패키지와의 차이는 무엇인가요?', a: '패키지는 항공·호텔·일정이 모두 포함된 상품입니다. 자유여행보다 저렴한 경우가 많고, 현지 가이드와 이동이 포함됩니다.' },
];

export default function FreeTravelClient() {
  const [input, setInput]   = useState('');
  const [state, setState]   = useState<SearchState>({
    status:        'idle',
    statusMessage: '',
    requestId:     null,
    params:        null,
    flights:       [],
    hotels:        [],
    activities:    [],
    hotelsEstimated: false,
    activitiesEstimated: false,
    dayPlans:      [],
    comparison:    null,
    aiSummary:     '',
    sessionId:     null,
    errorMessage:  null,
  });

  // 연락처 수집 상태
  const [phone, setPhone]          = useState('');
  const [phoneSent, setPhoneSent]  = useState(false);
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneError, setPhoneError]   = useState<string | null>(null);
  const [showPackages, setShowPackages] = useState(false);
  const [companionType, setCompanionType] = useState<string>('');
  const [hotelBudgetBand, setHotelBudgetBand] = useState<string>('');
  const [travelPace, setTravelPace] = useState<string>('');
  const [plannerError, setPlannerError] = useState<string | null>(null);

  // 날짜별 최저가 달력
  const [fareCalendar, setFareCalendar]               = useState<FareCalendarEntry[]>([]);
  const [fareCalendarLoading, setFareCalendarLoading] = useState(false);

  // 할인 항공사 배너 (idle 화면)
  const [promoAirlines, setPromoAirlines] = useState<PromotionAirline[]>([]);
  useEffect(() => {
    fetch('/api/travel/promotion-airlines')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((json: { airlines?: PromotionAirline[] }) => setPromoAirlines(json.airlines ?? []))
      .catch(() => { /* silent */ });
  }, []);

  const abortRef    = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 페이지 언마운트 시 진행 중인 SSE 스트림 정리
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const runSearch = useCallback(async (msg: string) => {
    if (!msg) return;
    const requestId = crypto.randomUUID();

    // 이전 검색 중단
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setPhoneSent(false);
    setPhone('');
    setPhoneError(null);
    setFareCalendar([]);
    setFareCalendarLoading(false);
    setShowPackages(false);
    setPlannerError(null);
    setState(prev => ({
      ...prev,
      status: 'searching',
      statusMessage: '시작 중...',
      requestId,
      params: null, flights: [], hotels: [], activities: [], hotelsEstimated: false, activitiesEstimated: false, dayPlans: [],
      comparison: null, aiSummary: '', sessionId: null, errorMessage: null,
    }));

    try {
      await fetchSSEPlan(msg, requestId, abortRef.current.signal, (event, data) => {
        const payload = (data && typeof data === 'object') ? (data as Record<string, unknown>) : {};
        const eventRequestId = typeof payload.requestId === 'string' ? payload.requestId : requestId;
        if (eventRequestId !== requestId) return;

        switch (event) {
          case 'status':
            setState(prev => ({ ...prev, statusMessage: (payload.message as string) ?? prev.statusMessage }));
            break;
          case 'params': {
            const p = payload as unknown as SearchParams;
            setState(prev => ({ ...prev, params: p }));
            // 항공 검색 포함 시 fare calendar 비동기 로드
            if (!p.skipFlights && p.departure && p.destinationIata) {
              setFareCalendarLoading(true);
              fetch(`/api/free-travel/fare-calendar?from=${p.departure}&to=${p.destinationIata}&date=${p.dateFrom}&nights=${p.nights}`)
                .then(r => r.ok ? r.json() : Promise.reject())
                .then((json: { entries?: FareCalendarEntry[] }) => {
                  setFareCalendar(json.entries ?? []);
                })
                .catch(() => { /* silent */ })
                .finally(() => setFareCalendarLoading(false));
            }
            break;
          }
          case 'flights':
            setState(prev => ({ ...prev, flights: ((payload.items as FlightResult[]) ?? []) }));
            break;
          case 'hotels':
            setState(prev => ({
              ...prev,
              hotels: ((payload.items as StayResult[]) ?? []),
              hotelsEstimated: Boolean(payload.estimated),
            }));
            break;
          case 'activities':
            setState(prev => ({
              ...prev,
              activities: ((payload.items as ActivityResult[]) ?? []),
              activitiesEstimated: Boolean(payload.estimated),
            }));
            break;
          case 'itinerary':
            setState(prev => ({ ...prev, dayPlans: ((payload.dayPlans as DayPlan[]) ?? []) }));
            break;
          case 'comparison':
            setState(prev => ({ ...prev, comparison: payload as unknown as ComparisonData }));
            break;
          case 'summary':
            setState(prev => ({ ...prev, aiSummary: (payload.text as string) ?? '' }));
            break;
          case 'done':
            setState(prev => ({ ...prev, status: 'done', sessionId: (payload.sessionId as string) ?? null }));
            break;
          case 'error':
            setState(prev => ({ ...prev, status: 'error', errorMessage: (payload.message as string) ?? '검색 중 오류가 발생했습니다.' }));
            break;
        }
      });
      setState(prev => (
        prev.requestId === requestId && prev.status === 'searching'
          ? { ...prev, status: 'done', statusMessage: '검색이 종료되었습니다.' }
          : prev
      ));
    } catch (err) {
      // AbortError는 사용자가 직접 취소한 것이므로 에러 UI 표시 안 함
      if (err instanceof Error && err.name === 'AbortError') return;
      setState(prev => ({
        ...prev,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : '검색 중 오류가 발생했습니다.',
      }));
    }
  }, []);

  const handlePhoneSave = async () => {
    if (!state.sessionId || !phone.trim()) return;
    const normalizedPhone = phone.trim().replace(/\s+/g, '').replace(/-/g, '');
    if (!/^01[0-9]\d{7,8}$/.test(normalizedPhone)) {
      setPhoneError('휴대폰 번호 형식을 확인해주세요. 예: 010-1234-5678');
      return;
    }
    setPhoneSaving(true);
    setPhoneError(null);
    try {
      const res = await fetch('/api/free-travel/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: state.sessionId, customerPhone: phone.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? '저장 실패');
      }
      setPhoneSent(true);
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : '저장 실패');
    } finally {
      setPhoneSaving(false);
    }
  };

  const buildEnrichedMessage = useCallback((base: string) => {
    const extras = [
      companionType ? `동반유형 ${companionType}` : '',
      hotelBudgetBand ? `호텔예산 ${hotelBudgetBand}` : '',
      travelPace ? `여행속도 ${travelPace}` : '',
    ].filter(Boolean);
    return extras.length > 0 ? `${base} / ${extras.join(', ')}` : base;
  }, [companionType, hotelBudgetBand, travelPace]);

  const handleSearch = useCallback(() => {
    const base = input.trim();
    if (!base) return;
    if (!companionType || !hotelBudgetBand || !travelPace) {
      setPlannerError('정확한 견적을 위해 동반유형, 호텔예산, 여행속도를 선택해주세요.');
      return;
    }
    runSearch(buildEnrichedMessage(base));
  }, [input, companionType, hotelBudgetBand, travelPace, runSearch, buildEnrichedMessage]);

  const handleFareSelect = useCallback((msg: string) => {
    setInput(msg);
    runSearch(buildEnrichedMessage(msg));
  }, [runSearch, buildEnrichedMessage]);

  const isSearching = state.status === 'searching';
  const hasResults  = state.flights.length > 0 || state.hotels.length > 0 || state.activities.length > 0;
  const noResultDone = state.status === 'done' && !hasResults;

  return (
    <div className="min-h-screen bg-[#F7F8FA]">
      {/* ── Nav ── */}
      <nav className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-[#E5E7EB] px-4 py-3 flex items-center gap-3">
        <Link href="/" className="text-[#8B95A1] hover:text-[#191F28] transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </Link>
        <h1 className="text-[16px] font-bold text-[#191F28]">자유여행 AI 견적</h1>
      </nav>

      {/* ── Hero + 입력 ── */}
      <section className="bg-gradient-to-b from-white to-[#F7F8FA] px-4 pt-8 pb-6">
        <div className="max-w-[640px] mx-auto">
          <p className="text-[12px] font-semibold text-[#3182F6] mb-2 tracking-wider uppercase">AI 자유여행 플래너</p>
          <h2 className="text-[24px] md:text-[28px] font-extrabold text-[#191F28] leading-tight tracking-[-0.03em] mb-2">
            항공 + 호텔 + 액티비티<br />30초 AI 견적
          </h2>
          <p className="text-[14px] text-[#4E5968] mb-6">자연어로 입력하면 마이리얼트립 실시간 최저가를 비교해드립니다.</p>

          <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch(); } }}
              placeholder="예) 5월 1일~5일 부산출발 다낭 성인2 아동2"
              rows={3}
              className="w-full px-4 pt-4 pb-2 text-[15px] text-[#191F28] placeholder-[#C9D0D6] resize-none outline-none"
              disabled={isSearching}
            />
            <div className="px-4 pb-2 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-[#8B95A1] w-full">누구와 가시나요?</span>
                {['커플/부부', '아이 동반', '부모님 동반', '친구/지인'].map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setCompanionType(option)}
                    className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                      companionType === option ? 'bg-[#EBF3FE] border-[#3182F6] text-[#3182F6]' : 'border-[#E5E7EB] text-[#4E5968]'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-[#8B95A1] w-full">호텔 예산은 어느 정도인가요?</span>
                {['10만원대', '20~30만원대', '40만원 이상'].map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setHotelBudgetBand(option)}
                    className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                      hotelBudgetBand === option ? 'bg-[#EBF3FE] border-[#3182F6] text-[#3182F6]' : 'border-[#E5E7EB] text-[#4E5968]'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-[#8B95A1] w-full">여행 속도는 어떻게 원하시나요?</span>
                {['여유', '보통', '빡빡'].map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setTravelPace(option)}
                    className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                      travelPace === option ? 'bg-[#EBF3FE] border-[#3182F6] text-[#3182F6]' : 'border-[#E5E7EB] text-[#4E5968]'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end px-3 pb-3">
              <button
                onClick={handleSearch}
                disabled={isSearching || !input.trim()}
                className="px-5 py-2.5 bg-[#3182F6] text-white text-[14px] font-semibold rounded-full hover:bg-[#1b6cf2] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {isSearching ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                    </svg>
                    검색 중
                  </>
                ) : '견적 받기'}
              </button>
            </div>
            {plannerError && (
              <p className="px-4 pb-3 text-[12px] text-red-500">{plannerError}</p>
            )}
          </div>
        </div>
      </section>

      {/* ── How it works (idle만) ── */}
      {state.status === 'idle' && (
        <section className="px-4 py-6 max-w-[640px] mx-auto space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {HOW_IT_WORKS.map(({ emoji, title, desc }) => (
              <div key={title} className="bg-white rounded-2xl p-4 text-center border border-[#E5E7EB]">
                <div className="text-3xl mb-2">{emoji}</div>
                <p className="text-[13px] font-bold text-[#191F28] leading-tight">{title}</p>
                <p className="text-[11px] text-[#8B95A1] mt-1">{desc}</p>
              </div>
            ))}
          </div>

          {/* 할인 항공사 배너 */}
          {promoAirlines.length > 0 && (
            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4 shadow-sm">
              <p className="text-[12px] font-semibold text-[#4E5968] mb-2.5">✈️ 이번 주 할인 항공사</p>
              <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
                {promoAirlines.slice(0, 8).map((al, i) => (
                  <a
                    key={i}
                    href={al.providerUrl ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      if (!al.providerUrl) {
                        setInput(`${al.airline} 항공권 검색`);
                      }
                    }}
                    className="shrink-0 flex flex-col items-center gap-1 bg-[#F7F8FA] hover:bg-[#EBF3FE] border border-[#E5E7EB] hover:border-[#3182F6] px-3 py-2 rounded-xl transition-all cursor-pointer"
                  >
                    {al.imageUrl ? (
                      <img src={al.imageUrl} alt={al.airline} className="w-8 h-8 object-contain" />
                    ) : (
                      <span className="text-[20px]">✈️</span>
                    )}
                    <span className="text-[11px] font-semibold text-[#191F28] whitespace-nowrap">{al.airline}</span>
                    {al.discountRate != null && (
                      <span className="text-[10px] font-bold text-red-500">{al.discountRate}% 할인</span>
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── 로딩 상태 메시지 ── */}
      {isSearching && (
        <section className="px-4 py-6 max-w-[640px] mx-auto">
          <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5 text-center shadow-sm">
            <div className="flex justify-center mb-3">
              <svg className="animate-spin w-8 h-8 text-[#3182F6]" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
            </div>
            <p className="text-[15px] font-semibold text-[#191F28]">{state.statusMessage || '검색 중...'}</p>

            {/* 결과가 오는 대로 미리 보여주기 */}
            {state.flights.length > 0 && (
              <p className="text-[12px] text-[#3182F6] mt-2">✈️ 항공 {state.flights.length}건 발견</p>
            )}
            {state.hotels.length > 0 && (
              <p className="text-[12px] text-[#3182F6] mt-0.5">🏨 호텔 {state.hotels.length}건 발견</p>
            )}
            {state.activities.length > 0 && (
              <p className="text-[12px] text-[#3182F6] mt-0.5">🎡 액티비티 {state.activities.length}건 발견</p>
            )}
          </div>
        </section>
      )}

      {/* ── 오류 ── */}
      {state.status === 'error' && (
        <section className="px-4 py-6 max-w-[640px] mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-center">
            <p className="text-[14px] font-semibold text-red-600">{state.errorMessage}</p>
            <button onClick={() => setState(prev => ({ ...prev, status: 'idle' }))}
              className="mt-3 text-[13px] text-red-500 underline">다시 검색</button>
          </div>
        </section>
      )}

      {/* ── 검색 결과 ── */}
      {(hasResults || state.status === 'done') && (
        <div className="px-4 pb-10 max-w-[640px] mx-auto space-y-5">

          {/* AI 코멘트 */}
          {state.aiSummary && (
            <div className="bg-[#3182F6]/5 border border-[#3182F6]/20 rounded-2xl p-4">
              <p className="text-[14px] text-[#191F28] leading-relaxed">{state.aiSummary}</p>
            </div>
          )}

          {state.dayPlans.length > 0 && (
            <section className="bg-white border border-[#E5E7EB] rounded-2xl p-4 shadow-sm">
              <h3 className="text-[15px] font-bold text-[#191F28] mb-3">🗓️ 일자별 추천 일정표</h3>
              <div className="space-y-3">
                {state.dayPlans.map(plan => (
                  <article key={plan.day} className="border border-[#EEF0F3] rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[13px] font-bold text-[#191F28]">{plan.day}일차 · {plan.title}</p>
                      <span className="text-[11px] text-[#8B95A1]">{plan.date}</span>
                    </div>
                    <p className="text-[12px] text-[#4E5968]">{plan.move}</p>
                    <p className="text-[11px] text-[#8B95A1] mt-1">{plan.highlight}</p>
                    {plan.hotels.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {plan.hotels.map((hotel, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-[#F8FAFC] border border-[#EEF2F7] rounded-lg px-2.5 py-1.5">
                            <div>
                              <p className="text-[12px] font-medium text-[#191F28]">{hotel.type === 'recommended' ? '추천 호텔' : '대안 호텔'}: {hotel.name}</p>
                              <p className="text-[10px] text-[#8B95A1]">{hotel.reason}</p>
                            </div>
                            <p className="text-[12px] font-bold text-[#3182F6]">{hotel.pricePerNight.toLocaleString()}원/박</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {plan.activities.length > 0 && (
                      <div className="mt-2">
                        {plan.activities.map((act, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-[#EEF6FF] border border-[#D9EAFF] rounded-lg px-2.5 py-1.5">
                            <div>
                              <p className="text-[12px] font-semibold text-[#191F28]">액티비티: {act.title}</p>
                              <p className="text-[10px] text-[#6B7280]">{act.reason}</p>
                            </div>
                            <p className="text-[12px] font-bold text-[#3182F6]">{act.price.toLocaleString()}원~</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          {noResultDone && (
            <section className="bg-white border border-[#E5E7EB] rounded-2xl p-4">
              <p className="text-[14px] font-bold text-[#191F28] mb-1">검색 결과가 충분하지 않습니다.</p>
              <p className="text-[12px] text-[#8B95A1]">
                날짜를 1~2일 조정하거나 목적지를 더 구체적으로 입력해 주세요. 예: `5/8~11 부산출발 도야마 성인3 아동1`.
              </p>
            </section>
          )}

          {/* 항공 */}
          {state.flights.length > 0 && (
            <section>
              <h3 className="text-[15px] font-bold text-[#191F28] mb-2.5 flex items-center gap-1.5">
                ✈️ 항공권
                <span className="text-[11px] font-normal text-[#8B95A1]">최저가 순</span>
              </h3>
              <div className="grid gap-2">
                {state.flights.slice(0, 3).map((f, i) => <FlightCard key={i} f={f} />)}
              </div>
            </section>
          )}

          {/* 날짜별 최저가 달력 */}
          {(fareCalendarLoading || fareCalendar.length > 0) && state.params && (
            <FareCalendarWidget
              entries={fareCalendar}
              loading={fareCalendarLoading}
              nights={state.params.nights}
              adults={state.params.adults}
              destination={state.params.destination}
              departure={state.params.departure}
              onSelect={handleFareSelect}
            />
          )}

          {/* 숙박 */}
          {state.hotels.length > 0 && (
            <section>
              <h3 className="text-[15px] font-bold text-[#191F28] mb-2.5 flex items-center gap-1.5">
                🏨 호텔
                <span className="text-[11px] font-normal text-[#8B95A1]">1박 기준 최저가 순</span>
                {state.hotelsEstimated && <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">추정</span>}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {state.hotels.slice(0, 4).map((h, i) => (
                  <HotelCard
                    key={i}
                    h={h}
                    checkIn={state.params?.dateFrom}
                    checkOut={state.params?.dateTo}
                    adults={state.params?.adults}
                    childCount={state.params?.children}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 액티비티 */}
          {state.activities.length > 0 && (
            <section>
              <h3 className="text-[15px] font-bold text-[#191F28] mb-2.5">🎡 액티비티</h3>
              {state.activitiesEstimated && (
                <p className="text-[11px] text-amber-600 mb-2">실시간 조회 실패로 추정 데이터를 표시 중입니다.</p>
              )}
              <div className="grid gap-2">
                {state.activities.slice(0, 5).map((a, i) => (
                  <ActivityCard key={i} a={a} defaultDate={state.params?.dateFrom} />
                ))}
              </div>
            </section>
          )}

          {state.comparison?.quoteBreakdown && (
            <section className="bg-white border border-[#E5E7EB] rounded-2xl p-4 shadow-sm">
              <h3 className="text-[15px] font-bold text-[#191F28] mb-2">💸 예상 견적 브리핑</h3>
              <div className="space-y-1.5 text-[13px]">
                <div className="flex justify-between"><span className="text-[#4E5968]">항공</span><span className="font-semibold text-[#191F28]">{state.comparison.quoteBreakdown.flights.toLocaleString()}원</span></div>
                <div className="flex justify-between"><span className="text-[#4E5968]">호텔</span><span className="font-semibold text-[#191F28]">{state.comparison.quoteBreakdown.hotels.toLocaleString()}원</span></div>
                <div className="flex justify-between"><span className="text-[#4E5968]">액티비티</span><span className="font-semibold text-[#191F28]">{state.comparison.quoteBreakdown.activities.toLocaleString()}원</span></div>
                <div className="pt-1 border-t border-[#F1F5F9] text-[12px] text-[#8B95A1]">
                  호텔 평균 {state.comparison.quoteBreakdown.hotelNightlyAverage.toLocaleString()}원/박 · 객실 {state.comparison.quoteBreakdown.occupancyRooms}개 기준
                </div>
              </div>
            </section>
          )}

          {/* 패키지 비교는 일정 확인 후 선택 노출 */}
          {state.comparison && (
            <section className="space-y-2">
              <button
                type="button"
                onClick={() => setShowPackages(v => !v)}
                className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl py-2.5 text-[13px] font-semibold text-[#334155] hover:border-[#3182F6] hover:text-[#3182F6] transition-colors"
              >
                {showPackages ? '패키지 비교 접기' : '이 일정과 유사한 할인 패키지 확인하기'}
              </button>
              {showPackages && <DecoyComparison comparison={state.comparison} />}
            </section>
          )}

          {/* 연락처 수집 — 일정표 카카오 전송 게이트 */}
          {state.status === 'done' && !phoneSent && (
            <section className="bg-white border border-[#E5E7EB] rounded-2xl p-5 shadow-sm">
              <p className="text-[15px] font-bold text-[#191F28] mb-1">📩 일정표 카카오톡으로 받기</p>
              <p className="text-[13px] text-[#4E5968] mb-4">
                이 견적은 15분 후 만료됩니다. 지금 번호를 남기시면 상세 일정표와 링크를 카카오로 보내드립니다.
              </p>
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="010-0000-0000"
                  inputMode="numeric"
                  className="flex-1 border border-[#E5E7EB] rounded-xl px-4 py-2.5 text-[14px] outline-none focus:border-[#3182F6]"
                />
                <button
                  onClick={handlePhoneSave}
                  disabled={phoneSaving || !phone.trim()}
                  className="px-4 py-2.5 bg-[#FEE500] text-[#191F28] text-[14px] font-bold rounded-xl disabled:opacity-50 hover:brightness-95 transition-all whitespace-nowrap"
                >
                  {phoneSaving ? '저장 중...' : '카카오 받기'}
                </button>
              </div>
              {phoneError && (
                <p className="mt-2 text-[12px] text-red-500">{phoneError}</p>
              )}
            </section>
          )}

          {phoneSent && (
            <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
              <p className="text-[14px] font-semibold text-green-700">저장 완료! 곧 카카오톡으로 연락드립니다.</p>
            </div>
          )}
        </div>
      )}

      {/* ── FAQ (idle 상태에서만) ── */}
      {state.status === 'idle' && (
        <section className="px-4 pb-12 max-w-[640px] mx-auto">
          <h2 className="text-[16px] font-bold text-[#191F28] mb-4">자주 묻는 질문</h2>
          <div className="space-y-2">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden">
                <summary className="px-4 py-3.5 text-[14px] font-semibold text-[#191F28] cursor-pointer list-none flex justify-between items-center">
                  {q}
                  <span className="text-[#C9D0D6] text-[18px] select-none">+</span>
                </summary>
                <p className="px-4 pb-4 text-[13px] text-[#4E5968] leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
