'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { FlightResult, StayResult, ActivityResult } from '@/lib/travel-providers/types';
import { isSafeImageSrc } from '@/lib/image-url';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';

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

/** 일정표 자체의 풍족·균형 (기후·날짜 적합도와 무관) */
interface ItineraryCompositionScore {
  score: number;
  label: string;
  summary: string;
  breakdown: {
    structure: number;
    richness: number;
    rhythm: number;
    paceFit: number;
    editorialEcho: number;
  };
  referencePackagesUsed: number;
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
  /** 일정 구성 만족도 점수 (승인 상품 일정·하이라이트 에코 포함) */
  itineraryScore: ItineraryCompositionScore | null;
  /** 일정표가 DeepSeek JSON인지, 검증 실패 시 템플릿 폴백인지 */
  itinerarySource: 'llm' | 'template' | null;
  /** 일정이 템플릿 폴백일 때만 원인 코드(운영·디버그) */
  itineraryLlmError: string | null;
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
  activityProviderId?: string;
}

interface DayPlanStop {
  id: string;
  timeHint: string;
  label: string;
  kind: 'free' | 'bookable';
  activityProviderId?: string;
  priceHint?: number;
}

interface DayPlan {
  day: number;
  date: string;
  title: string;
  move: string;
  highlight: string;
  stops?: DayPlanStop[];
  hotels: DayPlanHotelOption[];
  activities: DayPlanActivity[];
}

type CrosssellVariant = 'A' | 'B';

/** 마이리얼트립 실검색 숙소만 서버 상세 API(gid 숫자) 호출 가능 */
function canFetchMrtStayDetail(h: StayResult): boolean {
  if (h.provider !== 'mrt') return false;
  const id = String(h.providerId ?? '').trim();
  return /^\d+$/.test(id);
}

// ─── 서브 컴포넌트 ────────────────────────────────────────────────────────────

function FlightCard({ f }: { f: FlightResult }) {
  const link = f.affiliateLink ?? f.providerUrl;
  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] p-4 flex flex-col gap-1.5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-brand">{f.airline || '항공사'}</span>
        {f.flightCode && <span className="text-[11px] text-text-secondary">{f.flightCode}</span>}
      </div>
      <div className="flex items-center gap-2 text-[13px] text-text-body">
        <span>{f.departure.airport}</span>
        <span className="text-[#C9D0D6]">→</span>
        <span>{f.arrival.airport}</span>
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[18px] font-extrabold text-text-primary tabular-nums">
          {f.price.toLocaleString()}
          <span className="text-[12px] font-normal text-text-secondary ml-0.5">원~</span>
        </span>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] font-semibold text-white bg-brand px-3 py-1.5 rounded-full hover:bg-[#1b6cf2] transition-colors"
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
  const detailFetchable = canFetchMrtStayDetail(h) && !!checkIn && !!checkOut;

  const toggleDetail = async () => {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (detail || !detailFetchable) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/free-travel/stay-detail?gid=${encodeURIComponent(String(gid))}&checkIn=${checkIn}&checkOut=${checkOut}&adults=${adults ?? 2}&children=${childCount ?? 0}`,
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
      {h.imageUrl && isSafeImageSrc(h.imageUrl) ? (
        <SafeCoverImg
          src={h.imageUrl}
          alt={h.name}
          className="w-full h-32 object-cover"
          loading="lazy"
          fallback={<div className="w-full h-32 bg-[#F3F4F6]" aria-hidden />}
        />
      ) : null}
      <div className="p-3 flex flex-col gap-1">
        <p className="text-[15px] font-semibold text-text-primary leading-tight line-clamp-2">{h.name}</p>
        {h.rating != null && (
          <div className="flex items-center gap-1">
            <span className="text-amber-400 text-[12px]">★</span>
            <span className="text-[12px] text-text-body">{h.rating.toFixed(1)}</span>
            {h.reviewCount && <span className="text-[11px] text-text-secondary">({h.reviewCount.toLocaleString()})</span>}
          </div>
        )}
        <div className="flex items-center justify-between mt-1">
          <div>
            <span className="text-[17px] font-extrabold text-text-primary tabular-nums">{h.pricePerNight.toLocaleString()}</span>
            <span className="text-[12px] text-text-secondary ml-0.5">원/박</span>
          </div>
          <div className="flex items-center gap-1.5">
            {checkIn && (detailFetchable || (h.location && h.location.length > 0) || (h.amenities && h.amenities.length > 0)) && (
              <button
                type="button"
                onClick={toggleDetail}
                className="text-[12px] font-medium text-text-secondary border border-[#E5E7EB] px-2 py-0.5 rounded-full hover:border-brand hover:text-brand transition-colors"
              >
                {expanded ? '접기' : '상세'}
              </button>
            )}
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] font-semibold text-brand border border-brand px-2.5 py-1 rounded-full hover:bg-brand hover:text-white transition-colors"
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
              <svg className="animate-spin w-3.5 h-3.5 text-brand" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              <span className="text-[13px] text-text-secondary">상세 정보 불러오는 중...</span>
            </div>
          ) : detail ? (
            <div className="space-y-2">
              {detail.description && (
                <p className="text-[13px] text-text-body leading-relaxed line-clamp-4">{detail.description}</p>
              )}
              {detail.amenities && detail.amenities.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {detail.amenities.slice(0, 6).map((am, i) => (
                    <span key={i} className="text-[11px] bg-white text-text-body border border-[#E5E7EB] px-1.5 py-0.5 rounded-full">{am}</span>
                  ))}
                </div>
              )}
              {(detail.checkInTime || detail.checkOutTime) && (
                <div className="flex gap-3 text-[12px] text-text-secondary">
                  {detail.checkInTime  && <span>체크인 {detail.checkInTime}</span>}
                  {detail.checkOutTime && <span>체크아웃 {detail.checkOutTime}</span>}
                </div>
              )}
              {detail.cancellationPolicy && (
                <p className="text-[12px] text-text-secondary leading-snug">{detail.cancellationPolicy}</p>
              )}
            </div>
          ) : !detailFetchable ? (
            <div className="space-y-2">
              {h.location ? <p className="text-[13px] text-text-body">{h.location}</p> : null}
              {h.amenities && h.amenities.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {h.amenities.slice(0, 6).map((am, i) => (
                    <span key={i} className="text-[11px] bg-white text-text-body border border-[#E5E7EB] px-1.5 py-0.5 rounded-full">{am}</span>
                  ))}
                </div>
              )}
              <p className="text-[13px] text-[#64748B] leading-relaxed">
                실시간 호텔 검색이 연결되지 않은 <strong className="font-semibold text-[#334155]">참고용 예시</strong>입니다. 마이리얼트립에서 목적지·숙박일을 넣고 검색하면 실제 호텔 페이지·결제로 이어집니다.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[13px] text-text-secondary py-1">상세 정보를 불러오지 못했습니다. 잠시 후 다시 시도하거나 「보기」로 마이리얼트립에서 확인해 주세요.</p>
              {link && (
                <a href={link} target="_blank" rel="noopener noreferrer" className="inline-block text-[12px] font-semibold text-brand underline">
                  마이리얼트립에서 이 숙소 열기
                </a>
              )}
            </div>
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
        {a.imageUrl && isSafeImageSrc(a.imageUrl) ? (
          <SafeCoverImg
            src={a.imageUrl}
            alt={a.name}
            className="w-14 h-14 rounded-xl object-cover shrink-0"
            loading="lazy"
            fallback={<div className="w-14 h-14 rounded-xl bg-[#F3F4F6] shrink-0" aria-hidden />}
          />
        ) : null}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-text-primary leading-tight line-clamp-2">{a.name}</p>
          {a.duration && <p className="text-[11px] text-text-secondary mt-0.5">{a.duration}</p>}
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[14px] font-bold text-brand tabular-nums">{a.price.toLocaleString()}원~</span>
            <div className="flex items-center gap-1.5">
              {gid && link && (
                <button
                  onClick={toggleDetail}
                  className="text-[11px] font-medium text-text-secondary border border-[#E5E7EB] px-2 py-0.5 rounded-full hover:border-brand hover:text-brand transition-colors"
                >
                  {expanded ? '접기' : '상세'}
                </button>
              )}
              {link && (
                <a href={link} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-text-secondary underline hover:text-brand">예약</a>
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
              <svg className="animate-spin w-3 h-3 text-brand" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              <span className="text-[11px] text-text-secondary">불러오는 중...</span>
            </div>
          ) : detail ? (
            <div className="space-y-2">
              {detail.description && (
                <p className="text-[12px] text-text-body leading-relaxed line-clamp-4">{detail.description}</p>
              )}
              {detail.includes && detail.includes.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {detail.includes.slice(0, 4).map((item, i) => (
                    <span key={i} className="text-[10px] bg-green-50 text-green-700 border border-green-100 px-1.5 py-0.5 rounded-full">{item}</span>
                  ))}
                </div>
              )}
              {detail.meetingPoint && (
                <p className="text-[11px] text-text-secondary">📍 {detail.meetingPoint}</p>
              )}

              {/* 날짜별 가격·재고 조회 */}
              <div className="pt-2 border-t border-[#EBEBEB]">
                <p className="text-[10px] font-semibold text-text-body mb-1.5">날짜별 가격·재고</p>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={e => {
                    setSelectedDate(e.target.value);
                    if (e.target.value) fetchOptions(e.target.value);
                  }}
                  className="w-full border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 text-[11px] outline-none focus:border-brand bg-white"
                />
                {optionsLoading && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <svg className="animate-spin w-3 h-3 text-brand" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                    </svg>
                    <span className="text-[11px] text-text-secondary">옵션 조회 중...</span>
                  </div>
                )}
                {options.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {options.slice(0, 4).map((opt, i) => (
                      <div key={i} className="flex items-center justify-between bg-white border border-[#E5E7EB] rounded-lg px-2.5 py-1.5">
                        <span className="text-[11px] text-text-body leading-tight flex-1 pr-2 line-clamp-1">{opt.name}</span>
                        <div className="text-right shrink-0">
                          <span className={`text-[12px] font-bold tabular-nums ${opt.available === false ? 'text-[#C9D0D6] line-through' : 'text-brand'}`}>
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
                  <p className="text-[11px] text-text-secondary mt-1.5">선택 가능한 옵션이 없습니다.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-text-secondary py-1">상세 정보를 가져올 수 없습니다.</p>
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
        <p className="text-[13px] font-semibold text-text-primary mb-2">📅 날짜별 항공 최저가</p>
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
        <p className="text-[13px] font-semibold text-text-primary">📅 날짜별 항공 최저가</p>
        <span className="text-[10px] text-text-secondary">날짜 탭 클릭 시 재검색</span>
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
                  ? 'bg-brand border-brand text-white'
                  : 'bg-[#F7F8FA] border-[#E5E7EB] text-text-body hover:border-brand hover:bg-brand-light'
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
      <p className="text-[10px] text-text-secondary mt-2">* 예상 가격. 실제 예약가는 다를 수 있습니다.</p>
    </section>
  );
}

function DecoyComparison({
  comparison,
  onPackageClick,
}: {
  comparison: ComparisonData;
  onPackageClick?: (pkg: ComparisonPackage) => void;
}) {
  return (
    <section className="bg-gradient-to-br from-brand-light to-[#DBEAFE] rounded-3xl p-5 md:p-6">
      <h2 className="text-[16px] font-bold text-text-primary mb-1">자유여행 vs 여소남 패키지</h2>
      <p className="text-[13px] text-text-body mb-4">같은 여행, 가격을 비교해보세요.</p>

      {/* 자유여행 총액 */}
      <div className="bg-white/70 rounded-2xl p-4 mb-3">
        <p className="text-[12px] text-text-secondary font-medium mb-1">자유여행 예상 비용</p>
        <div className="flex items-baseline gap-1">
          <span className="text-[22px] font-extrabold text-text-primary tabular-nums">
            {comparison.totalMin.toLocaleString()}
          </span>
          <span className="text-[13px] text-text-secondary">원 ~</span>
          <span className="text-[16px] font-bold text-text-secondary tabular-nums">
            {comparison.totalMax.toLocaleString()}원
          </span>
        </div>
        <p className="text-[11px] text-text-secondary mt-0.5">항공 + 숙박 + 액티비티 3개 기준</p>
      </div>

      {/* 패키지 비교 */}
      {comparison.packages.length > 0 && (
        <div className="flex flex-col gap-2">
          {comparison.packages.map(p => (
            <Link key={p.id} href={`/packages/${p.id}`}
              onClick={() => onPackageClick?.(p)}
              className="bg-white rounded-2xl p-4 flex items-center justify-between group hover:shadow-md transition-shadow">
              <div className="flex-1 min-w-0 pr-3">
                <p className="text-[13px] font-semibold text-text-primary leading-tight line-clamp-1">{p.title}</p>
                {p.highlights.slice(0, 2).map((h, i) => (
                  <span key={i} className="inline-block text-[10px] text-brand bg-brand-light px-1.5 py-0.5 rounded-full mr-1 mt-1">{h}</span>
                ))}
              </div>
              <div className="text-right shrink-0">
                <p className="text-[16px] font-extrabold text-text-primary tabular-nums">{p.price.toLocaleString()}원</p>
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

      <p className="text-[12px] text-text-secondary mt-3 text-center">{comparison.message}</p>
    </section>
  );
}

// ─── SSE 파서 ────────────────────────────────────────────────────────────────

async function fetchSSEPlan(
  message: string,
  requestId: string,
  signal: AbortSignal,
  onEvent: (event: string, data: unknown) => void,
  plannerPreferences?: {
    companionType: string;
    hotelBudgetBand: string;
    travelPace: string;
  },
) {
  const response = await fetch('/api/free-travel/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      requestId,
      ...(plannerPreferences
        ? { plannerPreferences }
        : {}),
    }),
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
        // CRLF(\r\n) 프록시 환경에서 event/data 라인 끝 \r 제거 — 미처리 시 case 라벨 불일치로 이벤트 전부 누락 가능
        if (line.startsWith('event: '))      event = line.slice(7).replace(/\r$/, '');
        else if (line.startsWith('data: '))  data  = line.slice(6).replace(/\r$/, '');
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
  { q: '최종 확정·결제는 어떻게 하나요?', a: '이 화면은 견적·일정표 참고용이며, 여소남이 대신 결제를 받지 않습니다. 마음에 드는 항목마다 「예약」「보기」로 이동한 뒤, 해당 사이트(주로 마이리얼트립)에서 날짜·인원을 맞추고 결제하면 됩니다. 아래 「패키지 비교」에서 여소남 상품을 고르면 패키지 상세 페이지의 예약·문의 흐름으로 이어집니다.' },
  { q: '여소남 패키지와의 차이는 무엇인가요?', a: '패키지는 항공·호텔·일정이 모두 포함된 상품입니다. 자유여행보다 저렴한 경우가 많고, 현지 가이드와 이동이 포함됩니다.' },
];

const COMPANION_CHIPS = ['커플/부부', '아이 동반', '부모님 동반', '친구/지인'] as const;
const BUDGET_CHIPS = ['10만원대', '20~30만원대', '40만원 이상'] as const;
const PACE_CHIPS = ['여유', '보통', '빡빡'] as const;

/** 세션에 저장된 추출값을 플래너 칩 값으로 맞춤 */
function normalizeCompanionType(raw: string | null | undefined): string {
  if (!raw?.trim()) return COMPANION_CHIPS[0];
  const s = raw.trim();
  if ((COMPANION_CHIPS as readonly string[]).includes(s)) return s;
  if (/아이|키즈|자녀|유아/i.test(s)) return '아이 동반';
  if (/부모|어르신/i.test(s)) return '부모님 동반';
  if (/친구|지인/i.test(s)) return '친구/지인';
  return '커플/부부';
}

function normalizeHotelBudgetBand(raw: string | null | undefined): string {
  if (!raw?.trim()) return '20~30만원대';
  const s = raw.trim().replace(/-/g, '~');
  if ((BUDGET_CHIPS as readonly string[]).includes(s)) return s;
  if (/10\s*만/i.test(s)) return '10만원대';
  if (/40|럭셔리|프리미엄/i.test(s)) return '40만원 이상';
  if (/20|30/i.test(s)) return '20~30만원대';
  return '20~30만원대';
}

function normalizeTravelPace(raw: string | null | undefined): string {
  if (!raw?.trim()) return '보통';
  const s = raw.trim();
  if ((PACE_CHIPS as readonly string[]).includes(s)) return s;
  if (/여유|느긋|천천/i.test(s)) return '여유';
  if (/빡|촘|다이나믹/i.test(s)) return '빡빡';
  return '보통';
}

export default function FreeTravelClient() {
  const searchParams = useSearchParams();
  const urlPrefillApplied = useRef(false);
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
    itineraryScore: null,
    itinerarySource: null,
    itineraryLlmError: null,
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
  const [shareHint, setShareHint] = useState<string | null>(null);
  const [crosssellVariant, setCrosssellVariant] = useState<CrosssellVariant>('A');
  const trackedExposureRef = useRef<Set<string>>(new Set());

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

  // 홈·챗 등에서 넘긴 쿼리만 초기 입력에 반영 (실제 플랜은 이 페이지에서 실행)
  useEffect(() => {
    if (searchParams.get('session')?.trim()) return;
    if (urlPrefillApplied.current) return;
    const dest = searchParams.get('dest')?.trim();
    const monthRaw = searchParams.get('month')?.trim();
    const theme = searchParams.get('theme')?.trim();
    if (!dest && !monthRaw && !theme) return;
    urlPrefillApplied.current = true;
    const parts: string[] = [];
    if (monthRaw && /^\d{1,2}$/.test(monthRaw)) {
      parts.push(`${parseInt(monthRaw, 10)}월`);
    }
    if (dest) parts.push(dest);
    if (theme === 'family') parts.push('가족과 함께');
    else if (theme === 'parents') parts.push('부모님 모시고');
    else if (theme === 'couple') parts.push('커플');
    const line = `${parts.join(' ')} 여행 견적 잡아줘`.trim();
    setInput((prev) => (prev.trim() ? prev : line));
  }, [searchParams]);

  const sessionRestoreApplied = useRef(false);

  /** 저장된 세션 UUID로 견적 화면 복원 (`/free-travel?session=...`) */
  useEffect(() => {
    if (sessionRestoreApplied.current) return;
    const sid = searchParams.get('session')?.trim();
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!sid || !UUID_RE.test(sid)) return;
    sessionRestoreApplied.current = true;
    let cancelled = false;
    const nightsBetween = (from: string, to: string) => {
      const a = new Date(from).getTime();
      const b = new Date(to).getTime();
      if (Number.isNaN(a) || Number.isNaN(b)) return 3;
      return Math.max(1, Math.round((b - a) / 86400000));
    };
    void (async () => {
      try {
        const res = await fetch(`/api/free-travel/session?id=${encodeURIComponent(sid)}`);
        if (!res.ok) throw new Error('세션 조회 실패');
        const json = (await res.json()) as { session?: Record<string, unknown> | null };
        const session = json.session;
        if (cancelled || !session || typeof session.plan_json !== 'object' || !session.plan_json) {
          sessionRestoreApplied.current = false;
          return;
        }
        const pj = session.plan_json as Record<string, unknown>;
        const pref = pj.plannerPreferences as {
          companionType?: string | null;
          hotelBudgetBand?: string | null;
          travelPace?: string | null;
        } | null | undefined;
        const companionChip = normalizeCompanionType(pref?.companionType);
        const budgetChip = normalizeHotelBudgetBand(pref?.hotelBudgetBand);
        const paceChip = normalizeTravelPace(pref?.travelPace);
        const dateFrom = String(session.date_from ?? '');
        const dateTo = String(session.date_to ?? '');
        const nights = nightsBetween(dateFrom, dateTo);
        const flights = (pj.flights as FlightResult[]) ?? [];
        const skipFlights = flights.length === 0;
        const reconstructedParams: SearchParams = {
          departure:       String(session.departure ?? ''),
          destination:     String(session.destination ?? ''),
          nights,
          adults:          Number(session.pax_adults ?? 2) || 2,
          children:        Number(session.pax_children ?? 0) || 0,
          dateFrom,
          dateTo,
          skipFlights,
          companionType:   companionChip,
          hotelBudgetBand: budgetChip,
          travelPace:      paceChip,
        };
        setCompanionType(companionChip);
        setHotelBudgetBand(budgetChip);
        setTravelPace(paceChip);
        setInput(`${reconstructedParams.destination} ${nights}박 여행 (저장된 견적)`);
        setState(prev => ({
          ...prev,
          status: 'done',
          statusMessage: '저장된 견적을 불러왔습니다.',
          requestId: null,
          params: reconstructedParams,
          flights,
          hotels: (pj.hotels as StayResult[]) ?? [],
          activities: (pj.activities as ActivityResult[]) ?? [],
          hotelsEstimated: false,
          activitiesEstimated: false,
          dayPlans: (pj.dayPlans as DayPlan[]) ?? [],
          itineraryScore: (pj.itineraryScore as ItineraryCompositionScore) ?? null,
          itinerarySource:
            pj.itinerarySource === 'llm' || pj.itinerarySource === 'template'
              ? pj.itinerarySource
              : null,
          itineraryLlmError: typeof pj.itineraryLlmError === 'string' ? pj.itineraryLlmError : null,
          comparison: (pj.comparison as ComparisonData) ?? null,
          aiSummary: typeof pj.aiSummary === 'string' ? pj.aiSummary : '',
          sessionId: String(session.id ?? sid),
          errorMessage: null,
        }));
      } catch {
        sessionRestoreApplied.current = false;
        setState(prev => ({
          ...prev,
          status: 'error',
          errorMessage: '저장된 견적을 불러오지 못했습니다. 링크가 만료되었거나 세션이 없을 수 있습니다.',
        }));
      }
    })();
    return () => { cancelled = true; };
  }, [searchParams]);

  useEffect(() => {
    const saved = window.localStorage.getItem('ft_crosssell_variant');
    if (saved === 'A' || saved === 'B') {
      setCrosssellVariant(saved);
      return;
    }
    const urlVariant = new URLSearchParams(window.location.search).get('ab');
    if (urlVariant === 'A' || urlVariant === 'B') {
      setCrosssellVariant(urlVariant);
      window.localStorage.setItem('ft_crosssell_variant', urlVariant);
      return;
    }
    const picked: CrosssellVariant = Math.random() < 0.5 ? 'A' : 'B';
    setCrosssellVariant(picked);
    window.localStorage.setItem('ft_crosssell_variant', picked);
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
    setShareHint(null);
    setState(prev => ({
      ...prev,
      status: 'searching',
      statusMessage: '시작 중...',
      requestId,
      params: null, flights: [], hotels: [], activities: [], hotelsEstimated: false, activitiesEstimated: false, dayPlans: [],
      itineraryScore: null,
      itinerarySource: null,
      itineraryLlmError: null,
      comparison: null, aiSummary: '', sessionId: null, errorMessage: null,
    }));

    try {
      await fetchSSEPlan(
        msg,
        requestId,
        abortRef.current.signal,
        (event, data) => {
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
            setState(prev => ({
              ...prev,
              dayPlans: (payload.dayPlans as DayPlan[]) ?? [],
              itineraryScore: (payload.itineraryScore as ItineraryCompositionScore) ?? null,
              itinerarySource:
                payload.itinerarySource === 'llm' || payload.itinerarySource === 'template'
                  ? payload.itinerarySource
                  : null,
              itineraryLlmError:
                typeof payload.itineraryLlmError === 'string' ? payload.itineraryLlmError : null,
            }));
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
      },
        {
          companionType,
          hotelBudgetBand,
          travelPace,
        },
      );
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
  }, [companionType, hotelBudgetBand, travelPace]);

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

  const trackRec = useCallback(async (payload: {
    packageId: string;
    outcome: 'click' | null;
    notes: string;
  }) => {
    try {
      await fetch('/api/tracking/recommendation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package_id: payload.packageId,
          source: 'list_badge',
          session_id: state.sessionId ?? undefined,
          intent: companionType || undefined,
          outcome: payload.outcome,
          notes: payload.notes,
        }),
      });
    } catch {
      // silent
    }
  }, [state.sessionId, companionType]);

  useEffect(() => {
    if (!showPackages || !state.comparison?.packages?.length) return;
    for (const pkg of state.comparison.packages) {
      const key = `${state.sessionId ?? 'anon'}:${pkg.id}:exposure`;
      if (trackedExposureRef.current.has(key)) continue;
      trackedExposureRef.current.add(key);
      void trackRec({
        packageId: pkg.id,
        outcome: null,
        notes: `crosssell_exposure_variant_${crosssellVariant}`,
      });
    }
  }, [showPackages, state.comparison, state.sessionId, crosssellVariant, trackRec]);

  return (
    <div className="min-h-screen bg-[#F7F8FA]">
      {/* ── Nav ── */}
      <nav className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-[#E5E7EB] px-4 py-3 flex items-center gap-3">
        <Link href="/" className="text-text-secondary hover:text-text-primary transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </Link>
        <h1 className="text-[17px] font-bold text-text-primary">자유여행 AI 견적</h1>
      </nav>

      {/* ── Hero + 입력 ── */}
      <section className="bg-gradient-to-b from-white to-[#F7F8FA] px-4 pt-8 pb-6">
        <div className="max-w-[640px] mx-auto">
          <p className="text-[13px] font-semibold text-brand mb-2 tracking-wider uppercase">AI 자유여행 플래너</p>
          <h2 className="text-[25px] md:text-[29px] font-extrabold text-text-primary leading-tight tracking-[-0.03em] mb-2">
            항공 + 호텔 + 액티비티<br />30초 AI 견적
          </h2>
          <p className="text-[15px] text-text-body mb-6 leading-snug">자연어로 입력하면 마이리얼트립 실시간 최저가를 비교해드립니다.</p>

          <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch(); } }}
              placeholder="예) 5월 1일~5일 부산출발 다낭 성인2 아동2"
              rows={3}
              className="w-full px-4 pt-4 pb-2 text-[16px] text-text-primary placeholder-[#C9D0D6] resize-none outline-none"
              disabled={isSearching}
            />
            <div className="px-4 pb-2 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] text-text-secondary w-full">누구와 가시나요?</span>
                {['커플/부부', '아이 동반', '부모님 동반', '친구/지인'].map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setCompanionType(option)}
                    className={`px-2.5 py-1 rounded-full text-[12px] border transition-colors ${
                      companionType === option ? 'bg-brand-light border-brand text-brand' : 'border-[#E5E7EB] text-text-body'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] text-text-secondary w-full">호텔 예산은 어느 정도인가요?</span>
                {['10만원대', '20~30만원대', '40만원 이상'].map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setHotelBudgetBand(option)}
                    className={`px-2.5 py-1 rounded-full text-[12px] border transition-colors ${
                      hotelBudgetBand === option ? 'bg-brand-light border-brand text-brand' : 'border-[#E5E7EB] text-text-body'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] text-text-secondary w-full">여행 속도는 어떻게 원하시나요?</span>
                {['여유', '보통', '빡빡'].map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setTravelPace(option)}
                    className={`px-2.5 py-1 rounded-full text-[12px] border transition-colors ${
                      travelPace === option ? 'bg-brand-light border-brand text-brand' : 'border-[#E5E7EB] text-text-body'
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
                className="px-5 py-2.5 bg-brand text-white text-[15px] font-semibold rounded-full hover:bg-[#1b6cf2] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
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
                <p className="text-[13px] font-bold text-text-primary leading-tight">{title}</p>
                <p className="text-[11px] text-text-secondary mt-1">{desc}</p>
              </div>
            ))}
          </div>

          {/* 할인 항공사 배너 */}
          {promoAirlines.length > 0 && (
            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4 shadow-sm">
              <p className="text-[12px] font-semibold text-text-body mb-2.5">✈️ 이번 주 할인 항공사</p>
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
                    className="shrink-0 flex flex-col items-center gap-1 bg-[#F7F8FA] hover:bg-brand-light border border-[#E5E7EB] hover:border-brand px-3 py-2 rounded-xl transition-all cursor-pointer"
                  >
                    {al.imageUrl && isSafeImageSrc(al.imageUrl) ? (
                      <SafeCoverImg
                        src={al.imageUrl}
                        alt={al.airline}
                        className="w-8 h-8 object-contain"
                        loading="lazy"
                        fallback={<span className="text-[20px]">✈️</span>}
                      />
                    ) : (
                      <span className="text-[20px]">✈️</span>
                    )}
                    <span className="text-[11px] font-semibold text-text-primary whitespace-nowrap">{al.airline}</span>
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
              <svg className="animate-spin w-8 h-8 text-brand" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
            </div>
            <p className="text-[15px] font-semibold text-text-primary">{state.statusMessage || '검색 중...'}</p>

            {/* 결과가 오는 대로 미리 보여주기 */}
            {state.flights.length > 0 && (
              <p className="text-[12px] text-brand mt-2">✈️ 항공 {state.flights.length}건 발견</p>
            )}
            {state.hotels.length > 0 && (
              <p className="text-[12px] text-brand mt-0.5">🏨 호텔 {state.hotels.length}건 발견</p>
            )}
            {state.activities.length > 0 && (
              <p className="text-[12px] text-brand mt-0.5">🎡 액티비티 {state.activities.length}건 발견</p>
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

          <section className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl p-4 shadow-sm">
            <h3 className="text-[15px] font-bold text-[#0F172A] mb-1.5">예약·결제는 어떻게 하나요?</h3>
            <p className="text-[13px] text-[#475569] leading-relaxed">
              이 화면은 <strong className="font-semibold text-[#334155]">AI 견적·일정 참고</strong>용입니다. 여소남에서 일괄 결제로 끝나지 않고, 마음에 드는 항공·숙소·액티비티마다 「예약」「보기」를 눌러 마이리얼트립(또는 항공사)에서 날짜·인원을 맞춘 뒤 <strong className="font-semibold text-[#334155]">최종 확정·결제</strong>를 하시면 됩니다. 할인 패키지를 고르시면 여소남 상품 페이지 예약·문의 흐름으로 이어집니다.
            </p>
          </section>

          {/* AI 코멘트 */}
          {state.aiSummary && (
            <div className="bg-brand/5 border border-brand/20 rounded-2xl p-4">
              <p className="text-[14px] text-text-primary leading-relaxed">{state.aiSummary}</p>
            </div>
          )}

          {state.status === 'done' && state.sessionId && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  const url = `${window.location.origin}/free-travel?session=${state.sessionId}`;
                  try {
                    await navigator.clipboard.writeText(url);
                    setShareHint('링크를 복사했습니다. 나중에 같은 화면을 다시 열 수 있어요.');
                    window.setTimeout(() => setShareHint(null), 3500);
                  } catch {
                    setShareHint('복사에 실패했습니다. 주소창의 링크를 직접 공유해 주세요.');
                  }
                }}
                className="text-[12px] font-semibold text-brand hover:underline"
              >
                이 견적 링크 복사
              </button>
              {shareHint && <span className="text-[11px] text-[#64748B]">{shareHint}</span>}
            </div>
          )}

          {state.itineraryScore && (
            <section className="bg-gradient-to-br from-[#F0FDF4] to-[#ECFDF5] border border-[#BBF7D0] rounded-2xl p-4 shadow-sm">
              <h3 className="text-[16px] font-bold text-text-primary mb-1">📊 일정 구성 점수</h3>
              <p className="text-[12px] text-text-body mb-3 leading-snug">
                날씨·계절이 아니라, <strong>이 일정이 얼마나 알차고 균형 잡혔는지</strong>를 나타냅니다. 여소남 승인 패키지 일정·하이라이트와의 결이 맞으면 가산됩니다.
              </p>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-[32px] font-extrabold text-[#166534] tabular-nums leading-none">{state.itineraryScore.score}</span>
                <span className="text-[13px] font-semibold text-[#15803D] pb-1">/ 100</span>
                <span className="text-[13px] font-bold text-text-primary pb-1 ml-1">{state.itineraryScore.label}</span>
              </div>
              <p className="text-[12px] text-[#64748B] mb-2">{state.itineraryScore.summary}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-[#475569]">
                <span>일자 구조 {state.itineraryScore.breakdown.structure}</span>
                <span>풍족함 {state.itineraryScore.breakdown.richness}</span>
                <span>시간대 리듬 {state.itineraryScore.breakdown.rhythm}</span>
                <span>속도 맞춤 {state.itineraryScore.breakdown.paceFit}</span>
                <span className="col-span-2">상품 일정 반영 {state.itineraryScore.breakdown.editorialEcho} · 참조 패키지 {state.itineraryScore.referencePackagesUsed}개</span>
              </div>
            </section>
          )}

          {state.dayPlans.length > 0 && (
            <section className="bg-white border border-[#E5E7EB] rounded-2xl p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 className="text-[15px] font-bold text-text-primary">🗓️ 일자별 추천 일정표</h3>
                {state.itinerarySource === 'llm' && (
                  <span className="text-[10px] font-semibold text-[#0369A1] bg-[#E0F2FE] px-2 py-0.5 rounded-full">
                    AI 일정 (DeepSeek)
                  </span>
                )}
                {state.itinerarySource === 'template' && (
                  <span className="text-[10px] font-medium text-[#64748B] bg-[#F1F5F9] px-2 py-0.5 rounded-full">
                    기본 일정표
                  </span>
                )}
              </div>
              {state.itineraryLlmError && (
                <p
                  className="text-[10px] text-[#94A3B8] mb-2 -mt-1"
                  title={state.itineraryLlmError}
                >
                  AI 일정 단계를 건너뛰고 기본 일정을 씁니다. (원인: {state.itineraryLlmError})
                </p>
              )}
              <div className="space-y-3">
                {state.dayPlans.map(plan => (
                  <article key={plan.day} className="border border-[#EEF0F3] rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[13px] font-bold text-text-primary">{plan.day}일차 · {plan.title}</p>
                      <span className="text-[11px] text-text-secondary">{plan.date}</span>
                    </div>
                    <p className="text-[12px] text-text-body">{plan.move}</p>
                    {plan.stops && plan.stops.length > 0 && (
                      <ul className="mt-2 space-y-1.5 border-t border-[#F1F5F9] pt-2">
                        {plan.stops.map(s => (
                          <li key={s.id} className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-[#334155]">
                            <span className="shrink-0 text-[10px] font-semibold text-[#64748B] w-10">{s.timeHint}</span>
                            <span className="flex-1 min-w-0">{s.label}</span>
                            {s.kind === 'bookable' && (
                              <span className="text-[9px] font-bold uppercase tracking-wide text-[#1D4ED8] bg-blue-50 px-1.5 py-0.5 rounded">예약 연계</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-[11px] text-text-secondary mt-1">{plan.highlight}</p>
                    {plan.hotels.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {plan.hotels.map((hotel, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-[#F8FAFC] border border-[#EEF2F7] rounded-lg px-2.5 py-1.5">
                            <div>
                              <p className="text-[12px] font-medium text-text-primary">{hotel.type === 'recommended' ? '추천 호텔' : '대안 호텔'}: {hotel.name}</p>
                              <p className="text-[10px] text-text-secondary">{hotel.reason}</p>
                            </div>
                            <p className="text-[12px] font-bold text-brand">{hotel.pricePerNight.toLocaleString()}원/박</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {plan.activities.length > 0 && (
                      <div className="mt-2">
                        {plan.activities.map((act, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-[#EEF6FF] border border-[#D9EAFF] rounded-lg px-2.5 py-1.5">
                            <div>
                              <p className="text-[12px] font-semibold text-text-primary">액티비티: {act.title}</p>
                              <p className="text-[10px] text-[#6B7280]">{act.reason}</p>
                            </div>
                            <p className="text-[12px] font-bold text-brand">{act.price.toLocaleString()}원~</p>
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
              <p className="text-[14px] font-bold text-text-primary mb-1">검색 결과가 충분하지 않습니다.</p>
              <p className="text-[12px] text-text-secondary">
                날짜를 1~2일 조정하거나 목적지를 더 구체적으로 입력해 주세요. 예: `5/8~11 부산출발 도야마 성인3 아동1`.
              </p>
            </section>
          )}

          {/* 항공 */}
          {state.flights.length > 0 && (
            <section>
              <h3 className="text-[15px] font-bold text-text-primary mb-2.5 flex items-center gap-1.5">
                ✈️ 항공권
                <span className="text-[11px] font-normal text-text-secondary">최저가 순</span>
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
              <h3 className="text-[15px] font-bold text-text-primary mb-2.5 flex items-center gap-1.5">
                🏨 호텔
                <span className="text-[12px] font-normal text-text-secondary">1박 기준 최저가 순</span>
                {state.hotelsEstimated && <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">추정</span>}
              </h3>
              {state.hotelsEstimated && (
                <p className="text-[12px] text-amber-800 bg-amber-50/80 border border-amber-100 rounded-xl px-3 py-2 mb-2 leading-relaxed">
                  실시간 호텔 API가 연결되지 않아 <strong className="font-semibold">참고용 이름·가격</strong>만 표시 중입니다. 「상세」는 마이리얼트립 실숙소일 때만 풍부한 정보가 열리고, 지금은 예시 숙소이므로 마이리얼트립에서 동일 조건으로 검색해 보세요.
                </p>
              )}
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
              <h3 className="text-[15px] font-bold text-text-primary mb-2.5">🎡 액티비티</h3>
              {state.activitiesEstimated && (
                <p className="text-[12px] text-amber-800 bg-amber-50/80 border border-amber-100 rounded-xl px-3 py-2 mb-2 leading-relaxed">실시간 조회가 되지 않아 추정 데이터를 표시 중입니다. 예약 가능 여부는 링크가 있을 때만 해당 페이지에서 확인할 수 있습니다.</p>
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
              <h3 className="text-[15px] font-bold text-text-primary mb-2">💸 예상 견적 브리핑</h3>
              <div className="space-y-1.5 text-[13px]">
                <div className="flex justify-between"><span className="text-text-body">항공</span><span className="font-semibold text-text-primary">{state.comparison.quoteBreakdown.flights.toLocaleString()}원</span></div>
                <div className="flex justify-between"><span className="text-text-body">호텔</span><span className="font-semibold text-text-primary">{state.comparison.quoteBreakdown.hotels.toLocaleString()}원</span></div>
                <div className="flex justify-between"><span className="text-text-body">액티비티</span><span className="font-semibold text-text-primary">{state.comparison.quoteBreakdown.activities.toLocaleString()}원</span></div>
                <div className="pt-1 border-t border-[#F1F5F9] text-[12px] text-text-secondary">
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
                className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl py-2.5 text-[13px] font-semibold text-[#334155] hover:border-brand hover:text-brand transition-colors"
              >
                {showPackages
                  ? '패키지 비교 접기'
                  : crosssellVariant === 'A'
                    ? '이 일정과 유사한 할인 패키지 확인하기'
                    : '잠깐! 개별 예약보다 저렴한 패키지가 있는지 확인해보기'}
              </button>
              {!showPackages && crosssellVariant === 'B' && (
                <p className="text-[11px] text-[#64748B]">
                  일정은 유지하고 예약 편의성과 비용만 비교해보는 단계입니다.
                </p>
              )}
              {showPackages && (
                <DecoyComparison
                  comparison={state.comparison}
                  onPackageClick={(pkg) => {
                    void trackRec({
                      packageId: pkg.id,
                      outcome: 'click',
                      notes: `crosssell_click_variant_${crosssellVariant}`,
                    });
                  }}
                />
              )}
            </section>
          )}

          {/* 연락처 수집 — 일정표 카카오 전송 게이트 */}
          {state.status === 'done' && !phoneSent && (
            <section className="bg-white border border-[#E5E7EB] rounded-2xl p-5 shadow-sm">
              <p className="text-[15px] font-bold text-text-primary mb-1">📩 일정표 카카오톡으로 받기</p>
              <p className="text-[13px] text-text-body mb-4">
                같은 견적은 링크로 약 7일간 다시 열 수 있습니다. 번호를 남기시면 상세 일정표와 안내를 카카오로 보내드립니다.
              </p>
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="010-0000-0000"
                  inputMode="numeric"
                  className="flex-1 border border-[#E5E7EB] rounded-xl px-4 py-2.5 text-[14px] outline-none focus:border-brand"
                />
                <button
                  onClick={handlePhoneSave}
                  disabled={phoneSaving || !phone.trim()}
                  className="px-4 py-2.5 bg-[#FEE500] text-text-primary text-[14px] font-bold rounded-xl disabled:opacity-50 hover:brightness-95 transition-all whitespace-nowrap"
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

      {/* ── FAQ: 첫 화면·견적 완료 후 모두 (결제 안내 등) ── */}
      {(state.status === 'idle' || state.status === 'done') && (
        <section className="px-4 pb-12 max-w-[640px] mx-auto">
          <h2 className="text-[17px] font-bold text-text-primary mb-4">자주 묻는 질문</h2>
          <div className="space-y-2">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden">
                <summary className="px-4 py-3.5 text-[15px] font-semibold text-text-primary cursor-pointer list-none flex justify-between items-center">
                  {q}
                  <span className="text-[#C9D0D6] text-[18px] select-none">+</span>
                </summary>
                <p className="px-4 pb-4 text-[14px] text-text-body leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
