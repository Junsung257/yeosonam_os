'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import nextDynamic from 'next/dynamic';
import { useSearchParams, useRouter } from 'next/navigation';
import { matchAttractions, normalizeDays } from '@/lib/attraction-matcher';
import type { AttractionData } from '@/lib/attraction-matcher';
import { normalizeOptionalTourName, groupOptionalToursByRegion } from '@/lib/itinerary-render';
import {
  renderPackage, getAirlineName,
  parseCityFromActivity, parseFlightActivity, formatFlightLabel,
  type CanonicalView,
} from '@/lib/render-contract';
import type { NoticeBlock } from '@/lib/standard-terms';
import { NOTICE_DOT_COLOR, NOTICE_CARD_TONE, getSourceBadgeColor } from '@/lib/standard-terms';
import { trackViewContent, trackLead } from '@/components/MetaPixel';
import { filterTiersByDepartureDays } from '@/lib/expand-date-range';
import { openKakaoChannel } from '@/lib/kakaoChannel';
import { getEffectivePriceDates, type PriceDate } from '@/lib/price-dates';
import DepartureCalendar from '@/components/customer/DepartureCalendar';
import GlobalNav from '@/components/customer/GlobalNav';
import type { MonthlyNormal, FitnessScore } from '@/lib/travel-fitness-score';
import type { SeasonalSignal } from '@/lib/seasonal-signals';
import { isSafeImageSrc } from '@/lib/image-url';
import { useChatStore } from '@/lib/chat-store';

const RecommendationCard = nextDynamic(() => import('@/components/customer/RecommendationCard'), { loading: () => null });
const TravelFitnessCard = nextDynamic(() => import('@/components/customer/TravelFitnessCard'), { loading: () => null });
const TimezoneCard = nextDynamic(() => import('@/components/customer/TimezoneCard'), { loading: () => null });
const PackingTipsCard = nextDynamic(() => import('@/components/customer/PackingTipsCard'), { loading: () => null });
const PackageFAQ = nextDynamic(() => import('@/components/customer/PackageFAQ'), { loading: () => null });

interface PriceTier {
  period_label: string;
  departure_dates?: string[];
  departure_day_of_week?: string;
  date_range?: { start: string; end: string };
  adult_price?: number;
  child_price?: number;
  status?: string;
  note?: string;
}

interface DaySchedule {
  day: number;
  regions?: string[];
  meals?: { breakfast?: boolean; lunch?: boolean; dinner?: boolean; breakfast_note?: string; lunch_note?: string; dinner_note?: string };
  schedule?: { time?: string; activity: string; type?: string; transport?: string; note?: string; badge?: string }[];
  hotel?: { name: string; grade?: string; note?: string } | null;
}

interface Package {
  id: string;
  title: string;
  destination?: string;
  duration?: number;
  price?: number;
  airline?: string;
  departure_airport?: string;
  departure_days?: string;
  min_participants?: number;
  min_people?: number;
  ticketing_deadline?: string;
  product_type?: string;
  price_tiers?: PriceTier[];
  price_dates?: { date: string; price: number; child_price?: number; confirmed: boolean }[];
  inclusions?: string[];
  excludes?: string[];
  // ERR-20260418-23: 써차지 객체 배열 (기간별 추가 요금)
  surcharges?: { name?: string; start?: string; end?: string; amount?: number; currency?: string; unit?: string }[];
  optional_tours?: { name: string; price?: string; price_usd?: number }[];
  product_highlights?: string[];
  /** @deprecated 고객 fallback 경로 제거됨. customer_notes/internal_notes 사용. */
  special_notes?: string;
  customer_notes?: string;
  internal_notes?: string;
  notices_parsed?: (string | { type: string; title: string; text: string })[];
  itinerary_data?: { days?: DaySchedule[]; highlights?: { remarks?: string[] } } | DaySchedule[];
  display_title?: string;
  hero_tagline?: string;
  product_summary?: string;
  thumbnail_urls?: string[] | null;
  products?: { display_name?: string; internal_code?: string };
}

interface AttractionInfo {
  name: string; short_desc?: string | null; long_desc?: string | null; badge_type?: string | null; emoji?: string | null;
  aliases?: string[]; photos?: { src_medium: string; src_large: string; photographer: string; pexels_id: number }[];
  country?: string | null; region?: string | null;
}

// W-final F2 — flight/city 파서는 render-contract.ts 단일 소스로 이관.
// 로컬 복사본 제거됨. import 참조:
//   parseCityFromActivity, parseFlightActivity, formatFlightLabel, getAirlineName

const NAV_SECTIONS = ['상품정보', '요금표', '일정표', '선택관광', '유의사항'] as const;

// 보라색 테마 아이콘
function getTimelineIcon(type?: string, activity?: string) {
  if (type === 'flight' && activity && /출발|향발/.test(activity)) return { icon: '✈️', bg: 'bg-brand' };
  if (type === 'flight') return { icon: '🛬', bg: 'bg-brand-light' };
  if (type === 'golf') return { icon: '⛳', bg: 'bg-emerald-500' };
  if (type === 'optional') return { icon: '💎', bg: 'bg-pink-500' };
  if (type === 'shopping') return { icon: '🛍️', bg: 'bg-[#8B95A1]' };
  if (type === 'cruise' || type === 'spa') return { icon: '✨', bg: 'bg-cyan-500' };
  if (activity && /호텔.*체크|투숙|휴식/.test(activity)) return { icon: '🏨', bg: 'bg-brand/60' };
  if (activity && /식사|중식|석식|조식/.test(activity)) return { icon: '🍽️', bg: 'bg-orange-400' };
  if (activity && /이동|출발|공항/.test(activity)) return { icon: '🚌', bg: 'bg-gray-400' };
  return { icon: '📍', bg: 'bg-brand' };
}

interface RelatedBlogPost {
  slug: string;
  seo_title: string | null;
  og_image_url: string | null;
  angle_type: string;
}

interface DestinationBlogPost extends RelatedBlogPost {
  seo_description: string | null;
}

interface DetailClientProps {
  initialPackage: Package | null;
  initialAttractions: AttractionInfo[];
  packageId: string;
  relatedBlogPosts?: RelatedBlogPost[];
  destinationBlogPosts?: DestinationBlogPost[];
  /** 서버에서 4-level 머지로 해소된 약관 블록 (mobile surface). */
  initialNotices?: NoticeBlock[];
  /** destination_climate row (좌표·시차·12개월 normals + fitness + 한국인 인기도). null = 시드 미등록 destination */
  climateData?: {
    destination: string; primary_city: string; country: string | null;
    lat: number; lon: number; timezone: string; utc_offset_minutes: number;
    monthly_normals: unknown; fitness_scores: unknown; seasonal_signals: unknown;
  } | null;
  /** 이 상품의 대표 출발월 (1-12). pickRepresentativeMonths 결과 */
  representativeMonth?: number;
  /** 출발월 분포 (월→횟수). mini bar 의 보조 마커용 */
  departureDistribution?: Record<number, number>;
  /** 사회적 증거 — destination 단위 30일 카운트 + 오늘 조회수 + 다음 출발일 예약 현황 */
  socialProof?: { bookings: number; interest: number; todayViews?: number; nextDepartureBookings?: number; nextDepartureDate?: string | null };
  /** 같은 날 그룹의 다른 패키지 (pairwise 비교 UI용). { '2026-07-08': [rival1, rival2] } */
  rivalsByDate?: Record<string, Array<{
    package_id: string; title: string; rank_in_group: number;
    list_price: number; effective_price: number;
    hotel_avg_grade: number | null; shopping_count: number | null;
    free_option_count: number | null; is_direct_flight: boolean | null;
    breakdown: { list_price?: number; why?: string[]; deductions?: Record<string, number> } | null;
  }>>;
  /** package_scores 출발일별 row N개 (v3 옵션 A — 출발일에 따라 점수 다름) */
  scoreRows?: Array<{
    departure_date: string | null;
    rank_in_group: number;
    group_size: number;
    effective_price: number;
    list_price: number | null;
    shopping_count: number | null;
    hotel_avg_grade: number | null;
    meal_count: number | null;
    free_option_count: number | null;
    is_direct_flight: boolean | null;
    breakdown: {
      list_price?: number;
      why?: string[];
      deductions?: {
        hotel_premium?: number;
        flight_premium?: number;
        shopping_avoidance?: number;
        free_options?: number;
        cold_start_boost?: number;
      };
    } | null;
  }>;
}

const ANGLE_LABELS: Record<string, string> = { value: '가성비', emotional: '감성', filial: '효도', luxury: '럭셔리', urgency: '긴급특가', activity: '액티비티', food: '미식' };

function AttractionPhotoSlide({ src, alt }: { src: string; alt: string }) {
  const [bad, setBad] = useState(false);
  if (bad) {
    return (
      <div
        className="relative shrink-0 w-4/5 h-44 rounded-2xl overflow-hidden snap-center shadow-sm bg-gradient-to-br from-slate-100 to-slate-200 ring-1 ring-slate-200/60"
        aria-hidden
      />
    );
  }
  return (
    <div className="relative shrink-0 w-4/5 h-44 rounded-2xl overflow-hidden snap-center shadow-sm">
      <Image src={src} alt={alt} fill className="object-cover" sizes="80vw" loading="lazy" onError={() => setBad(true)} />
    </div>
  );
}

function BlogOgThumb({ url, title, variant }: { url: string | null | undefined; title: string; variant: 'row' | 'grid' }) {
  const [hide, setHide] = useState(false);
  const ok = isSafeImageSrc(url) && !hide;
  if (variant === 'row') {
    if (!ok) {
      return (
        <div className="flex h-20 w-28 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-light to-[#F2F4F6]">
          <span className="text-3xl">📖</span>
        </div>
      );
    }
    return (
      <div className="relative h-20 w-28 flex-shrink-0 overflow-hidden rounded-xl bg-gray-100">
        <Image src={url!} alt={title || ''} fill className="object-cover" sizes="112px" loading="lazy" onError={() => setHide(true)} />
      </div>
    );
  }
  if (!ok) {
    return (
      <div className="aspect-[4/3] flex items-center justify-center bg-gradient-to-br from-[#F2F4F6] to-brand-light">
        <span className="text-2xl">📖</span>
      </div>
    );
  }
  return (
    <div className="relative aspect-[4/3] bg-gray-100 overflow-hidden">
      <Image src={url!} alt={title || ''} fill className="object-cover" sizes="(max-width: 768px) 100vw, 50vw" loading="lazy" onError={() => setHide(true)} />
    </div>
  );
}

export default function DetailClient({ initialPackage, initialAttractions, packageId, relatedBlogPosts = [], destinationBlogPosts = [], initialNotices = [], climateData = null, representativeMonth = new Date().getMonth() + 1, departureDistribution = {}, scoreRows = [], rivalsByDate = {}, socialProof }: DetailClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  /**
   * 뒤로가기: 브라우저 history 가 있으면 router.back() (referrer 보존),
   * 직접 진입(URL 붙여넣기 등)이면 /packages 로 폴백.
   * 회귀 방지: 이전엔 hardcoded `/packages` 라 /destinations/오사카 → 패키지 → 백 → /packages 로 referrer 유실.
   */
  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/packages');
    }
  };
  const id = packageId;
  const [pkg, setPkg] = useState<Package | null>(initialPackage);
  const [isLoading, setIsLoading] = useState(!initialPackage);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', phone: '', message: '', date: '' });
  const [submitted, setSubmitted] = useState(false);
  const [attractions, setAttractions] = useState<AttractionInfo[]>(initialAttractions);
  const [clipboardToast, setClipboardToast] = useState(false);
  const [shareToast, setShareToast] = useState(false);
  const [attractionModal, setAttractionModal] = useState<AttractionInfo | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [selectedTier, setSelectedTier] = useState<PriceTier | null>(null);

  // CSR 네비게이션 시 referrer가 홈으로 고정되는 문제 대응 — 현재 URL을 sessionStorage에 저장
  useEffect(() => {
    sessionStorage.setItem('kakao_referrer', window.location.href);
  }, []);

  const toggleExpand = (key: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const [selectedDate, setSelectedDate] = useState('');
  const [activeSection, setActiveSection] = useState('상품정보');
  const [activeDay, setActiveDay] = useState(1);
  const dayRefs = useRef<Record<number, HTMLDivElement | null>>({});
  // ERR-20260418-20 — 유의사항 독립 토글 (다중 열림 가능)
  const [expandedNotices, setExpandedNotices] = useState<Set<number>>(new Set());
  const toggleNotice = (idx: number) => {
    setExpandedNotices(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref) fetch(`/api/influencer/track?ref=${encodeURIComponent(ref)}&pkg=${encodeURIComponent(id)}`).catch(() => {});
  }, [id, searchParams]);

  // 캘린더 초기 월 자동 이동은 DepartureCalendar 컴포넌트가 priceDates로부터 처리

  useEffect(() => {
    // 서버에서 초기 데이터를 받은 경우 fetch 스킵
    if (initialPackage) {
      trackViewContent({
        content_name: initialPackage.title || '',
        content_category: initialPackage.destination || '',
        value: initialPackage.price || 0,
        content_ids: [id],
      });
      setIsLoading(false);
      return;
    }
    // 폴백: 클라이언트에서 직접 fetch
    fetch(`/api/packages?id=${encodeURIComponent(id)}`).then(r => r.json()).then(data => {
      const p = data.package ?? null;
      setPkg(p);
      if (p) {
        trackViewContent({
          content_name: p.title || '',
          content_category: p.destination || '',
          value: p.price || 0,
          content_ids: [String(p.id ?? id)],
        });
      }
    }).catch(console.error).finally(() => setIsLoading(false));
    // initialAttractions가 비어 있을 때만 폴백 fetch (불필요 중복 호출 방지)
    if (initialAttractions.length === 0) {
      fetch('/api/attractions?limit=500').then(r => r.json()).then(d => setAttractions(d.attractions || [])).catch(() => {});
    }
  }, [id, initialPackage, initialAttractions.length]);

  const intersectingRef = useRef<Set<string>>(new Set());
  const observerCallback = useCallback((entries: IntersectionObserverEntry[]) => {
    for (const entry of entries) {
      const section = entry.target.getAttribute('data-section') || '';
      if (!section) continue;
      if (entry.isIntersecting) intersectingRef.current.add(section);
      else intersectingRef.current.delete(section);
    }
    // NAV_SECTIONS 순서 기준으로 가장 위쪽 섹션만 활성화 (다중 활성화 방지)
    const ordered = NAV_SECTIONS.filter(s => intersectingRef.current.has(s));
    if (ordered.length > 0) setActiveSection(ordered[0]);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(observerCallback, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });
    Object.values(sectionRefs.current).forEach(el => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [pkg, observerCallback]);

  /** 한 번 이상 스크롤한 뒤 멈춤 → 15초 체류 시 AI 챗 선제 오픈 */
  const proactiveChatDoneRef = useRef(false);
  useEffect(() => {
    if (!pkg || isLoading) return;
    proactiveChatDoneRef.current = false;
    const label = pkg.display_title || pkg.products?.display_name || pkg.title || '이 상품';
    const dest = pkg.destination?.trim() || '목적지';

    let scrollSettle: ReturnType<typeof setTimeout> | null = null;
    let dwell: ReturnType<typeof setTimeout> | null = null;
    let hasScrolled = false;

    const clearDwell = () => {
      if (dwell) {
        clearTimeout(dwell);
        dwell = null;
      }
    };

    const onScroll = () => {
      hasScrolled = true;
      if (scrollSettle) clearTimeout(scrollSettle);
      clearDwell();
      scrollSettle = setTimeout(() => {
        scrollSettle = null;
        dwell = setTimeout(() => {
          if (proactiveChatDoneRef.current) return;
          const st = useChatStore.getState();
          if (st.messages.length > 0 || st.isOpen) return;
          proactiveChatDoneRef.current = true;
          st.openChat();
          st.addMessage({
            role: 'assistant',
            content:
              `**${label}** 상품을 살펴보고 계시네요. ${dest} 일정·요금·일정표에서 궁금한 점이 있으면 여기서 바로 물어보세요.`,
            type: 'text',
          });
        }, 15_000);
      }, 200);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (scrollSettle) clearTimeout(scrollSettle);
      clearDwell();
    };
  }, [pkg, isLoading, packageId]);

  // Day 스크롤 추적: 스크롤하면 현재 보이는 day에 맞춰 탭 자동 활성화
  useEffect(() => {
    const dayObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const dayNum = Number(entry.target.getAttribute('data-day'));
          if (dayNum) setActiveDay(dayNum);
        }
      }
    }, { rootMargin: '-120px 0px -60% 0px', threshold: 0 });
    Object.values(dayRefs.current).forEach(el => { if (el) dayObserver.observe(el); });
    return () => dayObserver.disconnect();
  }, [pkg, attractions]);

  // 미매칭 관광지 수집은 클라이언트에서 제거 (트래픽 폭탄 방지)
  // → 서버사이드(page.tsx)에서 ISR 빌드 시 1회만 실행

  // pkg 의존 헤비 계산은 메모이제이션 (state 변경 시 불필요한 재계산 방지)
  // CRC: renderPackage()는 845줄 모듈의 풀 파이프라인이므로 매 렌더 호출 비용 큼.
  const view: CanonicalView | null = useMemo(
    () => (pkg ? renderPackage(pkg as Parameters<typeof renderPackage>[0]) : null),
    [pkg],
  );
  const days: DaySchedule[] = useMemo(
    () => (pkg ? normalizeDays(pkg.itinerary_data) : []),
    [pkg],
  );
  const tiers = useMemo(
    () => (pkg ? (filterTiersByDepartureDays(pkg.price_tiers || [] as any, pkg.departure_days) as PriceTier[]) : []),
    [pkg],
  );
  const allPriceDates = useMemo(
    () => (pkg ? getEffectivePriceDates(pkg as any) : []),
    [pkg],
  );
  const minPrice = useMemo(() => {
    if (!pkg) return 0;
    const minTier = tiers.length > 0 ? Math.min(...tiers.map(t => t.adult_price || Infinity)) : Infinity;
    const minDate = (pkg.price_dates && pkg.price_dates.length > 0)
      ? Math.min(...pkg.price_dates.map(d => d.price || Infinity))
      : Infinity;
    return Math.min(minTier, minDate, pkg.price || Infinity);
  }, [pkg, tiers]);
  const nextConfirmedDate = useMemo(() => {
    if (!pkg?.price_dates) return null;
    const today = new Date().toISOString().slice(0, 10);
    const confirmed = pkg.price_dates
      .filter(d => d.confirmed && d.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!confirmed.length) return null;
    const d = new Date(confirmed[0].date);
    return `${d.getMonth() + 1}/${d.getDate()} 확정`;
  }, [pkg]);
  const heroUrl = useMemo(() => {
    if (!pkg) return null;
    // destination "다낭/호이안", "방콕/파타야" 등 slash/공백 구분 → 토큰 분리 후 양방향 매칭
    const destTokens = (pkg.destination || '').split(/[\/·, ]+/).map(t => t.trim()).filter(Boolean);
    const photo = attractions.find(a =>
      a.photos && a.photos.length > 0 &&
      destTokens.some(t =>
        (a.country && (a.country.includes(t) || t.includes(a.country))) ||
        (a.region && (a.region.includes(t) || t.includes(a.region)))
      )
    )?.photos?.[0];
    const raw = photo?.src_large || photo?.src_medium;
    return isSafeImageSrc(raw) ? raw.trim() : null;
  }, [pkg, attractions]);
  const [heroImgBroken, setHeroImgBroken] = useState(false);
  useEffect(() => {
    setHeroImgBroken(false);
  }, [heroUrl]);

  // DAY별 첫 번째 관광지 썸네일 (DAY 탭 프리뷰용)
  const dayAttractionPhotos = useMemo(() => {
    return (pkg ? normalizeDays(pkg.itinerary_data) : []).map(day => {
      const firstAct = day.schedule?.find(s => s.activity && (s.type === 'activity' || !s.type));
      if (!firstAct) return null;
      const matched = attractions.find(a =>
        a.name === firstAct.activity || a.aliases?.some(alias => alias === firstAct.activity)
      );
      const src = matched?.photos?.[0]?.src_medium;
      return isSafeImageSrc(src) ? src.trim() : null;
    });
  }, [pkg, attractions]);

  // Hero 멀티 슬라이드 갤러리
  const heroPhotos = useMemo(() => {
    if (!pkg) return [];
    const destTokens = (pkg.destination || '').split(/[\/·, ]+/).map(t => t.trim()).filter(Boolean);
    const attrPhotos = attractions
      .filter(a => a.photos && a.photos.length > 0 && destTokens.some(t =>
        (a.country && (a.country.includes(t) || t.includes(a.country))) ||
        (a.region && (a.region.includes(t) || t.includes(a.region)))
      ))
      .flatMap(a => a.photos || [])
      .slice(0, 5);
    if (attrPhotos.length > 0) return attrPhotos;
    // attraction 사진 없을 때 상품 thumbnail_urls로 폴백
    return (pkg.thumbnail_urls || [])
      .filter(u => isSafeImageSrc(u))
      .slice(0, 5)
      .map(u => ({ src_large: u, src_medium: u, photographer: '', pexels_id: 0 }));
  }, [attractions, pkg]);
  const [heroSlide, setHeroSlide] = useState(0);
  const heroTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startHeroTimer = useCallback(() => {
    if (heroTimerRef.current) clearInterval(heroTimerRef.current);
    heroTimerRef.current = setInterval(() => setHeroSlide(p => (p + 1) % Math.max(heroPhotos.length, 1)), 5000);
  }, [heroPhotos.length]);
  useEffect(() => {
    if (heroPhotos.length > 1) startHeroTimer();
    return () => { if (heroTimerRef.current) clearInterval(heroTimerRef.current); };
  }, [heroPhotos.length, startHeroTimer]);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-gray-500">불러오는 중...</div>;
  if (!pkg || !view) return <div className="min-h-screen flex flex-col items-center justify-center text-gray-500"><p className="text-lg mb-4">상품을 찾을 수 없습니다.</p><Link href="/packages" className="text-blue-600 underline">목록으로</Link></div>;
  const selectedDateInfo = selectedDate ? allPriceDates.find(d => d.date === selectedDate) : null;
  // 카드 상단 "판매가": 사용자가 명시 선택한 경우(selectedTier/selectedDate)에만 그 가격, 아니면 항상 최저가
  // ERR-LB-DAD-displayprice@2026-04-20: 디폴트 selectedDate가 자동 설정되어 최저가 대신 4/22 가격(1,309,000)이 표시되는 사고 방지
  const displayPrice = selectedTier?.adult_price ?? (selectedDate ? selectedDateInfo?.price : null) ?? minPrice;
  const airlineName = view.airlineHeader.airlineName ?? pkg.airline ?? null;

  // ERR-KUL-05 / Phase 2 — view.flightHeader 단일 소비. pkg.itinerary_data 직접 파싱 금지.
  // JSX 호환: flightDep/flightReturn 로컬 프록시 (기존 렌더 로직 보존).
  const flightDep = view.flightHeader.outbound
    ? {
        time: view.flightHeader.outbound.depTime ?? null,
        transport: view.flightHeader.outbound.code ?? null,
        activity: view.flightHeader.outbound.label,
      }
    : null;
  const flightReturn = view.flightHeader.inbound
    ? {
        time: view.flightHeader.inbound.depTime ?? null,
        transport: view.flightHeader.inbound.code ?? null,
        activity: view.flightHeader.inbound.label,
        depCity: view.flightHeader.inbound.depCity,
      }
    : null;
  const depArrTime = view.flightHeader.outbound?.arrTime ?? undefined;
  const depArrCity = view.flightHeader.outbound?.arrCity ?? (pkg.destination || '').split('/')[0];
  const retArrTime = view.flightHeader.inbound?.arrTime ?? undefined;

  const handleSubmit = async () => {
    if (!formData.name || !formData.phone || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: id,
          channel: 'landing_page',
          form: {
            name: formData.name,
            phone: formData.phone,
            desiredDate: formData.date || selectedTier?.period_label || null,
            adults: 1,
            children: 0,
            privacyConsent: true,
          },
          tracking: {
            landingUrl: window.location.href,
            utmSource: new URLSearchParams(window.location.search).get('utm_source') || null,
            utmMedium: new URLSearchParams(window.location.search).get('utm_medium') || null,
            utmCampaign: new URLSearchParams(window.location.search).get('utm_campaign') || null,
          },
          submittedAt: new Date().toISOString(),
        }),
      });
    } catch { /* 전송 실패해도 UI는 정상 표시 */ }
    finally { setIsSubmitting(false); }
    setSubmitted(true);
    setTimeout(() => { setShowForm(false); setSubmitted(false); setFormData({ name: '', phone: '', message: '', date: '' }); }, 3000);
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) { try { await navigator.share({ title: pkg.title, url }); } catch {} }
    else {
      await navigator.clipboard.writeText(url);
      setShareToast(true);
      setTimeout(() => setShareToast(false), 2500);
    }
  };

  const scrollToSection = (section: string) => sectionRefs.current[section]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // currentDay는 일정표 days.map 루프 내에서 정의됨

  return (
    <>
      {/* 데스크톱 전용 GlobalNav — 모바일은 히어로 위 오버레이 ← 버튼 유지 (immersive) */}
      <div className="hidden md:block">
        <GlobalNav />
      </div>
    <main className="min-h-screen bg-white pb-24 md:pb-12 max-w-lg md:max-w-3xl mx-auto" data-testid="main-content">

      {/* ═══ 히어로 (사진 배경) ═══ */}
      <div ref={el => { sectionRefs.current['상품정보'] = el; }} data-section="상품정보"
        className="relative h-[420px] md:h-[560px] w-full overflow-hidden md:rounded-b-3xl">
        {/* 멀티 슬라이드 갤러리: 수동 스와이프 시 자동전환 중지 */}
        <div
          className="absolute inset-0"
          onTouchStart={() => { if (heroTimerRef.current) { clearInterval(heroTimerRef.current); heroTimerRef.current = null; } }}
        >
          {heroPhotos.length > 0 && !heroImgBroken ? (
            heroPhotos.map((photo, idx) => {
              const src = photo.src_large || photo.src_medium;
              if (!isSafeImageSrc(src)) return null;
              return (
                <Image
                  key={idx}
                  src={src.trim()}
                  alt={pkg.destination || ''}
                  fill
                  className={`object-cover transition-opacity duration-700 ${idx === heroSlide ? 'opacity-100' : 'opacity-0'}`}
                  sizes="100vw"
                  priority={idx === 0}
                  onError={() => { if (idx === heroSlide) setHeroImgBroken(true); }}
                />
              );
            })
          ) : heroUrl && !heroImgBroken ? (
            <Image
              src={heroUrl}
              alt={pkg.destination || ''}
              fill
              className="object-cover"
              sizes="100vw"
              priority
              onError={() => setHeroImgBroken(true)}
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-text-primary via-brand-dark to-brand" />
          )}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        {/* 상단 네비 */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 pt-12">
          <button
            type="button"
            onClick={handleBack}
            aria-label="뒤로 가기"
            className="w-10 h-10 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-md"
          >
            <span className="text-white text-lg">←</span>
          </button>
          <div className="flex gap-2">
            <button onClick={handleShare} className="w-10 h-10 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-md">
              <span className="text-white">↗</span>
            </button>
            <button className="w-10 h-10 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-md">
              <span className="text-white">♡</span>
            </button>
          </div>
        </div>

        {/* 히어로 콘텐츠 */}
        <div className="absolute bottom-0 left-0 right-0 p-5 pb-8">
          {pkg.product_type && (
            <span className="bg-brand text-white px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-3 inline-block">{pkg.product_type}</span>
          )}
          {/* 2-tier hero (2026-04-29):
              ① Headline (h1, 큰 굵은 글씨, 8~14자) — display_title
              ② Tagline  (sub, 톤 다운, ≤40자)     — hero_tagline
              레거시 폴백: display_title 안에 "—"가 있으면 split해서 헤드라인/서브로 분리. */}
          {(() => {
            const raw = pkg.display_title || pkg.products?.display_name || pkg.title;
            const dashIdx = raw.indexOf(' — ');
            const legacyHeadline = dashIdx > 0 ? raw.slice(0, dashIdx) : raw;
            const legacyTail = dashIdx > 0 ? raw.slice(dashIdx + 3) : '';
            const headline = legacyHeadline;
            const tagline = pkg.hero_tagline || (legacyTail ? legacyTail.split(' + ').slice(0, 2).join(' · ') : '');
            return (
              <>
                <h1 className="text-white text-[26px] md:text-3xl font-extrabold leading-tight mb-1.5 break-keep">{headline}</h1>
                {tagline && (
                  <p className="text-white/85 text-sm font-medium leading-snug mb-3 break-keep">{tagline}</p>
                )}
              </>
            );
          })()}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {pkg.destination && <span className="bg-white/20 backdrop-blur-sm text-white/90 text-xs px-2.5 py-1 rounded-full">#{pkg.destination}</span>}
            {airlineName && <span className="bg-white/20 backdrop-blur-sm text-white/90 text-xs px-2.5 py-1 rounded-full">#{airlineName}</span>}
            {pkg.duration && <span className="bg-white/20 backdrop-blur-sm text-white/90 text-xs px-2.5 py-1 rounded-full">#{pkg.duration}일</span>}
          </div>
        </div>

        {/* 갤러리 도트 인디케이터 */}
        {heroPhotos.length > 1 && (
          <div className="absolute bottom-14 left-0 right-0 flex justify-center gap-1.5 pointer-events-none">
            {heroPhotos.map((_, i) => (
              <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === heroSlide ? 'w-4 bg-white' : 'w-1.5 bg-white/40'}`} />
            ))}
          </div>
        )}
        {/* 갤러리 카운터 */}
        {heroPhotos.length > 1 && (
          <div className="absolute bottom-16 right-4 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full tabular-nums">
            {heroSlide + 1} / {heroPhotos.length}
          </div>
        )}
      </div>

      {/* ═══ 가격 카드 (플로팅) ═══ */}
      <section className="px-4 -mt-6 relative z-10">
        <div className="bg-white rounded-2xl p-5 shadow-lg border border-gray-100">
          {/* Social Proof + 희소성 신호 — 서버에서 내려온 실제 데이터만 표시 */}
          {socialProof && (socialProof.bookings > 0 || socialProof.interest > 0 || (socialProof.todayViews ?? 0) > 0 || (socialProof.nextDepartureBookings ?? 0) > 0) && (
            <div className="mb-3 pb-3 border-b border-gray-50 space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {(socialProof.todayViews ?? 0) > 2 && (
                  <span className="text-xs text-orange-600 flex items-center gap-1 font-medium">
                    👀 오늘 <strong>{socialProof.todayViews}명</strong> 조회 중
                  </span>
                )}
                {socialProof.bookings > 0 && (
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    🔥 이번달 <strong className="text-gray-800">{socialProof.bookings}명</strong> 예약
                  </span>
                )}
              </div>
              {(socialProof.nextDepartureBookings ?? 0) > 0 && socialProof.nextDepartureDate && (() => {
                const minP = pkg.min_people ?? 4;
                const booked = socialProof!.nextDepartureBookings!;
                const remaining = Math.max(0, minP - booked);
                const m = parseInt(socialProof!.nextDepartureDate!.split('-')[1]);
                const d = parseInt(socialProof!.nextDepartureDate!.split('-')[2]);
                return remaining > 0 ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-brand rounded-full transition-all" style={{ width: `${Math.min(100, (booked / minP) * 100)}%` }} />
                    </div>
                    <span className="text-[11px] text-brand font-bold whitespace-nowrap">
                      {m}/{d} 출발 확정까지 {remaining}명
                    </span>
                  </div>
                ) : (
                  <span className="text-[11px] text-emerald-600 font-bold">✅ {m}/{d} 출발 확정!</span>
                );
              })()}
            </div>
          )}
          <div className="flex justify-between items-start">
            <div>
              <p className="text-gray-500 text-sm mb-1">판매가</p>
              <div className="flex items-baseline gap-1">
                <span className="text-[28px] font-black text-gray-900">₩{(displayPrice || 0).toLocaleString()}</span>
                <span className="text-gray-500 text-sm">~</span>
              </div>
            </div>
            {pkg.ticketing_deadline && (() => {
              const deadline = new Date(pkg.ticketing_deadline);
              const today = new Date();
              today.setHours(0,0,0,0); deadline.setHours(0,0,0,0);
              const diffDays = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              const dDayText = diffDays <= 0 ? '마감' : `D-${diffDays}`;
              const urgentColor = diffDays <= 3 ? 'bg-red-500 text-white animate-pulse' : diffDays <= 7 ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-600';
              return (
                <span className={`text-xs font-bold px-2.5 py-1.5 rounded-lg ${urgentColor}`}>
                  ⏰ {dDayText} ({(deadline.getMonth()+1)}/{deadline.getDate()} 마감)
                </span>
              );
            })()}
          </div>

          {/* 핵심 특전 — highlights 없으면 inclusions.program에서 최대 4개 fallback */}
          {(() => {
            const items = pkg.product_highlights && pkg.product_highlights.length > 0
              ? pkg.product_highlights.slice(0, 4)
              : (view?.inclusions.program ?? []).filter(p => /직항|마사지|무료|팁|입장료|가이드|업그레이드/.test(p)).slice(0, 4);
            if (items.length === 0) return null;
            return (
              <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-gray-100">
                {items.map((h, i) => {
                  const icon = /직항/.test(h) ? '✈️' : /마사지/.test(h) ? '💆' : /무료|업그레이드/.test(h) ? '🎁' : /팁.*포함|포함.*팁|팁전부/.test(h) ? '✅' : /호텔|리조트|스파/.test(h) ? '🏨' : /가이드/.test(h) ? '👤' : '✨';
                  return <span key={i} className="bg-brand-light text-brand px-2.5 py-1 rounded-lg text-xs font-medium">{icon} {h}</span>;
                })}
              </div>
            );
          })()}
        </div>
      </section>

      {/* ═══ 인라인 CTA #1 — 가격 카드 바로 아래 (구매 충동 포착) ═══ */}
      <div className="px-4 mt-3 mb-1">
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="w-full h-11 rounded-2xl bg-brand text-white font-bold text-sm shadow-sm active:scale-[0.98] transition-all flex items-center justify-center gap-2"
        >
          <span>예약 문의하기</span>
          <span className="text-white/70 text-xs font-normal">— 날짜·인원 선택</span>
        </button>
      </div>

      {/* ═══ 추천 카드 — 출발일별 동적 점수 (v3 옵션 A) ═══
          selectedDate가 있으면 그 날의 score, 없으면 가장 가까운 미래 출발일.
          출발일 따라 group_size·rank·effective_price 모두 다르게 표시됨. */}
      {(() => {
        if (scoreRows.length === 0) return null;
        // selectedDate 우선 → 가장 가까운 미래 출발일 폴백
        const today = new Date().toISOString().slice(0, 10);
        const future = scoreRows.filter(r => r.departure_date && r.departure_date >= today);
        const target = (selectedDate && scoreRows.find(r => r.departure_date === selectedDate))
          || future[0]
          || scoreRows[0];
        if (!target) return null;
        if (target.group_size < 2 || target.rank_in_group > 3) return null;
        return (
          <RecommendationCard
            rankInGroup={target.rank_in_group}
            groupSize={target.group_size}
            effectivePrice={Number(target.effective_price) || 0}
            listPrice={Number(target.list_price) || Number(target.breakdown?.list_price) || pkg.price || 0}
            departureDate={target.departure_date}
            deductions={target.breakdown?.deductions ?? {}}
            features={{
              shopping_count: target.shopping_count ?? null,
              hotel_avg_grade: target.hotel_avg_grade ?? null,
              free_option_count: target.free_option_count ?? null,
              is_direct_flight: target.is_direct_flight ?? null,
            }}
            productHighlights={pkg.product_highlights ?? []}
            socialProof={socialProof}
            packageId={pkg.id}
            rivals={target.departure_date ? rivalsByDate[target.departure_date] ?? [] : []}
          />
        );
      })()}

      {/* ═══ 여행 적합도 + 시차 (destination_climate 시드된 destination만 노출) ═══ */}
      {climateData && Array.isArray(climateData.monthly_normals) && Array.isArray(climateData.fitness_scores) && (
        <>
          <TravelFitnessCard
            destination={climateData.destination}
            primaryCity={climateData.primary_city}
            country={climateData.country}
            monthlyNormals={climateData.monthly_normals as MonthlyNormal[]}
            fitnessScores={climateData.fitness_scores as FitnessScore[]}
            seasonalSignals={(climateData.seasonal_signals as SeasonalSignal[]) ?? null}
            representativeMonth={representativeMonth}
            departureDistribution={departureDistribution}
          />
          <TimezoneCard
            destination={climateData.destination}
            primaryCity={climateData.primary_city}
            country={climateData.country}
            offsetMinutes={climateData.utc_offset_minutes}
            timezone={climateData.timezone}
          />
          {/* PackingTipsCard 는 유의사항 위로 이동 (사장님 피드백 2026-04-29) */}
        </>
      )}

      {/* ═══ 상품 감성 스토리 (product_summary 인젝션) ═══ */}
      {/* product_summary 포맷 (feedback_product_summary_tone.md):
          [이모지+따옴표 헤더 한 줄]\n\n[본문 2~3문장]
          첫 \n\n으로 분리: 첫 단락은 헤더 강조, 나머지는 본문 */}
      {pkg.product_summary && (() => {
        const parts = pkg.product_summary.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
        const header = parts.length > 1 ? parts[0] : null;
        const body = parts.length > 1 ? parts.slice(1).join('\n\n') : pkg.product_summary;
        return (
          <div className="px-5 mt-8 border-b border-gray-100 pb-6 relative">
            <div className="absolute top-0 right-5 text-4xl opacity-5">❞</div>
            <h2 className="text-lg font-extrabold text-gray-900 mb-3">여소남의 추천 코멘트 ✍️</h2>
            {header && (
              <p className="text-base font-bold text-brand mb-3 leading-snug break-keep">
                {header}
              </p>
            )}
            <p className="text-sm text-gray-600 leading-loose break-keep whitespace-pre-line">
              {body}
            </p>
          </div>
        );
      })()}

      {/* ═══ 아이콘 정보바 (모두투어 스타일) ═══ */}
      <div className="flex justify-around py-5 px-4 mt-4 border-b border-gray-100">
        {pkg.duration && (
          <div className="flex flex-col items-center gap-1">
            <span className="text-xl">📅</span>
            <span className="text-sm font-bold text-gray-700">{pkg.duration}일</span>
          </div>
        )}
        {airlineName && (
          <div className="flex flex-col items-center gap-1">
            <span className="text-xl">✈️</span>
            <span className="text-sm font-bold text-gray-700">{airlineName}</span>
          </div>
        )}
        {pkg.min_participants && (
          <div className="flex flex-col items-center gap-1">
            <span className="text-xl">👥</span>
            <span className="text-sm font-bold text-gray-700">최소 {pkg.min_participants}명</span>
          </div>
        )}
        <div className="flex flex-col items-center gap-1">
          <span className="text-xl">🏷️</span>
          <span className="text-sm font-bold text-gray-700">{pkg.product_type || '단체'}</span>
        </div>
      </div>

      {/* ═══ 항공편 카드 (가는편 + 오는편) ═══ */}
      {flightDep && (
        <div className="px-4 py-5">
          <div className="bg-gray-50 rounded-2xl border border-gray-100 overflow-hidden">
            {/* 가는편 */}
            <div className="p-4">
              <p className="text-xs font-bold text-brand mb-2.5">가는편</p>
              <div className="flex items-center justify-between">
                <div className="text-center min-w-[60px]">
                  {flightDep.time && <p className="text-xl font-black text-gray-900 tabular-nums">{flightDep.time}</p>}
                  <p className="text-xs text-gray-500 mt-0.5">{(pkg.departure_airport || '김해').replace(/\s*(국제)?공항.*$/, '')}</p>
                </div>
                <div className="flex flex-col items-center flex-1 px-2">
                  <div className="flex items-center w-full gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-brand shrink-0" />
                    <div className="flex-1 h-[1px] bg-brand-light" />
                    <span className="text-brand text-sm shrink-0">✈</span>
                    <div className="flex-1 h-[1px] bg-brand-light" />
                    <div className="w-1.5 h-1.5 rounded-full bg-brand shrink-0" />
                  </div>
                  <div className="text-center mt-1">
                    {airlineName && <span className="text-[10px] text-gray-600 font-medium">{airlineName}</span>}
                    {flightDep.transport && <span className="text-[10px] text-gray-400 ml-1">{formatFlightLabel(flightDep.transport)}</span>}
                    <span className="text-[10px] text-gray-400 ml-1">직항</span>
                  </div>
                </div>
                <div className="text-center min-w-[60px]">
                  <p className="text-xl font-black text-gray-900 tabular-nums">{depArrTime || '—'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{depArrCity}</p>
                </div>
              </div>
            </div>
            {/* 구분선 */}
            <div className="border-t border-dashed border-gray-200 mx-4" />
            {/* 오는편 */}
            {flightReturn && (
            <div className="p-4">
              <p className="text-xs font-bold text-orange-500 mb-2.5">오는편</p>
              <div className="flex items-center justify-between">
                <div className="text-center min-w-[60px]">
                  <p className="text-xl font-black text-gray-900 tabular-nums">{flightReturn.time || '—'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{flightReturn.depCity || (pkg.destination || '').split('/')[0]}</p>
                </div>
                <div className="flex flex-col items-center flex-1 px-2">
                  <div className="flex items-center w-full gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                    <div className="flex-1 h-[1px] bg-orange-200" />
                    <span className="text-orange-400 text-sm shrink-0">✈</span>
                    <div className="flex-1 h-[1px] bg-orange-200" />
                    <div className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                  </div>
                  <div className="text-center mt-1">
                    {airlineName && <span className="text-[10px] text-gray-600 font-medium">{airlineName}</span>}
                    {flightReturn.transport && <span className="text-[10px] text-gray-400 ml-1">{formatFlightLabel(flightReturn.transport)}</span>}
                    <span className="text-[10px] text-gray-400 ml-1">직항</span>
                  </div>
                </div>
                <div className="text-center min-w-[60px]">
                  <p className="text-xl font-black text-gray-900 tabular-nums">{retArrTime || '—'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{(pkg.departure_airport || '김해').replace(/\s*(국제)?공항.*$/, '')}</p>
                </div>
              </div>
            </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ 스티키 탭 ═══ */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-xl border-b border-gray-100">
        <div className="flex gap-0 px-4">
          {NAV_SECTIONS.map(section => (
            <button key={section} onClick={() => scrollToSection(section)}
              className={`flex-1 py-3.5 text-xs font-semibold text-center transition-colors border-b-2 ${
                activeSection === section ? 'text-brand border-brand' : 'text-gray-500 border-transparent'
              }`}>{section}</button>
          ))}
        </div>
      </div>

      {/* ═══ 요금표 ═══ */}
      {(tiers.length > 0 || allPriceDates.length > 0) && (
        <div ref={el => { sectionRefs.current['요금표'] = el; }} data-section="요금표" className="px-4 py-8 scroll-mt-[108px]">
          <h2 className="text-lg font-extrabold text-gray-900 mb-5">출발일 선택</h2>
          {allPriceDates.length === 0 ? (
            // price_dates / departure_dates 둘 다 없는 경우 → tier 카드 폴백
            <div className="space-y-2">
              {tiers.map((t, i) => {
                const isSelected = selectedTier === t;
                const isMin = t.adult_price === minPrice;
                return (
                  <button key={i} onClick={() => { setSelectedTier(isSelected ? null : t); setSelectedDate(isSelected ? '' : t.period_label); setFormData(f => ({ ...f, date: isSelected ? '' : `${t.period_label} ${t.departure_day_of_week || ''}`.trim() })); }}
                    className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl border text-left transition ${isSelected ? 'border-brand bg-brand-light ring-1 ring-brand' : 'border-gray-200 bg-white'}`}>
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {t.period_label}
                        {t.status === 'confirmed' && <span className="ml-1.5 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-bold">확정</span>}
                        {t.status === 'soldout' && <span className="ml-1.5 text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold">마감</span>}
                      </p>
                      {t.departure_day_of_week && <p className="text-xs text-gray-500">{t.departure_day_of_week}</p>}
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${t.status === 'soldout' ? 'text-gray-500 line-through' : isMin ? 'text-brand' : 'text-gray-900'}`}>₩{t.adult_price?.toLocaleString()}</p>
                      {isMin && t.status !== 'soldout' && <span className="text-xs bg-brand-light text-brand px-1.5 py-0.5 rounded-full">최저가</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-4 border border-gray-100">
              <DepartureCalendar
                priceDates={allPriceDates as PriceDate[]}
                selectedDate={selectedDate}
                onSelect={(date) => {
                  if (selectedDate === date) {
                    setSelectedDate('');
                    setFormData(f => ({ ...f, date: '' }));
                    setSelectedTier(null);
                    return;
                  }
                  setSelectedDate(date);
                  setSelectedTier(null);
                  const m = parseInt(date.split('-')[1]);
                  const d = parseInt(date.split('-')[2]);
                  setFormData(f => ({ ...f, date: `${m}/${d}` }));
                }}
              />
              {selectedDateInfo && (
                <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500">선택한 출발일</p>
                    <p className="text-sm font-bold text-gray-900">
                      {parseInt(selectedDate.split('-')[1])}월 {parseInt(selectedDate.split('-')[2])}일
                      {selectedDateInfo.confirmed && <span className="ml-1.5 text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-bold">확정</span>}
                    </p>
                  </div>
                  <p className="text-base font-extrabold text-brand">₩{selectedDateInfo.price.toLocaleString()}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ 인라인 CTA #2 — 달력 섹션 바로 아래 (날짜 선택 직후 포착) ═══ */}
      {(tiers.length > 0 || allPriceDates.length > 0) && (
        <div className="px-4 -mt-2 mb-2">
          {selectedDate ? (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="w-full h-12 rounded-2xl bg-brand text-white font-bold text-sm shadow-md active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <span>
                {parseInt(selectedDate.split('-')[1])}/{parseInt(selectedDate.split('-')[2])} 출발 예약하기
              </span>
              {selectedDateInfo && (
                <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">
                  ₩{selectedDateInfo.price.toLocaleString()}
                </span>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="w-full h-10 rounded-2xl border-2 border-brand text-brand font-semibold text-sm active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
            >
              <span>💬</span>
              <span>날짜 미정 — 카톡으로 먼저 상담하기</span>
            </button>
          )}
        </div>
      )}

      {/* ═══ 포함/불포함/써차지 ═══ */}
      {/* Phase 1 CRC: view.inclusions 소비 — 아이콘 매칭 완료된 basic + 프로그램 분류 */}
      {(view.inclusions.basic.length || view.inclusions.program.length || view.excludes.basic.length || view.surchargesMerged.length) ? (
        <div className="px-4 py-6 space-y-3">
          {(view.inclusions.basic.length > 0 || view.inclusions.program.length > 0) && (
            <div className="bg-brand-light/50 rounded-2xl p-4">
              <h3 className="text-xs font-bold text-text-primary mb-3">✅ 포함 사항</h3>
              <ul className="space-y-1.5">
                {view.inclusions.basic.map((item, i) => (
                  <li key={i} className="text-sm text-text-primary flex gap-2 leading-relaxed">
                    <span className="shrink-0 text-base leading-snug">{item.icon}</span>{item.text}
                  </li>
                ))}
                {view.inclusions.program.length > 0 && (
                  <li className="pt-2 mt-1.5 border-t border-brand-light text-xs text-brand leading-relaxed">
                    <span className="mr-1">✨</span>{view.inclusions.program.join(' · ')}
                  </li>
                )}
              </ul>
            </div>
          )}
          {/* W1 CRC — 불포함/써차지 병합은 view에서 이미 해결됨 (ERR-20260418-14/24) */}
          {view.excludes.basic.length > 0 && (
            <div className="bg-red-50/30 rounded-2xl p-4">
              <h3 className="text-xs font-bold text-red-800 mb-3">❌ 불포함 사항</h3>
              <ul className="space-y-1.5">
                {view.excludes.basic.map((item, i) => (
                  <li key={i} className="text-sm text-red-700 flex gap-2 leading-relaxed">
                    <span className="shrink-0 text-red-300">•</span>
                    <span>
                      {item}
                      {/마사지팁/.test(item) && <span className="text-red-400 text-xs ml-1">(60분 $2, 90분 $3, 120분 $4)</span>}
                      {/매너팁|가이드팁/.test(item) && !/마사지/.test(item) && <span className="text-red-400 text-xs ml-1">(약 $1~2/일)</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {view.surchargesMerged.length > 0 && (() => {
            // 기간(start/end)이 있는 써차지가 하나라도 있으면 "기간별" 제목 + 안내문구 표시
            const hasPeriod = view.surchargesMerged.some(s => s.structured?.start);
            return (
              <div className="bg-orange-50/50 rounded-2xl p-4">
                <h3 className="text-xs font-bold text-orange-800 mb-3">💲 {hasPeriod ? '기간별 추가 요금' : '추가 요금'}</h3>
                <ul className="space-y-1.5">
                  {view.surchargesMerged.map((s, i) => (
                    <li key={i} className="text-sm text-orange-800 flex gap-2 leading-relaxed">
                      <span className="shrink-0 text-orange-300">•</span>
                      {s.structured ? (
                        <span>
                          <b>{s.name || '추가요금'}</b>
                          {s.period && <span className="text-orange-600"> ({s.period})</span>}
                          {s.priceLabel && <span className="font-semibold">: {s.priceLabel}</span>}
                        </span>
                      ) : (
                        <span>{s.label}</span>
                      )}
                    </li>
                  ))}
                </ul>
                {hasPeriod && (
                  <p className="text-[11px] text-orange-600 mt-2 italic">※ 위 기간 출발 시 1박당 해당 금액이 추가됩니다.</p>
                )}
              </div>
            );
          })()}
          {/* ERR-HET-mobile-shopping-missing@2026-04-22 — A4 에는 있지만 모바일엔 쇼핑센터 섹션이 누락돼
              품격 상품의 "쇼핑 3회" 정보가 고객 화면에 안 노출됨. view.shopping(CRC) 를 소비해 추가. */}
          {view.shopping.text && !/노쇼핑/.test(view.shopping.text) && (
            <div className="bg-brand-light/50 rounded-2xl p-4">
              <h3 className="text-xs font-bold text-text-primary mb-2">🛍️ 쇼핑센터</h3>
              <p className="text-sm text-text-primary leading-relaxed">{view.shopping.text}</p>
            </div>
          )}
        </div>
      ) : null}

      {/* ═══ 일정표 ═══ */}
      {days.length > 0 && (
        <div ref={el => { sectionRefs.current['일정표'] = el; }} data-section="일정표" className="px-4 py-8 scroll-mt-[108px]">
          <h2 className="text-lg font-extrabold text-gray-900 mb-5">여행 일정</h2>

          {/* Day 탭 (Voyager 스타일 pill) — 클릭 시 해당 day로 스크롤 */}
          <div className="sticky top-[44px] z-20 bg-white/95 backdrop-blur-md -mx-4 px-4 pb-3 pt-1">
            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
              {days.map((day, idx) => {
                const thumb = dayAttractionPhotos[idx];
                const isActive = activeDay === day.day;
                return (
                  <button key={day.day} onClick={() => {
                      setActiveDay(day.day);
                      dayRefs.current[day.day]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className={`flex-shrink-0 flex flex-col items-center px-4 py-2.5 rounded-2xl transition-all border ${
                      isActive
                        ? 'bg-brand text-white border-brand shadow-lg'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-brand-light'
                    }`}>
                    {thumb ? (
                      <div className={`relative w-8 h-8 rounded-full overflow-hidden mb-1.5 ring-2 ${isActive ? 'ring-white/50' : 'ring-gray-100'}`}>
                        <Image src={thumb} alt="" fill className="object-cover" sizes="32px" />
                      </div>
                    ) : null}
                    <span className="text-xs font-bold uppercase tracking-wider opacity-80">DAY {day.day}</span>
                    <span className="font-extrabold text-lg leading-none mt-0.5">{String(day.day).padStart(2, '0')}</span>
                    <span className="text-xs mt-1 opacity-70">{day.regions?.[0]?.slice(0, 6) || ''}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 타임라인 — 모든 day를 연속 렌더링 */}
          {(() => {
            // ERR-HET-attraction-global-dedup@2026-04-22 — 한 상품의 일정 전체에서 동일 관광지 카드는 1번만 노출.
            // 1차 수정(ERR-HET-attraction-day-duplicate)은 DAY 범위 dedup 이었지만, DAY1 숙박 → DAY2 아침까지
            // 같은 관광지에서 활동이 이어지는 경우(예: 시라무런 초원 2일 연속) 카드가 두 번 나와 고객이 중복으로 오인.
            // 이제 days.map 바깥에서 Set 을 공유해 **전 DAY 에서 처음 매칭된 activity에만 카드**, 이후는 텍스트만.
            const seenAttractionIds = new Set<string>();
            return days.map(currentDay => (
            <div key={currentDay.day} id={`day-${currentDay.day}`} ref={el => { dayRefs.current[currentDay.day] = el; }} data-day={currentDay.day} className="scroll-mt-[160px] mb-10">
              {/* Day 헤더 */}
              <div className="flex items-center gap-2 mb-4">
                <span className="bg-brand text-white text-xs font-bold px-2.5 py-1 rounded-lg">DAY {currentDay.day}</span>
                {currentDay.regions?.[0] && <span className="text-sm text-gray-500">{currentDay.regions.join(' → ')}</span>}
              </div>

            <div className="relative">
              <div className="absolute left-[5px] top-4 bottom-4 w-[2px] bg-slate-200" />

              <div className="space-y-8">
                {currentDay.schedule?.map((item, sIdx) => {
                  // 항공/이동/공항 관련 스케줄은 관광지 매칭 스킵
                  // ERR-20260418-25/32 — optional/shopping 타입도 매칭 스킵 (선택관광 안내에 관광지 카드 안 붙도록)
                  const skipMatch = item.type === 'flight' || item.type === 'hotel' || item.type === 'optional' || item.type === 'shopping' ||
                    /공항|출발|도착|이동|수속|탑승|귀환|체크인|체크아웃|투숙|휴식|미팅|조식|중식|석식|추천|선택관광/.test(item.activity);
                  // ERR-20260417-03 — matchAttractions(복수)로 콤마 관광지도 매칭, 첫 결과 사용
                  const attrCandidate = skipMatch ? null : (matchAttractions(item.activity, attractions as AttractionData[], pkg.destination)[0] || null);
                  // DAY 내 dedup: 이미 같은 DAY 에 표시한 관광지면 카드 생략 (activity 텍스트는 유지).
                  // 키는 id 우선, 없으면 name. page.tsx 의 attractions select 에 id 가 빠져 있어도 name 으로 안전.
                  const candidateKey = attrCandidate?.id || attrCandidate?.name || null;
                  const isDuplicateInDay = !!(candidateKey && seenAttractionIds.has(candidateKey));
                  const attr = isDuplicateInDay ? null : attrCandidate;
                  if (candidateKey) seenAttractionIds.add(candidateKey);
                  const validAttrPhotoUrls = (attr?.photos ?? [])
                    .map(p => {
                      const u = (p.src_large || p.src_medium || '').trim();
                      return isSafeImageSrc(u) ? u : null;
                    })
                    .filter((u): u is string => u != null);
                  const hasPhotos = validAttrPhotoUrls.length > 0;

                  // 항공편은 하나투어 스타일 카드로 렌더링 (첫날/마지막날만, 중간DAY는 일반 표시)
                  const isFirstOrLastDay = currentDay.day === 1 || currentDay.day === days[days.length - 1]?.day || currentDay.day === days[days.length - 2]?.day;
                  if (item.type === 'flight' && isFirstOrLastDay) {
                    // ERR-20260418-22 — activity 자체에서 방향 파싱 ("타이페이 출발 → 부산 도착")
                    // 같은 DAY의 다음 스케줄에서 도착 아이템도 폴백으로 확보
                    const parsed = parseFlightActivity(item.activity);
                    const nextItems = currentDay.schedule?.slice(sIdx + 1) || [];
                    const arrivalItem = nextItems.find(n => /도착/.test(n.activity));
                    const isOutbound = /출발|향발/.test(item.activity) && currentDay.day === 1;
                    // 귀국편은 destination → departure_airport 방향
                    const homeCity = (pkg.departure_airport || '김해').replace(/\s*(국제)?공항.*$/, '');
                    const destCity = (pkg.destination || '').split('/')[0];
                    const depCity = parsed.depCity
                      || parseCityFromActivity(item.activity)
                      || (isOutbound ? homeCity : destCity);
                    const arrCityParsed = parsed.arrCity
                      || parseCityFromActivity(arrivalItem?.activity || '')
                      || (isOutbound ? destCity : homeCity);
                    const arrTimeFinal = arrivalItem?.time || parsed.arrTime;

                    return (
                      <div key={sIdx} className="relative pl-8">
                        <div className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full bg-brand ring-2 ring-[#EBF3FE] z-10" />
                        <div className="bg-white rounded-xl border border-gray-200 p-3">
                          <div className="flex gap-3">
                            <div className="flex flex-col items-center shrink-0 w-12">
                              <p className="text-sm font-black text-gray-900">{item.time}</p>
                              <div className="w-[2px] flex-1 bg-brand-light my-1 min-h-[28px]" />
                              <p className="text-sm font-black text-gray-900">{arrTimeFinal || '—'}</p>
                            </div>
                            <div className="flex flex-col items-center shrink-0 pt-1">
                              <div className={`w-2.5 h-2.5 rounded-full border-2 ${isOutbound ? 'border-brand' : 'border-orange-400'} bg-white`} />
                              <div className={`w-[2px] flex-1 ${isOutbound ? 'bg-brand-light' : 'bg-orange-200'} min-h-[28px]`} />
                              <div className={`w-2.5 h-2.5 rounded-full ${isOutbound ? 'bg-brand' : 'bg-orange-400'}`} />
                            </div>
                            <div className="flex-1 flex flex-col justify-between py-0.5">
                              <div>
                                <p className="font-bold text-sm text-gray-900">{depCity} 출발</p>
                                <p className={`text-xs font-medium mt-0.5 ${isOutbound ? 'text-brand' : 'text-orange-500'}`}>✈ {formatFlightLabel(item.transport)} 직항</p>
                              </div>
                              <p className="font-bold text-sm text-gray-900">{arrCityParsed} 도착</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // 도착 아이템은 flight 카드에 이미 포함되므로 스킵
                  // ERR-HSN-flight-dup-render@2026-04-21: 출발/도착이 개별 flight activity 로
                  // 분리 등록된 레거시 데이터 방어. type==='flight' 도 스킵 대상에 포함.
                  const isArrivalFlightItem =
                    item.type === 'flight' &&
                    /도착/.test(item.activity) &&
                    !/출발/.test(item.activity) &&
                    sIdx > 0 &&
                    currentDay.schedule?.[sIdx - 1]?.type === 'flight';
                  if (isArrivalFlightItem) return null;
                  // P2 (2026-04-27): "X공항 도착" 만 있는 단순 도착 행만 skip.
                  // "청도공항 도착 후 가이드 미팅 ..." 처럼 도착 뒤 추가 활동이 있으면 보존
                  // (이전 정규식 /공항 도착/ 이 "후 가이드 미팅" 같은 핵심 정보까지 삼키던 버그 수정).
                  const isSimpleArrival = item.type !== 'flight' && (() => {
                    const a = item.activity.trim();
                    // 끝까지 도착으로 끝나는 단순 행만 skip
                    if (/^[가-힣\s]*공항\s*도착\s*$/.test(a)) return true;
                    if (/^[가-힣\s]*국제공항\s*도착\s*$/.test(a)) return true;
                    // 호환: 청도 도착/가이드 미팅 (슬래시 단일 행) — 기존 케이스
                    if (currentDay.day === 1 && /^청도도착\/가이드미팅/.test(a.replace(/\s/g, ''))) return true;
                    return false;
                  })();
                  if (isSimpleArrival) return null;

                  // 호텔 투숙/휴식 텍스트 → 하단 호텔 카드에서 통합 표시하므로 스킵
                  // 단, "*과일 도시락" 같은 추가 정보는 보존
                  if (/호텔.*투숙|호텔.*휴식|투숙.*휴식/.test(item.activity) && currentDay.hotel?.name) {
                    const extraNote = item.activity.match(/\*(.+)$/);
                    if (extraNote && currentDay.hotel) {
                      currentDay.hotel.note = [currentDay.hotel.note, extraNote[1].trim()].filter(Boolean).join(' · ');
                    }
                    return null;
                  }

                  return (
                    <div key={sIdx} className="relative pl-8">
                      {/* 보라 dot */}
                      <div className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full bg-brand ring-2 ring-[#EBF3FE] z-10" />

                      <div>
                        {/* 시간 */}
                        {item.time && (
                          <p className="text-brand text-xs font-bold mb-0.5">{item.time}</p>
                        )}

                        {/* [특전] 하이라이트 카드 */}
                        {/\[특전\]|특전\)/.test(item.activity) ? (
                          <div className="bg-brand-light border border-brand-light rounded-xl px-3 py-2.5 flex items-start gap-2">
                            <span className="text-lg shrink-0">🎁</span>
                            <div>
                              <span className="text-xs font-bold text-brand bg-brand-light px-1.5 py-0.5 rounded-full">스페셜 포함</span>
                              <p className="font-bold text-base text-text-primary mt-1">{item.activity.replace(/\[특전\]\s*/g, '').replace(/\(매너팁별도\)/g, '').trim()}</p>
                            </div>
                          </div>
                        ) : (
                        /* 일반 활동명 */
                        <h3 className="font-bold text-base text-gray-900 leading-snug">
                          {item.activity}
                        </h3>
                        )}

                        {item.note && (
                          <p className="text-red-500 text-sm mt-1.5 font-medium">{item.note}</p>
                        )}

                        {/* ═══ 관광지 블록 (하나투어 스타일) ═══ */}
                        {attr && (() => {
                          // Phase 1 CRC: view.inclusions.flat 소비 (콤마 분리·괄호 보호 완료)
                          const inclusions = view.inclusions.flat;
                          const isIncluded = inclusions.some(inc =>
                            item.activity.includes(inc) || inc.includes(attr.name) || attr.name.includes(inc)
                            || (/마사지|맛사지/.test(item.activity) && inclusions.some(i => /마사지|맛사지/.test(i)))
                          );
                          // ERR-LB-DAD-optional-badge@2026-04-20:
                          //   attr.badge_type='optional' (attractions DB 분류용)인 항목이
                          //   실제 schedule item.type='normal' (포함 활동)일 때 "선택관광" 배지가 잘못 표시되어
                          //   고객이 "추가 비용?" 오해할 수 있는 사고 방지.
                          //   schedule item.type이 명시적으로 'optional'일 때만 선택관광으로 인정.
                          const isScheduleOptional = item.type === 'optional';
                          const effectiveBadge = isIncluded
                            ? 'special'
                            : (attr.badge_type === 'optional' && !isScheduleOptional)
                              ? 'tour'
                              : attr.badge_type;
                          return (
                          <div className="mt-2 text-left">
                            {/* 관광지명 — 클릭 시 바텀시트 상세 팝업 */}
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setAttractionModal(attr)}
                                className="font-bold text-base text-blue-900 text-left underline-offset-2 hover:underline active:opacity-70"
                              >
                                {attr.name}
                              </button>
                              <span className="text-blue-400 text-xs">›</span>
                            </div>
                            {/* 한줄설명 */}
                            {attr.short_desc && (
                              <p className="text-sm font-medium text-gray-700 mt-0.5 leading-relaxed">{attr.short_desc}</p>
                            )}
                            
                            {/* 사진 슬라이더 (모바일 스와이프 캐러셀) */}
                            {hasPhotos && (
                              <div className="flex gap-2 overflow-x-auto scrollbar-hide snap-x mt-3 pb-2 -mx-1 px-1">
                                {validAttrPhotoUrls.slice(0, 5).map((url, pIdx) => (
                                  <AttractionPhotoSlide key={`${url}-${pIdx}`} src={url} alt={attr.name} />
                                ))}
                              </div>
                            )}

                            {/* 배지 */}
                            {effectiveBadge && effectiveBadge !== 'tour' && (
                              <span className={`inline-block mt-2 text-[11px] px-2 py-0.5 rounded-full font-bold border ${
                                effectiveBadge === 'special' ? 'border-brand-light text-brand bg-brand-light' :
                                effectiveBadge === 'shopping' ? 'border-brand-light text-brand bg-brand-light' :
                                effectiveBadge === 'optional' ? 'border-pink-300 text-pink-700 bg-pink-50' :
                                effectiveBadge === 'restaurant' ? 'border-orange-300 text-orange-700 bg-orange-50' :
                                effectiveBadge === 'hotel' ? 'border-blue-200 text-[#1B64DA] bg-brand-light' :
                                effectiveBadge === 'golf' ? 'border-emerald-300 text-emerald-700 bg-emerald-50' :
                                'border-gray-300 text-gray-600 bg-gray-50'
                              }`}>{
                                effectiveBadge === 'special' ? '스페셜포함' :
                                effectiveBadge === 'shopping' ? '쇼핑' :
                                effectiveBadge === 'optional' ? '선택관광' :
                                effectiveBadge === 'restaurant' ? '특식' :
                                effectiveBadge === 'hotel' ? '숙소' :
                                effectiveBadge === 'golf' ? '골프' : effectiveBadge
                              }</span>
                            )}
                            
                            {/* 지역 스토리 매거진 뷰 (long_desc 상시 노출) */}
                            {attr.long_desc && (
                              <div className="mt-2 bg-gradient-to-br from-brand-light to-[#F2F4F6] rounded-xl p-3 border border-blue-200/50">
                                <p className="text-sm text-gray-700 leading-loose break-keep">
                                  {attr.long_desc}
                                </p>
                              </div>
                            )}
                          </div>
                          );
                        })()}

                        {/* 호텔 카드는 타임라인 하단에 통합 표시 — 여기서는 스킵 */}
                      </div>
                    </div>
                  );
                })}

                {/* 호텔 숙소 — Phase 1 CRC: view.days[i].hotelCard 소비.
                    하드코딩 "호텔 투숙 및 휴식" 제거 → activity text 기반 동적 헤더.
                    note 는 hotel.note + activity extras(*로 시작) 통합됨. */}
                {(() => {
                  const viewDay = view.days.find(v => v.day === currentDay.day);
                  const card = viewDay?.hotelCard;
                  if (!card?.name) return null;
                  const gradeLabel = card.grade != null && card.grade !== '' ? String(card.grade) : '';
                  return (
                    <div className="relative pl-8">
                      <div className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full bg-brand ring-2 ring-[#EBF3FE] z-10" />
                      <div>
                        <h3 className="font-bold text-base text-gray-900 mb-2">{card.title}</h3>
                        <div className="bg-gray-50 rounded-xl p-3 flex gap-3 items-center border border-gray-100">
                          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-brand-light to-brand/30 flex items-center justify-center text-xl shrink-0">
                            {/* ERR-HET-hotel-ger-star@2026-04-22 — 게르는 성급 표기가 없는 숙소라 별 대신 🛖 아이콘 */}
                            {gradeLabel && /게르/.test(gradeLabel) ? '🛖' : '🏨'}
                          </div>
                          <div>
                            {gradeLabel && (() => {
                              // "5성급"/"준5성급"/"4성급" 등에서 숫자만 추출. 숫자 없으면 텍스트 배지로 표시.
                              // ERR-HET-hotel-grade-ambiguity@2026-04-22 — 별만 5개 있으면 "준5성"인지 "정5성"
                              // 인지 고객이 혼동. 별 옆에 grade 문자열 원본("준5성급"/"5성급") 을 라벨로 병기.
                              const m = gradeLabel.match(/(\d+)\s*성/);
                              const starCount = m ? parseInt(m[1], 10) : null;
                              if (Number.isFinite(starCount) && starCount! > 0) {
                                const label = gradeLabel.trim();
                                return (
                                  <div className="flex flex-row gap-0.5 mb-0.5 items-center">
                                    {Array.from({ length: starCount! }).map((_, i) => (
                                      <span key={i} className="text-amber-400 text-xs leading-none">★</span>
                                    ))}
                                    <span className="text-[10px] text-gray-600 ml-1.5 font-semibold">{label}</span>
                                  </div>
                                );
                              }
                              // 숫자만 온 경우(예: DB numeric 5) — 별 개수로 표시
                              const numericOnly = /^\d+$/.test(gradeLabel.trim());
                              if (numericOnly) {
                                const n = parseInt(gradeLabel.trim(), 10);
                                if (n > 0 && n <= 7) {
                                  return (
                                    <div className="flex flex-row gap-0.5 mb-0.5 items-center">
                                      {Array.from({ length: n }).map((_, i) => (
                                        <span key={i} className="text-amber-400 text-xs leading-none">★</span>
                                      ))}
                                      <span className="text-[10px] text-gray-600 ml-1.5 font-semibold">{n}성급</span>
                                    </div>
                                  );
                                }
                              }
                              // 숫자 없는 등급 (게르 등) — 별 대신 라벨 배지
                              return (
                                <span className="inline-block text-[10px] text-gray-600 bg-gray-200 px-1.5 py-0.5 rounded mb-0.5">{gradeLabel}</span>
                              );
                            })()}
                            <h4 className="font-bold text-xs text-gray-800">{card.name}</h4>
                            {card.note && <p className="text-xs text-gray-500 mt-0.5">{card.note}</p>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* 식사 — P0 #3 (2026-04-27): 모든 식사 미포함 + note 도 없으면 섹션 숨김 (귀국일 등) */}
                {currentDay.meals && (() => {
                  const m = currentDay.meals;
                  const hasAny = m.breakfast || m.lunch || m.dinner ||
                    !!(m.breakfast_note || m.lunch_note || m.dinner_note);
                  return hasAny;
                })() && (
                  <div className="relative pl-10">
                    <div className="absolute left-0 top-0.5 w-8 h-8 rounded-full bg-orange-400 flex items-center justify-center ring-4 ring-white z-10">
                      <span className="text-xs">🍽️</span>
                    </div>
                    <div>
                      <h3 className="font-bold text-base text-gray-900 mb-3">식사 안내</h3>
                      <div className="flex gap-2">
                        {[
                          { label: '조식', emoji: '🍳', note: currentDay.meals.breakfast_note, has: currentDay.meals.breakfast, fallback: '호텔식', colors: { on: 'bg-yellow-50 border-yellow-200 text-yellow-800', off: 'bg-gray-50 border-gray-100 text-gray-400' } },
                          { label: '중식', emoji: '🥘', note: currentDay.meals.lunch_note, has: currentDay.meals.lunch, fallback: '현지식', colors: { on: 'bg-green-50 border-green-200 text-green-800', off: 'bg-gray-50 border-gray-100 text-gray-400' } },
                          { label: '석식', emoji: '🍽️', note: currentDay.meals.dinner_note, has: currentDay.meals.dinner, fallback: '현지식', colors: { on: 'bg-orange-50 border-orange-200 text-orange-800', off: 'bg-gray-50 border-gray-100 text-gray-400' } },
                        ].map(m => {
                          const active = m.has || !!m.note;
                          return (
                            <div key={m.label} className={`rounded-xl px-3 py-2.5 flex-1 text-center border ${active ? m.colors.on : m.colors.off}`}>
                              <p className="text-xs mb-0.5">{m.emoji} {m.label}</p>
                              <p className="text-sm font-bold">{m.note || (active ? m.fallback : '불포함')}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            </div>
            ));
          })()}
        </div>
      )}

      {/* ═══ 선택관광 (일정표 뒤, 유의사항 앞) — region별 그룹핑 (CRC view.optionalTours) ═══ */}
      {view.optionalTours.count > 0 && (
        <div
          ref={el => { sectionRefs.current['선택관광'] = el; }}
          data-section="선택관광"
          className="px-4 py-4 scroll-mt-[108px]"
        >
          <div className="bg-pink-50/50 rounded-2xl p-4">
            <h3 className="text-xs font-bold text-pink-900 mb-3">💎 선택관광 (별도 비용)</h3>
            {(() => {
              const groups = view.optionalTours.groups;
              const showRegionHeader = groups.length > 1;
              return (
                <div className="space-y-3">
                  {groups.map((group, gi) => (
                    <div key={gi} className="space-y-2">
                      {showRegionHeader && (
                        <div className="text-[11px] font-semibold text-pink-700/80 pl-1">{group.region}</div>
                      )}
                      {group.tours.map((tour, i) => (
                        <div key={i} className="flex items-center justify-between bg-white rounded-xl px-3 py-2.5 border border-pink-100">
                          <span className="text-sm font-medium text-gray-800">{tour.displayName}</span>
                          {tour.price && (
                            <span className="text-sm font-bold text-pink-600">{tour.price}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* relatedBlogPosts 는 하단 통합 "여행 준비 가이드" 섹션으로 이동 (2026-04-29) */}

      {/* ═══ 짐 꾸리기 팁 (유의사항 위, 토글 접힘 기본) ═══ */}
      {climateData && Array.isArray(climateData.monthly_normals) && (() => {
        const norms = climateData.monthly_normals as MonthlyNormal[];
        const repNorm = norms.find(n => n.month === representativeMonth);
        if (!repNorm) return null;
        return (
          <PackingTipsCard
            monthlyNormal={repNorm}
            country={climateData.country}
            lat={Number(climateData.lat)}
            durationDays={pkg.duration ?? 5}
            monthLabel={`${representativeMonth}월`}
            cityLabel={climateData.primary_city || climateData.destination}
          />
        );
      })()}

      {/* ═══ FAQ ═══ */}
      <PackageFAQ
        destination={pkg.destination ?? ''}
        kakaoChannel={() => openKakaoChannel({
          internalCode: pkg.products?.internal_code || (pkg as any).internal_code,
          productTitle: pkg.products?.display_name || pkg.title,
          departureDate: selectedDate || selectedTier?.departure_dates?.[0],
        })}
      />

      {/* ═══ 유의사항 (독립 토글 다중 열림) + 예약 약관 ═══ */}
      <div ref={el => { sectionRefs.current['유의사항'] = el; }} data-section="유의사항" className="px-4 py-8 scroll-mt-[108px]">
        {(() => {
          // 4-level 약관 해소 결과를 서버(page.tsx)에서 initialNotices 로 주입.
          //   Tier 1 플랫폼 → Tier 2 랜드사 공통 → Tier 3 랜드사×상품타입 → Tier 4 상품 특약.
          //   같은 notice.type 이면 상위 tier 가 override. 새 type 은 append.
          if (initialNotices.length === 0 && !pkg.customer_notes) return null;
          const hasSpecialTerms = initialNotices.some(n => (n._tier ?? 1) >= 3);
          return (
            <div>
              <h2 className="text-lg font-extrabold text-gray-900 mb-1">유의사항 · 예약 약관</h2>
              {hasSpecialTerms && (
                <p className="text-xs font-bold text-red-600 mb-4">
                  ※ 본 상품은 <span className="underline">특별약관</span>이 적용되며, 표준약관보다 우선 적용됩니다. 예약 시 동의한 것으로 간주합니다.
                </p>
              )}
              {initialNotices.length > 0 ? (
                <div className="space-y-2">
                  {initialNotices.map((notice, idx) => {
                    const isOpen = expandedNotices.has(idx);
                    const lines = (notice.text || '').split('\n').map(l => l.trim()).filter(Boolean);
                    const badgeColor = getSourceBadgeColor(notice._source, notice._tier);
                    const isOverride = (notice._tier ?? 1) >= 2;
                    const tone = NOTICE_CARD_TONE[notice.type] || NOTICE_CARD_TONE.INFO;
                    return (
                      <div key={idx} className={`border border-gray-100 border-l-4 ${tone.border} ${tone.bg} rounded-xl overflow-hidden`}>
                        <button onClick={() => toggleNotice(idx)}
                          className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-white/60 transition">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${NOTICE_DOT_COLOR[notice.type] || NOTICE_DOT_COLOR.INFO}`} />
                          <span className="text-xs font-bold text-gray-700 flex-1">{notice.title}</span>
                          {isOverride && notice._source && (
                            <span className={`text-[10px] font-bold ${badgeColor} bg-gray-50 px-1.5 py-0.5 rounded`}>
                              [{notice._source}]
                            </span>
                          )}
                          <span className="text-gray-300 text-sm">{isOpen ? '▲' : '▼'}</span>
                        </button>
                        {isOpen && (
                          <div className="px-4 pb-3 pt-0">
                            {lines.map((line, lIdx) => (
                              <p key={lIdx} className="text-sm text-gray-500 leading-relaxed">{line.startsWith('•') ? line : `• ${line}`}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <p className="text-xs text-gray-500 italic mt-2">※ 본 약관은 여행상품 표준 기준에 상품·랜드사별 특약을 반영해 해소된 결과입니다. 예약 시점 스냅샷이 별도 [예약 안내문]으로 발송됩니다.</p>
                </div>
              ) : pkg.customer_notes ? (
                <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{pkg.customer_notes}</p>
              ) : null}
            </div>
          );
        })()}
      </div>

      {/* ═══ 여행 준비 가이드 (통합 블로그 섹션) ═══
          ① 이 상품을 다룬 글 (relatedBlogPosts) — 큰 가로 카드, 위쪽
          ② destination 정보성 글 (destinationBlogPosts) — 2-grid 카드, 아래쪽 */}
      {(relatedBlogPosts.length > 0 || destinationBlogPosts.length > 0) && (
        <div className="px-4 py-8 border-t border-gray-100">
          <h2 className="text-lg font-extrabold text-gray-900 mb-1">
            📖 {pkg.destination} 여행 준비 가이드
          </h2>
          <p className="text-xs text-gray-500 mb-5">출국 전 꼭 확인하세요</p>

          {/* ① 이 상품 직접 관련 글 — 큰 가로형 카드 (소셜 프루프 강조) */}
          {relatedBlogPosts.length > 0 && (
            <div className="mb-6">
              <p className="text-[11px] font-bold text-brand mb-2 flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-brand" />
                이 상품을 다룬 글
              </p>
              <div className="space-y-2.5">
                {relatedBlogPosts.map(bp => (
                  <Link
                    key={bp.slug}
                    href={`/blog/${bp.slug}`}
                    className="flex gap-3 rounded-2xl border border-brand-light bg-brand-light/30 p-3 hover:bg-white hover:shadow-md hover:border-brand-light transition"
                  >
                    <BlogOgThumb url={bp.og_image_url} title={bp.seo_title || ''} variant="row" />
                    <div className="min-w-0 flex-1 flex flex-col justify-between py-0.5">
                      <span className="self-start mb-1 inline-block rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold text-white">
                        {ANGLE_LABELS[bp.angle_type] || bp.angle_type}
                      </span>
                      <p className="line-clamp-2 text-sm font-bold text-gray-900 leading-snug">{bp.seo_title || '여행 가이드'}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">2분 읽기 · 여소남 에디터</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* ② destination 정보성 글 — 2-grid */}
          {destinationBlogPosts.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-gray-600 mb-2 flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-gray-400" />
                {pkg.destination} 여행 정보 (날씨·준비물·꿀팁)
              </p>
              <div className="grid grid-cols-2 gap-3">
                {destinationBlogPosts.map(bp => (
                  <Link
                    key={bp.slug}
                    href={`/blog/${bp.slug}`}
                    className="block rounded-2xl border border-gray-100 bg-white overflow-hidden shadow-sm hover:shadow-md hover:border-brand-light transition"
                  >
                    <BlogOgThumb url={bp.og_image_url} title={bp.seo_title || ''} variant="grid" />
                    <div className="p-3">
                      <span className="inline-block rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 mb-1">
                        {ANGLE_LABELS[bp.angle_type] || bp.angle_type}
                      </span>
                      <p className="line-clamp-2 text-xs font-semibold text-gray-800 leading-snug">
                        {bp.seo_title || '여행 가이드'}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ 취소·환불 요약 카드 — CTA 직전 (불안 제거, 신뢰↑) ═══ */}
      {(() => {
        // initialNotices에서 취소 수수료 항목 탐색
        const cancelNotice = initialNotices.find(n =>
          n.type === 'CANCEL_FEE' || /취소.*수수료|환불.*규정|cancell/i.test(n.title || '')
        );
        // 취소 약관 텍스트에서 핵심 줄만 추출 (숫자+일 패턴)
        const lines = (cancelNotice?.text || '').split('\n')
          .map(l => l.trim()).filter(Boolean)
          .filter(l => /[0-9]+일|전액|무료|%|수수료/.test(l))
          .slice(0, 4);
        if (lines.length === 0) return null;
        return (
          <div className="px-4 mb-4">
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
              <h3 className="text-xs font-bold text-slate-700 mb-2.5 flex items-center gap-1.5">
                📋 취소·환불 한눈에 보기
              </h3>
              <ul className="space-y-1.5">
                {lines.map((line, i) => (
                  <li key={i} className="text-xs text-slate-600 flex gap-2 leading-relaxed">
                    <span className="text-slate-300 shrink-0">•</span>
                    {line.replace(/^[•·▪\-]\s*/, '')}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  // 유의사항 섹션으로 스크롤
                  sectionRefs.current['유의사항']?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="mt-2.5 text-[11px] text-brand font-medium hover:underline"
              >
                전체 약관 보기 →
              </button>
            </div>
          </div>
        );
      })()}

      {/* 클립보드 복사 토스트 */}
      {clipboardToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-xs px-4 py-2.5 rounded-full shadow-lg animate-fade-in">
          📋 문의 메시지가 복사됐어요 — 채팅창에 붙여넣기 하세요
        </div>
      )}
      {/* 링크 공유 토스트 */}
      {shareToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-xs px-4 py-2.5 rounded-full shadow-lg animate-fade-in">
          🔗 링크가 복사되었습니다
        </div>
      )}

      {/* ═══ 플로팅 하단바 — 가격 + 카톡 + 예약하기 (Jiwonnote 분석 P3) ═══ */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl z-40 border-t border-gray-100 safe-area-bottom">
        {/* 신뢰 배너 — 상품 타입별 보장 문구 */}
        <div className="bg-brand-light text-blue-700 text-[10px] text-center py-1.5 font-semibold flex items-center justify-center gap-2.5 flex-wrap px-3">
          <span>✅ 숨은 수수료 없음</span>
          {pkg.product_type && /노팁|no.?tip/i.test(pkg.product_type) && <span>✅ 팁 없음</span>}
          {pkg.product_type && /노쇼핑|no.?shopping/i.test(pkg.product_type) && <span>✅ 쇼핑 없음</span>}
          {pkg.product_type && /노옵션|no.?option/i.test(pkg.product_type) && <span>✅ 선택관광 강요 없음</span>}
          <span>✅ {nextConfirmedDate ? `${nextConfirmedDate} 출발 확정` : '출발 확정 후 안심 예약'}</span>
        </div>
        <div className="max-w-lg md:max-w-3xl mx-auto px-4 md:px-6 pb-4 pt-3 flex items-center gap-2">
          {/* 가격/날짜 정보 — 좌측 1인 표시 */}
          <div className="flex-1 min-w-0">
            {selectedTier ? (
              <>
                <p className="text-[11px] text-gray-500 truncate">
                  {selectedDate
                    ? `${parseInt(selectedDate.split('-')[1])}/${parseInt(selectedDate.split('-')[2])} 출발`
                    : `${selectedTier.period_label} 출발`}
                </p>
                <p className="text-base font-extrabold text-gray-900 tabular-nums">
                  ₩{(selectedTier.adult_price || 0).toLocaleString()}
                  <span className="text-[11px] font-normal text-gray-500 ml-0.5">/ 1인</span>
                </p>
              </>
            ) : displayPrice && displayPrice < Infinity ? (
              <>
                <p className="text-[11px] text-gray-500">최저가</p>
                <p className="text-base font-extrabold text-gray-900 tabular-nums">₩{displayPrice.toLocaleString()}~</p>
              </>
            ) : (
              <p className="text-[11px] text-gray-500">가격 문의</p>
            )}
          </div>

          {/* 카톡 — secondary, 빠른 채팅 (리드 저장 + 카카오 채널 오픈) */}
          <button
            type="button"
            aria-label="카카오톡으로 문의"
            onClick={async () => {
              trackLead({
                content_name: pkg.title || '',
                value: displayPrice || 0,
                content_ids: [id],
              });
              // recommendation_outcomes inquiry 트래킹 (점수 시스템 funnel)
              fetch('/api/tracking/recommendation', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ package_id: id, outcome: 'inquiry' }),
              }).catch(() => {});
              fetch('/api/leads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  productId: id,
                  channel: 'kakao_channel',
                  form: { name: '카카오문의', phone: '-', desiredDate: selectedTier?.departure_dates?.[0] || null, adults: 1, children: 0, privacyConsent: true },
                  tracking: { landingUrl: window.location.href, utmSource: new URLSearchParams(window.location.search).get('utm_source'), utmMedium: new URLSearchParams(window.location.search).get('utm_medium'), utmCampaign: new URLSearchParams(window.location.search).get('utm_campaign') },
                  submittedAt: new Date().toISOString(),
                }),
              }).catch(() => {});
              const copied = await openKakaoChannel({
                internalCode: pkg.products?.internal_code || (pkg as any).internal_code,
                productTitle: pkg.products?.display_name || pkg.title,
                departureDate: selectedDate || selectedTier?.departure_dates?.[0],
              });
              if (copied) {
                setClipboardToast(true);
                setTimeout(() => setClipboardToast(false), 4000);
              }
            }}
            className="h-11 px-3.5 rounded-full bg-[#FEE500] text-[#3C1E1E] font-bold text-[13px] shadow-sm active:scale-[0.98] transition-all shrink-0 flex items-center gap-1"
          >
            <span className="text-base leading-none">💬</span>
            <span>카톡</span>
          </button>

          {/* 예약하기 — primary, 폼 열기 (상태형: 날짜 선택 여부에 따라 텍스트 변경) */}
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="h-11 px-5 rounded-full bg-brand text-white font-bold text-sm shadow-lg active:scale-[0.98] transition-all shrink-0"
            aria-label="예약 문의 폼 열기"
          >
            {selectedDate
              ? `${parseInt(selectedDate.split('-')[1])}/${parseInt(selectedDate.split('-')[2])} 예약`
              : '예약하기'}
          </button>
        </div>
      </div>

      {/* ═══ 관광지 상세 바텀시트 ═══ */}
      {attractionModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setAttractionModal(null)}>
          <div className="bg-white w-full max-w-lg md:max-w-2xl mx-auto rounded-t-3xl overflow-hidden max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mt-3 mb-2" />
            {/* 대표 사진 */}
            {attractionModal.photos && attractionModal.photos.length > 0 && (
              <div className="w-full h-48 relative">
                <img
                  src={attractionModal.photos[0].src_large || attractionModal.photos[0].src_medium}
                  alt={attractionModal.name}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <div className="p-5">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-extrabold text-lg text-gray-900">{attractionModal.name}</h3>
                <button onClick={() => setAttractionModal(null)} className="text-gray-400 text-xl ml-3 shrink-0">✕</button>
              </div>
              {attractionModal.short_desc && (
                <p className="text-sm font-medium text-gray-700 mb-3">{attractionModal.short_desc}</p>
              )}
              {attractionModal.long_desc && (
                <p className="text-sm text-gray-600 leading-relaxed">{attractionModal.long_desc}</p>
              )}
              {(!attractionModal.short_desc && !attractionModal.long_desc) && (
                <p className="text-sm text-gray-400">상세 정보가 준비 중입니다.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ 예약 폼 바텀시트 ═══ */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={() => setShowForm(false)}>
          <div className="bg-white w-full max-w-lg md:max-w-2xl mx-auto rounded-t-3xl p-6" onClick={e => e.stopPropagation()}>
            {submitted ? (
              <div className="text-center py-8">
                <p className="text-3xl mb-2">✅</p>
                <p className="font-bold text-gray-900 text-lg">문의가 접수되었습니다!</p>
                <p className="text-sm text-gray-500 mt-1">빠른 시간 내에 연락드리겠습니다.</p>
              </div>
            ) : (
              <>
                <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
                <h3 className="text-lg font-bold text-gray-900 mb-3">예약 문의</h3>
                <div className="bg-brand-light rounded-xl p-3 mb-4 text-xs text-text-primary">
                  <p className="font-bold">{pkg.title}</p>
                  {selectedTier ? (
                    <p className="mt-1">📅 {selectedTier.period_label} — ₩{selectedTier.adult_price?.toLocaleString()}</p>
                  ) : displayPrice && displayPrice < Infinity ? (
                    <p className="mt-1">₩{displayPrice.toLocaleString()}~ / 1인</p>
                  ) : null}
                </div>
                <div className="space-y-3">
                  <input placeholder="이름 *" value={formData.name} onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
                  <input placeholder="연락처 *" value={formData.phone} onChange={e => setFormData(f => ({ ...f, phone: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
                  {!selectedTier && <input placeholder="희망 출발일" value={formData.date} onChange={e => setFormData(f => ({ ...f, date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />}
                  <textarea placeholder="요청사항 (선택)" value={formData.message} onChange={e => setFormData(f => ({ ...f, message: e.target.value }))}
                    rows={2} className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none" />
                  <button onClick={handleSubmit} disabled={!formData.name || !formData.phone || isSubmitting}
                    className="w-full py-3 bg-gradient-to-r from-brand to-brand-dark text-white font-bold rounded-xl text-sm disabled:opacity-50 shadow-lg flex items-center justify-center gap-2">
                    {isSubmitting ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        <span>접수 중...</span>
                      </>
                    ) : '문의 접수하기'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
    </>
  );
}
