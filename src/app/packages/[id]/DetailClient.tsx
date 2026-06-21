'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import nextDynamic from 'next/dynamic';
import { useSearchParams, useRouter } from 'next/navigation';
import { Check, Home, Hotel, Sparkles } from 'lucide-react';
import { matchAttractions, normalizeDays } from '@/lib/attraction-matcher';
import type { AttractionData } from '@/lib/attraction-matcher';
import { normalizeOptionalTourName, groupOptionalToursByRegion } from '@/lib/itinerary-render';
import {
  renderPackage, getAirlineName,
  parseCityFromActivity, parseFlightActivity, formatFlightLabel,
  type CanonicalView,
} from '@/lib/render-contract';
import PackageTermsSection from '@/components/package/PackageTermsSection';
import PackageTermsBottomSheet from '@/components/customer/PackageTermsBottomSheet';
import type { NoticeBlock } from '@/lib/standard-terms-client';
import { hasSpecialTermsBanner, shouldSuppressStandardCancelTable } from '@/lib/standard-terms-client';
import { trackViewContent, trackLead } from '@/components/MetaPixel';
import { filterTiersByDepartureDays } from '@/lib/expand-date-range';
import { openKakaoChannel } from '@/lib/kakaoChannel';
import { ANALYTICS_EVENTS } from '@/lib/analytics-events';
import { getSessionId, trackEngagement } from '@/lib/tracker';
import { buildConciergeHandoffHref, buildGroupInquiryHandoffHref } from '@/lib/group-inquiry-handoff';
import { getEffectivePriceDates, type PriceDate } from '@/lib/price-dates';
import DepartureCalendar from '@/components/customer/DepartureCalendar';
import GlobalNav from '@/components/customer/GlobalNav';
import { DestinationImageFallback } from '@/components/customer/SafeRemoteImage';
import type { MonthlyNormal, FitnessScore } from '@/lib/travel-fitness-score';
import type { SeasonalSignal } from '@/lib/seasonal-signals';
import { isSafeImageSrc } from '@/lib/image-url';
import { useChatStore } from '@/lib/chat-store';
import type { CustomerSafeNotice } from '@/lib/product-registration-v3/customer-payload';
import {
  getCustomerPriceOptionsForDate,
  type CustomerProductPriceRow,
} from '@/lib/customer-package-price-options';
import { formatProductTypeLabel } from '@/lib/product-type-label';

const RecommendationCard = nextDynamic(() => import('@/components/customer/RecommendationCard'), { loading: () => null });
const TravelFitnessCard = nextDynamic(() => import('@/components/customer/TravelFitnessCard'), { loading: () => null });
const TimezoneCard = nextDynamic(() => import('@/components/customer/TimezoneCard'), { loading: () => null });
const PackingTipsCard = nextDynamic(() => import('@/components/customer/PackingTipsCard'), { loading: () => null });
const PackageFAQ = nextDynamic(() => import('@/components/customer/PackageFAQ'), { loading: () => null });
const ReviewDigestStrip = nextDynamic(() => import('@/components/customer/ReviewDigestStrip'), { ssr: false, loading: () => null });
const srStatusProps = (enabled: boolean) => (
  enabled ? { role: 'status', 'aria-live': 'polite', 'aria-atomic': true } as const : {}
);

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
  schedule?: {
    time?: string;
    activity: string;
    type?: string;
    transport?: string;
    note?: string;
    badge?: string;
    entity_kind?: string | null;
    landing_sentence?: string | null;
    service_name?: string | null;
    service_detail?: string | null;
  }[];
  hotel?: { name: string; grade?: string; note?: string } | null;
}

interface Package {
  id: string;
  title: string;
  destination?: string;
  duration?: number;
  nights?: number | null;
  trip_style?: string | null;
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
  product_prices?: CustomerProductPriceRow[];
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
  notices_parsed?: (string | CustomerSafeNotice | { type: string; title: string; text: string })[];
  itinerary_data?: { days?: DaySchedule[]; highlights?: { remarks?: string[] } } | DaySchedule[];
  display_title?: string;
  hero_tagline?: string;
  product_summary?: string;
  lp_hero_image_url?: string | null;
  thumbnail_urls?: string[] | null;
  products?: { display_name?: string; internal_code?: string };
}

interface AttractionInfo {
  id?: string | null;
  name: string; short_desc?: string | null; long_desc?: string | null; badge_type?: string | null; emoji?: string | null;
  aliases?: string[]; photos?: { src_medium: string; src_large: string; photographer: string; pexels_id: number }[];
  country?: string | null; region?: string | null; category?: string | null;
}

// W-final F2 — flight/city 파서는 render-contract.ts 단일 소스로 이관.
// 로컬 복사본 제거됨. import 참조:
//   parseCityFromActivity, parseFlightActivity, formatFlightLabel, getAirlineName

const NAV_SECTIONS = ['상품정보', '요금표', '일정표', '선택관광', '유의사항'] as const;
type NavSection = (typeof NAV_SECTIONS)[number];

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

function formatPackageDuration(pkg: Pick<Package, 'trip_style' | 'duration' | 'nights'> | null | undefined): string | null {
  const style = typeof pkg?.trip_style === 'string' ? pkg.trip_style.trim() : '';
  const styleMatch = style.match(/(\d+)\s*박\s*(\d+)\s*일/);
  if (styleMatch) return `${Number(styleMatch[1])}박 ${Number(styleMatch[2])}일`;

  const duration = Number(pkg?.duration);
  const nights = Number(pkg?.nights);
  if (Number.isFinite(duration) && duration > 0 && Number.isFinite(nights) && nights >= 0) {
    return `${nights}박 ${duration}일`;
  }
  if (Number.isFinite(duration) && duration > 0) return `${duration}일`;
  return null;
}

function formatCompactDepartureDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getMonth() + 1}/${date.getDate()} 출발`;
}

function inferPartyTypeForHandoff(intent: string | null | undefined, productType: string | null | undefined): string | null {
  const source = `${intent ?? ''} ${productType ?? ''}`.toLowerCase();
  if (/가족|효도|family|parent/.test(source)) return 'family';
  if (/골프|golf/.test(source)) return 'golf_group';
  if (/허니문|honeymoon|신혼|couple/.test(source)) return 'couple';
  if (/단체|워크샵|workshop|group/.test(source)) return 'group';
  return null;
}

function getHandoffSearchParam(params: { get(name: string): string | null }, key: string): string | null {
  const value = params.get(key)?.trim();
  return value ? value : null;
}

function parseHandoffSelectedProducts(value: string | null | undefined, fallbackProductName: string): string[] {
  const products = (value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  if (fallbackProductName) products.push(fallbackProductName);
  return Array.from(new Set(products)).slice(0, 4);
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
  /** 2026-05-19 박제 (P2-A / A3): 같은 catalog_id 다른 패키지 (selector UI). */
  catalogSiblings?: Array<{
    id: string;
    title: string;
    display_title: string | null;
    destination: string | null;
    product_highlights: string[] | null;
  }>;
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

function AttractionPhotoSlide({ src, alt, destination }: { src: string; alt: string; destination?: string | null }) {
  const [bad, setBad] = useState(false);
  if (bad) {
    return (
      <div className="relative shrink-0 w-4/5 h-44 rounded-2xl overflow-hidden snap-center shadow-sm bg-slate-100 ring-1 ring-slate-200/60">
        <DestinationImageFallback title={alt} destination={destination || alt} compact />
      </div>
    );
  }
  return (
    <div className="relative shrink-0 w-4/5 h-44 rounded-2xl overflow-hidden snap-center shadow-sm">
      <Image src={src} alt={alt} fill className="object-cover" sizes="80vw" loading="lazy" onError={() => setBad(true)} />
    </div>
  );
}

function scheduleDisplayText(item: { activity?: string | null; landing_sentence?: string | null }): string {
  return (item.landing_sentence || item.activity || '').trim();
}

function isIncludedServiceScheduleItem(item: { activity?: string | null; entity_kind?: string | null; type?: string | null }): boolean {
  if (item.entity_kind === 'perk') return true;
  const text = item.activity || '';
  if (/(?:\uC120\uD0DD\s*\uAD00\uAD11|\uC635\uC158|\uBCC4\uB3C4\s*\uC694\uAE08|\$)/.test(text)) return false;
  return /(?:\uB9C8\uC0AC\uC9C0|\uB9DB\uC0AC\uC9C0|\uC2A4\uD30C|\uC628\uCC9C\uC695)/.test(text);
}

const INCLUDED_SERVICE_LABEL = '\uD3EC\uD568 \uC11C\uBE44\uC2A4';
const INCLUDED_SERVICE_ICON = '\uD83D\uDC86';

function BlogOgThumb({ url, title, variant }: { url: string | null | undefined; title: string; variant: 'row' | 'grid' }) {
  const [hide, setHide] = useState(false);
  const ok = isSafeImageSrc(url) && !hide;
  if (variant === 'row') {
    if (!ok) {
      return (
        <div className="relative h-20 w-28 flex-shrink-0 overflow-hidden rounded-xl bg-gray-100">
          <DestinationImageFallback title={title || '여행 준비 가이드'} destination={title} compact />
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
      <div className="relative aspect-[4/3] overflow-hidden bg-gray-100">
        <DestinationImageFallback title={title || '여행 준비 가이드'} destination={title} compact />
      </div>
    );
  }
  return (
    <div className="relative aspect-[4/3] bg-gray-100 overflow-hidden">
      <Image src={url!} alt={title || ''} fill className="object-cover" sizes="(max-width: 768px) 100vw, 50vw" loading="lazy" onError={() => setHide(true)} />
    </div>
  );
}

interface DetailFlowStep {
  title: string;
  description: string;
  section: string;
}

function DetailFlowGuide({ steps, onSelect }: { steps: DetailFlowStep[]; onSelect: (section: string) => void }) {
  return (
    <section className="px-4 mt-3" aria-labelledby="detail-flow-guide-title">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-brand">확인 동선</p>
            <h2 id="detail-flow-guide-title" className="mt-1 text-base font-extrabold text-slate-950">
              예약 전 확인 순서
            </h2>
          </div>
          <span className="shrink-0 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-500">
            {steps.length}단계
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step, index) => (
            <button
              key={step.title}
              type="button"
              onClick={() => onSelect(step.section)}
              className="min-h-[108px] rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 text-left transition hover:border-brand/40 hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand/10"
            >
              <span className="text-[11px] font-black tabular-nums text-brand">{String(index + 1).padStart(2, '0')}</span>
              <span className="mt-1 block text-[13px] font-extrabold text-slate-950">{step.title}</span>
              <span className="mt-1 block text-[12px] font-medium leading-5 text-slate-600">{step.description}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function createDecisionGuide({
  pkg,
  days,
  airlineName,
  durationLabel,
  departureLabel,
  minPrice,
  productTypeLabel,
}: {
  pkg: Package;
  days: DaySchedule[];
  airlineName: string | null;
  durationLabel: string | null;
  departureLabel: string;
  minPrice: number;
  productTypeLabel: string | null;
}) {
  const text = [
    pkg.title,
    pkg.display_title,
    pkg.hero_tagline,
    pkg.product_summary,
    pkg.product_type,
    ...(pkg.product_highlights ?? []),
    ...(pkg.inclusions ?? []),
    ...(pkg.excludes ?? []),
    ...days.flatMap(day => day.schedule?.map(item => item.activity) ?? []),
  ].filter(Boolean).join(' ');

  const goodFor: string[] = [];
  const cautions: string[] = [];
  const proofs: string[] = [];
  const consultationQuestions: string[] = [];

  if (/노쇼핑|쇼핑\s*없|쇼핑\s*0|NO\s*SHOPPING/i.test(text)) {
    goodFor.push('쇼핑 부담을 줄이고 일정에 집중하고 싶은 분');
  }
  if (/가족|부모|효도|시니어|온천|휴양/i.test(text)) {
    goodFor.push('부모님이나 가족과 함께 편하게 다녀오려는 분');
  }
  if (/골프|라운드|컨트리클럽|CC/i.test(text)) {
    goodFor.push('항공, 숙소, 라운드를 한 번에 비교하려는 골프 여행객');
  }
  if (productTypeLabel) goodFor.push(`${productTypeLabel} 조건을 먼저 확인하고 싶은 분`);
  if (goodFor.length === 0) {
    goodFor.push('출발일과 가격을 먼저 보고 빠르게 상담받고 싶은 분');
  }

  if (pkg.excludes?.length) {
    cautions.push('불포함 항목과 개인 경비를 상담 전에 확인하세요');
  }
  if (pkg.optional_tours?.length) {
    cautions.push('선택 관광이나 현지 옵션 비용이 추가될 수 있어요');
  }
  if (pkg.surcharges?.length) {
    cautions.push('성수기, 특정 기간에는 추가 요금이 붙을 수 있어요');
  }
  if (pkg.min_participants || pkg.min_people) {
    cautions.push(`최소 출발 인원 ${pkg.min_participants ?? pkg.min_people}명 조건을 확인하세요`);
  }
  if (!departureLabel || departureLabel.includes('확인')) {
    cautions.push('출발 가능일은 상담으로 확정하는 편이 안전해요');
  }
  if (cautions.length === 0) {
    cautions.push('항공, 호텔 확정 여부와 취소 규정은 예약 전 다시 확인하세요');
  }

  if (Number.isFinite(minPrice) && minPrice > 0) proofs.push(`최저 ${minPrice.toLocaleString()}원대부터 확인`);
  if (departureLabel) proofs.push(departureLabel);
  if (durationLabel) proofs.push(durationLabel);
  if (airlineName) proofs.push(airlineName);
  if (pkg.inclusions?.length) proofs.push(`포함 ${pkg.inclusions.length}개 항목`);

  consultationQuestions.push(
    departureLabel && !departureLabel.includes('확인')
      ? `${departureLabel} 기준 좌석과 항공 확정 여부를 확인해 주세요`
      : '가능한 출발일과 좌석 상태를 먼저 확인해 주세요',
  );
  if (pkg.excludes?.length) {
    consultationQuestions.push('불포함 항목과 개인 경비 예상 범위를 알려주세요');
  } else if (pkg.inclusions?.length) {
    consultationQuestions.push('포함 항목 중 현지에서 추가 비용이 생길 수 있는 조건을 알려주세요');
  }
  if (pkg.optional_tours?.length || pkg.surcharges?.length) {
    consultationQuestions.push('선택 관광, 성수기, 객실 조건에 따른 추가 요금을 확인해 주세요');
  }
  if (pkg.min_participants || pkg.min_people) {
    consultationQuestions.push(`최소 출발 인원 ${pkg.min_participants ?? pkg.min_people}명 충족 여부를 확인해 주세요`);
  }
  if (consultationQuestions.length < 3) {
    consultationQuestions.push('예약 전 취소 규정과 최종 결제 일정을 확인해 주세요');
  }

  return {
    goodFor: Array.from(new Set(goodFor)).slice(0, 3),
    cautions: Array.from(new Set(cautions)).slice(0, 3),
    proofs: Array.from(new Set(proofs)).slice(0, 4),
    consultationQuestions: Array.from(new Set(consultationQuestions)).slice(0, 3),
  };
}

export default function DetailClient({ initialPackage, initialAttractions, packageId, relatedBlogPosts = [], destinationBlogPosts = [], initialNotices = [], climateData = null, representativeMonth = new Date().getMonth() + 1, departureDistribution = {}, scoreRows = [], rivalsByDate = {}, socialProof, catalogSiblings = [] }: DetailClientProps) {
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
  const [reservationConsent, setReservationConsent] = useState(false);
  const [reservationSubmitAttempted, setReservationSubmitAttempted] = useState(false);
  const [reservationSubmitError, setReservationSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [attractions, setAttractions] = useState<AttractionInfo[]>(initialAttractions);
  const [clipboardToast, setClipboardToast] = useState(false);
  const [shareToast, setShareToast] = useState(false);
  const [attractionModal, setAttractionModal] = useState<AttractionInfo | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [selectedTier, setSelectedTier] = useState<PriceTier | null>(null);
  const attractionDialogRef = useRef<HTMLDivElement | null>(null);
  const attractionCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const reservationDialogRef = useRef<HTMLDivElement | null>(null);
  const reservationCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const reservationNameInputRef = useRef<HTMLInputElement | null>(null);
  const reservationPhoneInputRef = useRef<HTMLInputElement | null>(null);
  const reservationConsentInputRef = useRef<HTMLInputElement | null>(null);
  const reservationSubmitErrorRef = useRef<HTMLParagraphElement | null>(null);
  const reservationTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!showForm && !attractionModal) return;

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const activeDialogRef = showForm ? reservationDialogRef : attractionDialogRef;
    const focusTimer = window.setTimeout(() => {
      if (showForm) {
        (reservationNameInputRef.current ?? reservationCloseButtonRef.current)?.focus();
      } else {
        attractionCloseButtonRef.current?.focus();
      }
    }, 0);
    const getFocusableElements = () => Array.from(
      activeDialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter(element => !element.getAttribute('aria-hidden'));

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (attractionModal) setAttractionModal(null);
        else setShowForm(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (focusableElements.length === 1) {
        event.preventDefault();
        firstElement.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }
      if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      if (showForm && reservationTriggerRef.current && document.contains(reservationTriggerRef.current)) {
        reservationTriggerRef.current.focus();
        reservationTriggerRef.current = null;
        return;
      }
      if (previousActiveElement && document.contains(previousActiveElement)) previousActiveElement.focus();
    };
  }, [attractionModal, showForm]);

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
  const [activeSection, setActiveSection] = useState<NavSection>('상품정보');
  const [activeDay, setActiveDay] = useState(1);
  const dayRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [termsSheetOpen, setTermsSheetOpen] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const openInquiryForm = useCallback((source: string, trigger?: HTMLButtonElement | null) => {
    reservationTriggerRef.current = trigger ?? (document.activeElement instanceof HTMLButtonElement ? document.activeElement : null);
    const inquiryProductName = pkg?.products?.display_name || pkg?.title || id;
    const handoffIntent = getHandoffSearchParam(searchParams, 'intent') ?? formatProductTypeLabel(pkg?.product_type) ?? pkg?.product_type ?? null;
    const handoffPartyType = getHandoffSearchParam(searchParams, 'party_type') ?? inferPartyTypeForHandoff(handoffIntent, pkg?.product_type);
    const inquiryDestination = getHandoffSearchParam(searchParams, 'destination') ?? pkg?.destination ?? null;
    const inquirySelectedProducts = parseHandoffSelectedProducts(getHandoffSearchParam(searchParams, 'selected_products'), inquiryProductName);
    const inquiryBudget = selectedTier?.adult_price ? `1인 ${selectedTier.adult_price.toLocaleString()}원` : null;
    const inquiryBudgetForHandoff = selectedTier?.adult_price ? inquiryBudget : getHandoffSearchParam(searchParams, 'budget') ?? inquiryBudget;
    const inquiryDeparture = selectedDate || selectedTier?.period_label || null;
    const inquiryChecklist = [
      { label: '상품', complete: Boolean(inquiryProductName) },
      { label: '지역', complete: Boolean(inquiryDestination) },
      { label: '출발', complete: Boolean(inquiryDeparture) },
      { label: '가격', complete: Boolean(inquiryBudgetForHandoff) },
    ];
    const inquiryReadyCount = inquiryChecklist.filter((item) => item.complete).length;
    const inquiryMissingLabels = inquiryChecklist.filter((item) => !item.complete).map((item) => item.label);
    const inquiryHandoffPreviewText = `예약 문의 열기 전달 조건: 상품 ${inquiryProductName}${inquiryDestination ? `, 지역 ${inquiryDestination}` : ''}${inquiryDeparture ? `, 출발 ${inquiryDeparture}` : ''}${inquiryBudgetForHandoff ? `, 예산 ${inquiryBudgetForHandoff}` : ''}.`;
    const inquiryDecisionSummaryText = inquiryMissingLabels.length > 0
      ? `예약 문의 열기 판단 요약: ${source}에서 ${inquiryMissingLabels.join(', ')} 조건 보완 후 상담 전달 정확도가 높아집니다. ${inquiryHandoffPreviewText}`
      : `예약 문의 열기 판단 요약: ${source}에서 상품, 지역, 출발, 가격 조건을 예약 문의로 바로 넘길 수 있습니다. ${inquiryHandoffPreviewText}`;
    const inquiryNextActionText = inquiryMissingLabels.length > 0
      ? `${inquiryMissingLabels[0]} 조건을 확인한 뒤 예약 문의를 이어가세요.`
      : '예약 문의 폼에서 출발일과 연락처를 확인해 접수하세요.';
    trackEngagement({
      event_type: ANALYTICS_EVENTS.stickyCtaClicked,
      product_id: id,
      product_name: pkg?.title ?? '',
      cta_type: source,
      page_url: typeof window !== 'undefined' ? window.location.pathname : `/packages/${id}`,
      intent: handoffIntent,
      budget: inquiryBudgetForHandoff,
      destination: inquiryDestination,
      party_type: handoffPartyType,
      selected_products: inquirySelectedProducts,
      next_action: inquiryNextActionText,
      metadata: {
        source,
        selectedDate,
        productType: pkg?.product_type ?? null,
        selectedTier: selectedTier?.period_label ?? null,
        ready_count: inquiryReadyCount,
        missing_fields: inquiryMissingLabels,
        decision_summary: inquiryDecisionSummaryText,
        handoff_preview: inquiryHandoffPreviewText,
        next_action: inquiryNextActionText,
      },
    });
    fetch('/api/tracking/score-signal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        package_id: id,
        signal_type: 'lead_sheet_open',
        group_key: source,
        session_id: getSessionId(),
      }),
    }).catch(() => {});
    fetch('/api/tracking/recommendation', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        package_id: id,
        outcome: 'inquiry',
        session_id: getSessionId(),
      }),
    }).catch(() => {});
    setReservationSubmitAttempted(false);
    setReservationSubmitError('');
    setReservationConsent(false);
    setShowForm(true);
  }, [id, pkg?.destination, pkg?.product_type, pkg?.products?.display_name, pkg?.title, searchParams, selectedDate, selectedTier?.adult_price, selectedTier?.period_label]);

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
    // 데이터 fetch 실패는 사용자에게 영향 — dev 콘솔에는 가시화 (트래커와 달리 silent 금지)
    if (initialAttractions.length === 0) {
      fetch('/api/attractions?limit=500')
        .then(r => r.json())
        .then(d => setAttractions(d.attractions || []))
        .catch((e) => console.warn('[DetailClient] attractions fallback fetch failed:', e?.message ?? e));
    }
  }, [id, initialPackage, initialAttractions.length]);

  const updateActiveSection = useCallback(() => {
    const anchorY = 132;
    let current: NavSection = NAV_SECTIONS[0];

    for (const section of NAV_SECTIONS) {
      const el = sectionRefs.current[section];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top <= anchorY) current = section;
    }

    setActiveSection(prev => (prev === current ? prev : current));
  }, []);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateActiveSection();
      });
    };

    updateActiveSection();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [pkg, updateActiveSection]);

  /** 한 번 이상 스크롤한 뒤 멈춤 → 상담 힌트만 준비, 화면을 자동으로 덮지는 않음 */
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
  const days: DaySchedule[] = useMemo(() => {
    if (!pkg) return [];
    const sourceDays = normalizeDays<DaySchedule>(pkg.itinerary_data);
    if (!view?.days?.length) return sourceDays;
    return view.days.map((day, index) => {
      const sourceDay = sourceDays[index];
      return {
        day: day.day,
        regions: day.regions,
        schedule: day.schedule as DaySchedule['schedule'],
        meals: (day.meals ?? sourceDay?.meals) as DaySchedule['meals'],
        hotel: sourceDay?.hotel ?? (day.hotelCard
          ? { name: day.hotelCard.name ?? '', grade: day.hotelCard.grade ?? undefined, note: day.hotelCard.note ?? undefined }
          : null),
      };
    });
  }, [pkg, view]);
  const tiers = useMemo(
    () => (pkg ? (filterTiersByDepartureDays(pkg.price_tiers as unknown as import('@/lib/parser').PriceTier[] ?? [], pkg.departure_days) as unknown as import('@/lib/parser').PriceTier[]) : []),
    [pkg],
  );
  const allPriceDates = useMemo(
    () => (pkg ? getEffectivePriceDates(pkg as unknown as Parameters<typeof getEffectivePriceDates>[0]) : []),
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
  const nextConfirmedDateRaw = useMemo(() => {
    if (!pkg?.price_dates) return null;
    const today = new Date().toISOString().slice(0, 10);
    return pkg.price_dates
      .filter(d => d.confirmed && d.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0]?.date ?? null;
  }, [pkg]);
  const heroUrl = useMemo(() => {
    if (!pkg) return null;
    if (isSafeImageSrc(pkg.lp_hero_image_url)) return pkg.lp_hero_image_url.trim();
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
    if (isSafeImageSrc(pkg.lp_hero_image_url)) {
      const src = pkg.lp_hero_image_url.trim();
      return [{ src_large: src, src_medium: src, photographer: '', pexels_id: 0 }];
    }
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
  const handoffIntentFromQuery = getHandoffSearchParam(searchParams, 'intent');
  const handoffBudgetFromQuery = getHandoffSearchParam(searchParams, 'budget');
  const handoffDestinationFromQuery = getHandoffSearchParam(searchParams, 'destination');
  const handoffPartyTypeFromQuery = getHandoffSearchParam(searchParams, 'party_type');
  const handoffProductsFromQuery = getHandoffSearchParam(searchParams, 'selected_products');
  const handoffQueryFromQuery = getHandoffSearchParam(searchParams, 'query');
  const productTypeLabel = formatProductTypeLabel(pkg.product_type);
  const selectedDateInfo = selectedDate ? allPriceDates.find(d => d.date === selectedDate) : null;
  const selectedProductPriceOptions = getCustomerPriceOptionsForDate(pkg.product_prices, selectedDate);
  // 카드 상단 "판매가": 사용자가 명시 선택한 경우(selectedTier/selectedDate)에만 그 가격, 아니면 항상 최저가
  // ERR-LB-DAD-displayprice@2026-04-20: 디폴트 selectedDate가 자동 설정되어 최저가 대신 4/22 가격(1,309,000)이 표시되는 사고 방지
  const displayPrice = selectedTier?.adult_price ?? (selectedDate ? selectedDateInfo?.price : null) ?? minPrice;
  const selectedProductName = pkg.products?.display_name || pkg.title;
  const selectedHandoffProducts = parseHandoffSelectedProducts(handoffProductsFromQuery, selectedProductName);
  const handoffIntent = handoffIntentFromQuery ?? productTypeLabel ?? pkg.product_type ?? 'consult';
  const handoffPartyType = handoffPartyTypeFromQuery ?? inferPartyTypeForHandoff(handoffIntent, pkg.product_type);
  const todayForDeparture = new Date().toISOString().slice(0, 10);
  const nextAvailableDepartureDateRaw = allPriceDates
    .filter(d => d.date >= todayForDeparture)
    .sort((a, b) => a.date.localeCompare(b.date))[0]?.date ?? null;
  const selectedDepartureDateForHandoff =
    selectedDate || selectedTier?.departure_dates?.[0] || nextConfirmedDateRaw || nextAvailableDepartureDateRaw || formData.date || null;
  const selectedDepartureLabelForDisplay =
    (selectedDate ? formatCompactDepartureDate(selectedDate) : null)
    ?? selectedTier?.period_label
    ?? nextConfirmedDate
    ?? (nextAvailableDepartureDateRaw ? formatCompactDepartureDate(nextAvailableDepartureDateRaw) : null)
    ?? formData.date
    ?? null;
  const handoffBudget = selectedTier?.adult_price
    ? `1인 ${selectedTier.adult_price.toLocaleString()}원`
    : Number.isFinite(displayPrice) && (displayPrice ?? 0) > 0
      ? `1인 ${(displayPrice as number).toLocaleString()}원부터`
      : null;
  const handoffBudgetForCta = selectedTier?.adult_price ? handoffBudget : handoffBudgetFromQuery ?? handoffBudget;
  const handoffDestination = handoffDestinationFromQuery ?? pkg.destination ?? null;
  const groupInquiryQuery = [
    handoffQueryFromQuery ? `검색어: ${handoffQueryFromQuery}` : null,
    selectedDepartureDateForHandoff
      ? `${selectedProductName} ${selectedDepartureDateForHandoff} 출발 예약 문의`
      : `${selectedProductName} 예약 문의`,
  ].filter(Boolean).join('\n');
  const conciergeHandoffQuery = [
    handoffQueryFromQuery ? `검색어: ${handoffQueryFromQuery}` : null,
    selectedDepartureDateForHandoff
      ? `${selectedProductName} ${selectedDepartureDateForHandoff} 출발 조건 AI 상담`
      : `${selectedProductName} 조건 AI 상담`,
  ].filter(Boolean).join('\n');
  const groupInquiryHref = buildGroupInquiryHandoffHref({
    source: 'package_detail',
    intent: handoffIntent,
    partyType: handoffPartyType ?? undefined,
    query: groupInquiryQuery,
    destination: handoffDestination,
    budget: handoffBudgetForCta,
    selectedProducts: selectedHandoffProducts,
  });
  const conciergeHandoffHref = buildConciergeHandoffHref({
    source: 'package_detail',
    intent: handoffIntent,
    partyType: handoffPartyType ?? undefined,
    query: conciergeHandoffQuery,
    destination: handoffDestination,
    budget: handoffBudgetForCta,
    selectedProducts: selectedHandoffProducts,
  });
  const airlineName = view.airlineHeader.airlineName ?? pkg.airline ?? null;
  const durationLabel = formatPackageDuration(pkg);
  const nextAvailableDepartureLabel = formatCompactDepartureDate(
    nextAvailableDepartureDateRaw,
  );
  const firstScreenPriceLabel = Number.isFinite(displayPrice) && (displayPrice ?? 0) > 0
    ? `₩${(displayPrice as number).toLocaleString()}~`
    : '가격 문의';
  const firstScreenDepartureLabel = nextConfirmedDate ?? nextAvailableDepartureLabel ?? '출발일 확인';
  const firstScreenBadges = [productTypeLabel, durationLabel, airlineName]
    .filter((item): item is string => Boolean(item))
    .slice(0, 3);
  const stickyHandoffItems = [
    { label: '지역', value: handoffDestination },
    { label: '출발', value: selectedDepartureLabelForDisplay ?? nextAvailableDepartureLabel },
    { label: '예산', value: handoffBudgetForCta },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value));
  const detailCtaSummaryId = 'package-detail-cta-summary';
  const detailHandoffReadinessSummaryId = 'package-detail-handoff-readiness-summary';
  const detailStickyCtaRegionTitleId = 'package-detail-sticky-cta-title';
  const detailStickyCtaRegionDescriptionId = 'package-detail-sticky-cta-description';
  const detailStickyPriceDescriptionId = 'package-detail-sticky-price-description';
  const detailStickyPriceCaveatId = 'package-detail-sticky-price-caveat';
  const detailFirstScreenDecisionSummaryId = 'package-detail-first-screen-decision-summary';
  const detailKakaoDescriptionId = 'package-detail-kakao-description';
  const detailAiConsultDescriptionId = 'package-detail-ai-consult-description';
  const detailGroupInquiryDescriptionId = 'package-detail-group-inquiry-description';
  const detailReservationDescriptionId = 'package-detail-reservation-description';
  const detailStickyCtaDescriptionIds = `${detailStickyCtaRegionDescriptionId} ${detailCtaSummaryId} ${detailHandoffReadinessSummaryId} ${detailStickyPriceCaveatId}`;
  const detailKakaoDescriptionIds = `${detailKakaoDescriptionId} ${detailStickyCtaDescriptionIds}`;
  const detailAiConsultDescriptionIds = `${detailAiConsultDescriptionId} ${detailStickyCtaDescriptionIds}`;
  const detailGroupInquiryDescriptionIds = `${detailGroupInquiryDescriptionId} ${detailStickyCtaDescriptionIds}`;
  const detailReservationDescriptionIds = `${detailReservationDescriptionId} ${detailStickyCtaDescriptionIds}`;
  const detailHandoffChecklist = [
    { label: '상품', complete: Boolean(selectedProductName) },
    { label: '지역', complete: Boolean(handoffDestination) },
    { label: '출발', complete: Boolean(selectedDepartureDateForHandoff ?? selectedDepartureLabelForDisplay ?? nextAvailableDepartureLabel) },
    { label: '가격', complete: Boolean(handoffBudgetForCta) },
  ];
  const detailHandoffReadyCount = detailHandoffChecklist.filter((item) => item.complete).length;
  const detailHandoffMissingLabels = detailHandoffChecklist
    .filter((item) => !item.complete)
    .map((item) => item.label);
  const detailHandoffReadinessText = detailHandoffMissingLabels.length > 0
    ? `상담 전달 준비 ${detailHandoffReadyCount}/${detailHandoffChecklist.length}. 보완하면 좋은 조건: ${detailHandoffMissingLabels.join(', ')}.`
    : `상담 전달 준비 ${detailHandoffReadyCount}/${detailHandoffChecklist.length}. 상품, 지역, 출발, 가격 조건을 상담으로 바로 넘길 수 있습니다.`;
  const detailSummaryLive = Boolean(selectedDate);
  const decisionGuide = createDecisionGuide({
    pkg,
    days,
    airlineName,
    durationLabel,
    departureLabel: firstScreenDepartureLabel,
    minPrice,
    productTypeLabel,
  });
  const stickyConsultationQuestionText = decisionGuide.consultationQuestions[0] ?? null;
  const detailCtaSummaryText = [
    `${selectedProductName} 상품 상담 CTA입니다.`,
    `출발 기준은 ${firstScreenDepartureLabel}입니다.`,
    `가격 기준은 ${firstScreenPriceLabel}입니다.`,
    detailHandoffReadinessText,
    stickyConsultationQuestionText ? `상담 때 먼저 확인할 질문은 ${stickyConsultationQuestionText}입니다.` : null,
    stickyHandoffItems.length > 0
      ? `상담 전달 조건은 ${stickyHandoffItems.map((item) => `${item.label} ${item.value}`).join(', ')}입니다.`
      : null,
  ].filter(Boolean).join(' ');
  const stickyPriceSummaryText = selectedTier
    ? `${selectedDate ? `${parseInt(selectedDate.split('-')[1])}/${parseInt(selectedDate.split('-')[2])}` : selectedTier.period_label} 출발, 1인 ${(selectedTier.adult_price || 0).toLocaleString()}원`
    : displayPrice && displayPrice < Infinity
      ? `최저가 ${(displayPrice as number).toLocaleString()}원부터`
      : '가격은 상담 시 확인';
  const stickyPriceCaveatText = selectedTier
    ? '선택한 출발일 기준 가격입니다. 항공 좌석, 객실 등급, 유류할증료와 옵션 비용은 상담에서 최종 확인합니다.'
    : '표시 가격은 최저가 기준입니다. 출발일, 항공 좌석, 객실 등급에 따라 최종가가 달라질 수 있습니다.';
  const stickyActionConditionLabel = selectedDate
    ? `${parseInt(selectedDate.split('-')[1])}/${parseInt(selectedDate.split('-')[2])} 출발`
    : firstScreenDepartureLabel;
  const stickyReservationLabel = selectedDate
    ? `${parseInt(selectedDate.split('-')[1])}/${parseInt(selectedDate.split('-')[2])} 예약`
    : '예약 문의';
  const detailInlineReservationLabel = `${selectedProductName} ${firstScreenDepartureLabel} 기준 ${firstScreenPriceLabel} 예약 문의 폼 열기`;
  const stickyKakaoActionLabel = `${selectedProductName} ${stickyActionConditionLabel} 기준 카카오톡 상담 열기`;
  const stickyAiConsultActionLabel = `${selectedProductName} ${stickyActionConditionLabel} 조건으로 AI 상담 시작하기`;
  const stickyGroupInquiryActionLabel = `${selectedProductName} ${stickyActionConditionLabel} 기준 맞춤 견적 문의하기`;
  const stickyReservationActionLabel = `${selectedProductName} ${stickyActionConditionLabel} 기준 예약 문의 폼 열기`;
  const stickyNextActionText = detailHandoffMissingLabels.length > 0
    ? `${detailHandoffMissingLabels[0]} 조건을 확인하면 상담 전달이 더 정확해집니다.`
    : selectedDate
      ? `${parseInt(selectedDate.split('-')[1])}/${parseInt(selectedDate.split('-')[2])} 출발 조건으로 예약 문의를 진행하세요.`
      : `${firstScreenDepartureLabel} 기준으로 카톡 상담 또는 예약 문의를 진행하세요.`;
  const detailFirstScreenDecisionItems = [
    { label: '가격', value: firstScreenPriceLabel },
    { label: '출발', value: firstScreenDepartureLabel },
    { label: '질문', value: stickyConsultationQuestionText ?? '포함/불포함 확인' },
  ];
  const detailFirstScreenDecisionSummaryText = `첫 화면 상담 판단 요약: ${detailFirstScreenDecisionItems.map((item) => `${item.label} ${item.value}`).join(', ')}. 다음 액션은 ${stickyNextActionText}`;
  const stickyKakaoHandoffPreviewText = stickyHandoffItems.length > 0
    ? `카톡 전달 조건: ${stickyHandoffItems.map((item) => `${item.label} ${item.value}`).join(', ')}.`
    : `카톡 전달 조건: ${selectedProductName} 상품 기준으로 상담을 시작합니다.`;
  const stickyKakaoDecisionSummaryText = `카톡 상담 판단 요약: ${stickyNextActionText} ${stickyPriceCaveatText} ${stickyKakaoHandoffPreviewText}`;
  const stickyAiConsultHandoffPreviewText = stickyHandoffItems.length > 0
    ? `AI 상담 전달 조건: ${stickyHandoffItems.map((item) => `${item.label} ${item.value}`).join(', ')}.`
    : `AI 상담 전달 조건: ${selectedProductName} 상품 기준으로 상담을 시작합니다.`;
  const stickyAiConsultDecisionSummaryText = `AI 상담 판단 요약: ${stickyNextActionText} ${stickyPriceCaveatText} ${stickyAiConsultHandoffPreviewText}`;
  const stickyGroupInquiryHandoffPreviewText = stickyHandoffItems.length > 0
    ? `단체 견적 전달 조건: ${stickyHandoffItems.map((item) => `${item.label} ${item.value}`).join(', ')}.`
    : `단체 견적 전달 조건: ${selectedProductName} 상품 기준으로 견적 문의를 시작합니다.`;
  const stickyGroupInquiryDecisionSummaryText = `단체 견적 판단 요약: ${stickyNextActionText} ${stickyPriceCaveatText} ${stickyGroupInquiryHandoffPreviewText}`;
  const stickyCtaRegionDescriptionText = [
    '상품 상세 하단 고정 상담 영역입니다.',
    `현재 표시 가격은 ${stickyPriceSummaryText}입니다.`,
    stickyPriceCaveatText,
    stickyNextActionText,
    '카카오톡 상담, AI 상담, 단체 견적, 예약 문의 순서로 바로 이동할 수 있습니다.',
    detailCtaSummaryText,
  ].join(' ');
  const detailFlowSteps: DetailFlowStep[] = [
    {
      title: '가격/포함/불포함',
      description: `${firstScreenPriceLabel} 기준으로 포함 항목과 별도 비용을 먼저 확인`,
      section: '요금표',
    },
    {
      title: '출발/항공/호텔',
      description: `${firstScreenDepartureLabel}${airlineName ? ` · ${airlineName}` : ''} 조건을 일정에서 확인`,
      section: '일정표',
    },
    {
      title: '일정 흐름',
      description: `${durationLabel ?? '전체 일정'} 동안 이동과 주요 체류 시간을 확인`,
      section: '일정표',
    },
    {
      title: '추천/비추천',
      description: '잘 맞는 대상과 조심해야 할 조건을 나란히 확인',
      section: '추천 대상과 확인할 점',
    },
    {
      title: '후기/자주 묻는 질문',
      description: '최근 후기 요약과 상담 전 자주 묻는 질문을 확인',
      section: '후기',
    },
    {
      title: '취소/주의',
      description: '특별약관, 취소·환불, 현지 유의사항을 마지막으로 확인',
      section: '유의사항',
    },
  ];

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
    setReservationSubmitAttempted(true);
    setReservationSubmitError('');

    if (!formData.name.trim() || !formData.phone.trim() || !reservationConsent || isSubmitting) {
      if (!isSubmitting) {
        window.setTimeout(() => {
          if (!formData.name.trim()) {
            reservationNameInputRef.current?.focus();
          } else if (!formData.phone.trim()) {
            reservationPhoneInputRef.current?.focus();
          } else if (!reservationConsent) {
            reservationConsentInputRef.current?.focus();
          }
        }, 0);
      }
      return;
    }
    setIsSubmitting(true);
    let ok = false;
    let errMsg = '';
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: id,
          channel: 'landing_page',
          form: {
            name: formData.name,
            phone: formData.phone,
            desiredDate: formData.date || selectedDepartureDateForHandoff || selectedTier?.period_label || null,
            adults: 1,
            children: 0,
            privacyConsent: reservationConsent,
          },
          tracking: {
            sessionId: getSessionId(),
            landingUrl: window.location.href,
            utmSource: new URLSearchParams(window.location.search).get('utm_source') || null,
            utmMedium: new URLSearchParams(window.location.search).get('utm_medium') || null,
            utmCampaign: new URLSearchParams(window.location.search).get('utm_campaign') || null,
            intent: handoffIntent,
            budget: handoffBudgetForCta,
            destination: handoffDestination,
            party_type: handoffPartyType,
            selected_products: selectedHandoffProducts,
            ready_count: reservationSubmitReadyCount,
            missing_fields: reservationSubmitMissingLabels,
            decision_summary: reservationSubmitDecisionSummaryText,
            handoff_preview: reservationSubmitHandoffPreviewText,
            next_action: reservationSubmitNextActionText,
          },
          submittedAt: new Date().toISOString(),
        }),
      });
      ok = res.ok;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        errMsg = (data as { error?: string }).error || `요청 실패 (${res.status})`;
      }
    } catch (e) {
      errMsg = e instanceof Error ? e.message : '네트워크 오류';
    } finally {
      setIsSubmitting(false);
    }
    if (ok) {
      setSubmitted(true);
      setTimeout(() => {
        setShowForm(false);
        setSubmitted(false);
        setFormData({ name: '', phone: '', message: '', date: '' });
        setReservationConsent(false);
        setReservationSubmitAttempted(false);
        setReservationSubmitError('');
      }, 3000);
    } else {
      setReservationSubmitError(`예약 문의 전송에 실패했습니다. ${errMsg} 카카오톡 채널로 직접 문의해주시면 빠르게 도와드리겠습니다.`);
      window.requestAnimationFrame(() => reservationSubmitErrorRef.current?.focus());
    }
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

  const scrollToSection = (section: string) => {
    const target = sectionRefs.current[section];
    if (!target) return;

    const offset = section === '일정표' ? 52 : 88;
    window.scrollTo({
      top: target.getBoundingClientRect().top + window.scrollY - offset,
      behavior: 'smooth',
    });
  };
  const reservationNameMissing = formData.name.trim().length === 0;
  const reservationPhoneMissing = formData.phone.trim().length === 0;
  const reservationConsentMissing = !reservationConsent;
  const showReservationNameError = reservationSubmitAttempted && reservationNameMissing;
  const showReservationPhoneError = reservationSubmitAttempted && reservationPhoneMissing;
  const showReservationConsentError = reservationSubmitAttempted && reservationConsentMissing;
  const reservationFormReady = !reservationNameMissing && !reservationPhoneMissing && !reservationConsentMissing && !isSubmitting;
  const reservationSubmitChecklist: Array<{ label: string; value?: string | null; complete: boolean }> = [
    { label: '이름', value: null, complete: !reservationNameMissing },
    { label: '연락처', value: null, complete: !reservationPhoneMissing },
    { label: '개인정보 동의', value: null, complete: !reservationConsentMissing },
  ];
  const reservationConditionDepartureValue = (selectedDate ?? selectedTier?.period_label ?? formData.date) || firstScreenDepartureLabel;
  const reservationConditionChecklist: Array<{ label: string; value?: string | null; complete: boolean }> = [
    { label: '상품', value: selectedProductName, complete: Boolean(selectedProductName) },
    { label: '출발 조건', value: reservationConditionDepartureValue, complete: Boolean(reservationConditionDepartureValue) },
    { label: '예상 가격', value: stickyPriceSummaryText, complete: Boolean(stickyPriceSummaryText) },
  ];
  const reservationConditionReadyCount = reservationConditionChecklist.filter((item) => item.complete).length;
  const reservationSubmitReadyCount = reservationSubmitChecklist.filter((item) => item.complete).length;
  const reservationSubmitMissingLabels = reservationSubmitChecklist.filter((item) => !item.complete).map((item) => item.label);
  const reservationSubmitReadinessText = reservationSubmitMissingLabels.length > 0
    ? `문의 조건 ${reservationConditionReadyCount}/${reservationConditionChecklist.length}, 연락 준비 ${reservationSubmitReadyCount}/${reservationSubmitChecklist.length}. 남은 항목: ${reservationSubmitMissingLabels.join(', ')}.`
    : `문의 조건 ${reservationConditionReadyCount}/${reservationConditionChecklist.length}, 연락 준비 ${reservationSubmitReadyCount}/${reservationSubmitChecklist.length}. 바로 문의를 접수할 수 있습니다.`;
  const reservationSubmitHandoffItems = [
    { label: '상품', value: selectedProductName },
    { label: '출발', value: reservationConditionDepartureValue },
    { label: '가격', value: stickyPriceSummaryText },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value));
  const reservationSubmitHandoffPreviewText = `문의 전달 조건: ${reservationSubmitHandoffItems.map((item) => `${item.label} ${item.value}`).join(', ')}.`;
  const reservationSubmitDecisionSummaryId = 'reservation-submit-decision-summary';
  const reservationSubmitDecisionSummaryText = reservationFormReady
    ? `다음 처리: ${reservationConditionDepartureValue} 기준으로 문의를 접수하고 담당자가 입력한 연락처로 출발 가능일과 인원을 확인합니다. ${reservationSubmitHandoffPreviewText}`
    : `다음 처리 전 ${reservationSubmitMissingLabels.join(', ')}을(를) 입력하면 문의 접수가 가능합니다. ${reservationSubmitHandoffPreviewText}`;
  const reservationSubmitNextActionText = reservationFormReady
    ? `${reservationConditionDepartureValue} 기준으로 예약 문의를 접수하세요.`
    : `${reservationSubmitMissingLabels[0] ?? '필수 정보'}을(를) 입력한 뒤 예약 문의를 접수하세요.`;
  const reservationReadinessGroups = [
    {
      title: '문의 조건',
      testId: 'package-detail-reservation-condition-readiness',
      readyCount: reservationConditionReadyCount,
      totalCount: reservationConditionChecklist.length,
      items: reservationConditionChecklist,
    },
    {
      title: '연락 준비',
      testId: 'package-detail-reservation-contact-readiness',
      readyCount: reservationSubmitReadyCount,
      totalCount: reservationSubmitChecklist.length,
      items: reservationSubmitChecklist,
    },
  ];
  const reservationFormHint = reservationNameMissing
    ? '이름을 입력하면 문의 접수 버튼이 준비됩니다.'
    : reservationPhoneMissing
      ? '연락처를 입력하면 바로 문의를 접수할 수 있어요.'
      : reservationConsentMissing
        ? '개인정보 안내에 동의하면 문의를 접수할 수 있어요.'
        : '담당자가 출발 가능일과 인원을 확인해 연락드립니다.';
  const reservationContextSummaryId = 'reservation-context-summary';
  const reservationContextTitleId = 'reservation-context-title';
  const reservationFieldHintId = 'reservation-field-hint';
  const reservationSubmitReadinessId = 'reservation-submit-readiness-summary';
  const reservationDialogDescriptionIds = `reservation-inquiry-description ${reservationContextSummaryId} ${detailHandoffReadinessSummaryId} ${reservationSubmitReadinessId} ${reservationFieldHintId}`;
  const reservationNameDescriptionIds = showReservationNameError
    ? `${reservationFieldHintId} ${reservationSubmitReadinessId} reservation-name-error`
    : `${reservationFieldHintId} ${reservationSubmitReadinessId}`;
  const reservationPhoneDescriptionIds = showReservationPhoneError
    ? `${reservationFieldHintId} ${reservationSubmitReadinessId} reservation-phone-error`
    : `${reservationFieldHintId} ${reservationSubmitReadinessId}`;
  const reservationConsentDescriptionIds = showReservationConsentError
    ? `${reservationFieldHintId} ${reservationSubmitReadinessId} reservation-consent-error`
    : `${reservationFieldHintId} ${reservationSubmitReadinessId}`;
  const reservationSubmitDescriptionIds = reservationSubmitError
    ? `reservation-form-hint ${reservationContextSummaryId} ${detailHandoffReadinessSummaryId} ${reservationSubmitReadinessId} ${reservationSubmitDecisionSummaryId} reservation-submit-error`
    : `reservation-form-hint ${reservationContextSummaryId} ${detailHandoffReadinessSummaryId} ${reservationSubmitReadinessId} ${reservationSubmitDecisionSummaryId}`;
  const reservationContextItems = [
    { label: '상품', value: selectedProductName },
    { label: '출발', value: selectedDate ?? selectedTier?.period_label ?? (formData.date || firstScreenDepartureLabel) },
    { label: '가격', value: stickyPriceSummaryText },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value));
  const focusFirstReservationMissingField = () => {
    setReservationSubmitAttempted(true);
    window.requestAnimationFrame(() => {
      if (reservationNameMissing) {
        reservationNameInputRef.current?.focus();
        return;
      }
      if (reservationPhoneMissing) {
        reservationPhoneInputRef.current?.focus();
        return;
      }
      if (reservationConsentMissing) {
        reservationConsentInputRef.current?.focus();
      }
    });
  };
  const openReservationKakaoFallback = async () => {
    trackEngagement({
      event_type: ANALYTICS_EVENTS.kakaoClicked,
      product_id: id,
      product_name: pkg.title,
      cta_type: 'detail_reservation_error_kakao',
      page_url: typeof window !== 'undefined' ? window.location.pathname : `/packages/${id}`,
      intent: handoffIntent,
      budget: handoffBudgetForCta,
      destination: handoffDestination,
      party_type: handoffPartyType,
      selected_products: selectedHandoffProducts,
      ready_count: reservationSubmitReadyCount,
      missing_fields: reservationSubmitMissingLabels,
      decision_summary: reservationSubmitDecisionSummaryText,
      handoff_preview: reservationSubmitHandoffPreviewText,
      next_action: '예약 문의 전송 실패 후 같은 조건으로 카카오톡 상담을 이어갑니다.',
      metadata: {
        source: 'detail_reservation_error_kakao',
        selectedDate,
        selectedTier: selectedTier?.period_label ?? null,
        productType: pkg.product_type ?? null,
      },
    });
    const copied = await openKakaoChannel({
      internalCode: pkg.products?.internal_code || (pkg as unknown as Record<string, unknown>).internal_code as string,
      productTitle: selectedProductName,
      intent: handoffIntent,
      budget: handoffBudgetForCta,
      destination: handoffDestination,
      party_type: handoffPartyType,
      selected_products: selectedHandoffProducts,
      departureDate: selectedDepartureDateForHandoff ?? selectedTier?.departure_dates?.[0],
      escalationSummary: [
        '예약 문의 폼 전송이 실패해 카카오톡 상담으로 이어갑니다.',
        reservationSubmitHandoffPreviewText,
        handoffQueryFromQuery ? `검색어: ${handoffQueryFromQuery}` : null,
      ].filter(Boolean).join('\n'),
    });
    if (copied) {
      setClipboardToast(true);
      setTimeout(() => setClipboardToast(false), 4000);
    }
  };
  // currentDay는 일정표 days.map 루프 내에서 정의됨

  return (
    <>
      {/* 데스크톱 전용 GlobalNav — 모바일은 히어로 위 오버레이 ← 버튼 유지 (immersive) */}
      <div className="hidden md:block">
        <GlobalNav />
      </div>
    <main className="min-h-dvh bg-[#F8FAFC] pb-[calc(11rem+env(safe-area-inset-bottom))] md:pb-12 max-w-lg md:max-w-3xl mx-auto" data-testid="main-content">
      <p id={detailCtaSummaryId} className="sr-only" {...srStatusProps(detailSummaryLive)}>
        {detailCtaSummaryText}
      </p>
      <p id={detailHandoffReadinessSummaryId} className="sr-only" {...srStatusProps(detailSummaryLive)}>
        {detailHandoffReadinessText}
      </p>
      <p id={detailKakaoDescriptionId} className="sr-only">
        현재 상품과 선택한 출발 조건을 상담 문구로 정리해 카카오톡 상담창으로 이어갑니다.
      </p>
      <p id={detailAiConsultDescriptionId} className="sr-only">
        현재 상품과 선택한 출발 조건을 AI 상담 화면으로 넘겨 추천 이유, 주의할 점, 다음 액션을 이어서 확인합니다.
      </p>
      <p id={detailGroupInquiryDescriptionId} className="sr-only">
        현재 상품과 선택한 출발 조건을 단체 맞춤 견적 문의로 이어갑니다.
      </p>
      <p id={detailReservationDescriptionId} className="sr-only">
        현재 상품과 선택한 출발 조건으로 예약 문의 입력창을 엽니다.
      </p>

      {/* ═══ 히어로 (사진 배경) ═══ */}
      <div ref={el => { sectionRefs.current['상품정보'] = el; }} data-section="상품정보"
        className="relative h-[392px] md:h-[560px] w-full overflow-hidden md:rounded-b-3xl">
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
            <DestinationImageFallback title={pkg.title} destination={pkg.destination || pkg.title} />
          )}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/10" />

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
            <button type="button" onClick={handleShare} aria-label="상품 링크 공유" className="w-10 h-10 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-md">
              <span className="text-white">↗</span>
            </button>
            <button type="button" aria-label="찜하기" className="w-10 h-10 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-md">
              <span className="text-white">♡</span>
            </button>
          </div>
        </div>

        {/* 히어로 콘텐츠 */}
        <div className="absolute bottom-0 left-0 right-0 p-5 pb-7">
          {productTypeLabel && (
            <span className="bg-white/90 text-brand px-3 py-1 rounded-full text-[11px] font-extrabold tracking-wider mb-3 inline-block shadow-sm">{productTypeLabel}</span>
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
                <h1 className="text-white text-[25px] md:text-3xl font-extrabold leading-tight mb-1.5 break-keep drop-shadow-sm">{headline}</h1>
                {tagline && (
                  <p className="text-white/85 text-sm font-medium leading-snug mb-3 break-keep">{tagline}</p>
                )}
              </>
            );
          })()}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {pkg.destination && <span className="bg-white/18 backdrop-blur-sm text-white/90 text-[11px] px-2.5 py-1 rounded-full border border-white/10">#{pkg.destination}</span>}
            {airlineName && <span className="bg-white/18 backdrop-blur-sm text-white/90 text-[11px] px-2.5 py-1 rounded-full border border-white/10">#{airlineName}</span>}
            {durationLabel && <span className="bg-white/18 backdrop-blur-sm text-white/90 text-[11px] px-2.5 py-1 rounded-full border border-white/10">#{durationLabel.replace(/\s+/g, '')}</span>}
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

      {/* ═══ 같은 카탈로그 다른 분기 selector (P2-A / A3, 2026-05-19 박제) ═══ */}
      {/* 같은 catalog_id 패키지가 있으면 "단수이 vs 베이토우 vs 우라이" 같은 즉시 전환 chips. */}
      <section className="px-4 -mt-6 relative z-20" aria-label="상품 핵심 요약">
        <div className="rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-[0_16px_40px_rgba(15,23,42,0.12)] backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">예약 전 확인</p>
              <p className="mt-1 text-[24px] font-black leading-none text-slate-950 tabular-nums">{firstScreenPriceLabel}</p>
              <p className="mt-1.5 text-[12px] font-semibold text-slate-600">{firstScreenDepartureLabel}</p>
            </div>
            <button
              type="button"
              onClick={(event) => openInquiryForm('detail_first_screen_summary', event.currentTarget)}
              aria-describedby={`${detailCtaSummaryId} ${detailFirstScreenDecisionSummaryId}`}
              className="shrink-0 rounded-xl bg-slate-950 px-4 py-3 text-[13px] font-extrabold text-white shadow-[0_10px_22px_rgba(15,23,42,0.18)] active:scale-[0.98] transition"
            >
              예약 문의
            </button>
          </div>
          {firstScreenBadges.length > 0 && (
            <div className="mt-3 flex gap-1.5 overflow-x-auto no-scrollbar">
              {firstScreenBadges.map((badge) => (
                <span key={badge} className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-700">
                  {badge}
                </span>
              ))}
            </div>
          )}
          <div
            data-testid="package-detail-handoff-readiness-summary"
            aria-label={detailHandoffReadinessText}
            className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
          >
            <span className="shrink-0 text-[12px] font-extrabold text-slate-900">
              상담 전달 준비 {detailHandoffReadyCount}/{detailHandoffChecklist.length}
            </span>
            <span className="min-w-0 truncate text-right text-[12px] font-semibold text-slate-500">
              {detailHandoffMissingLabels.length > 0
                ? `보완 추천: ${detailHandoffMissingLabels.join(', ')}`
                : '바로 상담 가능'}
            </span>
          </div>
          <div
            id={detailFirstScreenDecisionSummaryId}
            data-testid="package-detail-first-screen-decision-summary"
            aria-label={detailFirstScreenDecisionSummaryText}
            className="mt-2 grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-white p-2"
          >
            {detailFirstScreenDecisionItems.map((item) => (
              <div key={`${item.label}-${item.value}`} className="min-w-0 rounded-lg bg-slate-50 px-2 py-1.5">
                <p className="text-[10px] font-extrabold text-slate-400">{item.label}</p>
                <p className="mt-0.5 truncate text-[11px] font-black text-slate-900">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {catalogSiblings.length > 0 && (
        <section className="px-4 -mt-5 relative z-10">
          <div className="bg-white/95 backdrop-blur border border-slate-200 rounded-2xl p-3.5 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between gap-3 mb-2.5">
              <span className="text-slate-900 text-sm font-extrabold">일정 옵션 선택</span>
              <span className="text-slate-500 text-[11px] font-medium">총 {catalogSiblings.length + 1}개</span>
            </div>
            {/* 2026-05-19 박제 (Plan 에이전트 design review P1):
                5+ 분기 wrap 폭발 방지 — chip max-width 180px + truncate.
                모바일: 가로 스크롤 (overflow-x-auto + flex-nowrap), 데스크탑: wrap (md:flex-wrap). */}
            <div className="flex flex-nowrap md:flex-wrap gap-2 overflow-x-auto md:overflow-visible no-scrollbar -mx-1 px-1">
              {/* 현재 패키지 (selected) */}
              <span className="inline-flex items-center max-w-[190px] px-3 py-2 rounded-full bg-slate-950 text-white text-xs font-semibold shadow-sm shrink-0">
                <span className="truncate">{pkg.display_title || pkg.title}</span>
                <span className="ml-1.5 text-white/65 shrink-0">현재</span>
              </span>
              {/* 다른 sibling 패키지 — Link 로 즉시 이동 */}
              {catalogSiblings.map(s => (
                <Link
                  key={s.id}
                  href={`/packages/${s.id}`}
                  className="inline-flex items-center max-w-[190px] px-3 py-2 rounded-full bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-white hover:border-slate-300 transition-colors shrink-0"
                  title={s.display_title || s.title}
                >
                  <span className="truncate">{s.display_title || s.title}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ═══ 리뷰 1줄 요약 strip (PR-F, cron review-digest 산출물) ═══ */}
      <div ref={el => { sectionRefs.current['후기'] = el; }} data-section="후기" className="scroll-mt-[108px]">
        <ReviewDigestStrip
          packageId={pkg.id}
          productTitle={selectedProductName}
          internalCode={pkg.products?.internal_code || ((pkg as unknown as Record<string, unknown>).internal_code as string | undefined)}
        />
      </div>

      {/* ═══ 가격 카드 (플로팅) ═══ */}
      <section className="px-4 mt-3 relative z-10">
        <div className="bg-white rounded-2xl p-5 shadow-[0_16px_42px_rgba(15,23,42,0.08)] border border-slate-100">
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
          <div className="flex justify-between items-start gap-4">
            <div>
              <p className="text-gray-500 text-xs font-semibold mb-1">1인 기준 최저가</p>
              <div className="flex items-baseline gap-1">
                {Number.isFinite(displayPrice) && (displayPrice ?? 0) > 0 ? (
                  <>
                    <span className="text-[28px] font-black text-gray-900">₩{(displayPrice as number).toLocaleString()}</span>
                    <span className="text-gray-500 text-sm">~</span>
                  </>
                ) : (
                  // 2026-05-14 박제: minPrice 가 Infinity 가 되어 "₩∞" 표시되던 사고 차단.
                  // 가격 미추출 상품은 "가격 문의" 안내 — 고객은 카톡 상담으로 유도.
                  <span className="text-[22px] font-extrabold text-brand">가격 문의</span>
                )}
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

          {/* 핵심 특전 — UX-1 강화: 진짜 특전(화이트리스트)만 표시, 0건이면 섹션 숨김 (2026-05-14) */}
          {(() => {
            // PERK_WHITELIST_RE 와 동기화 — 진짜 보너스만 (마사지 N분/업그레이드/특식/케이블카 등)
            const PERK_RE = /마사지\s*\d+분|스파|쿠킹\s*클래스|와인\s*시음|VIP|업그레이드|선물|망고도시락|콩카페|위즐\s*커피|커피핀|특식|미슐랭|사진\s*촬영|케이블카|스피드보트|비경\s*투어|관람차|온천|디너\s*쇼|야경\s*투어|꽃잎\s*세레모니|허니문\s*특전|직항/;
            // 명백한 포함사항 블랙리스트 — 특전 아님
            const NOT_PERK_RE = /훼리비|페리비|항공료|TAX|택스|유류|부두세|출국세|공항세|관광지\s*입장|차량|버스|가이드|보험$|호텔$|기본|선내식\s*\d*회/;
            const filterRealPerk = (s: string) => PERK_RE.test(s) && !NOT_PERK_RE.test(s);

            const items = pkg.product_highlights && pkg.product_highlights.length > 0
              ? pkg.product_highlights.filter(filterRealPerk).slice(0, 4)
              : (view?.inclusions.program ?? []).filter(filterRealPerk).slice(0, 4);
            if (items.length === 0) return null; // 진짜 특전 없으면 섹션 자체 숨김
            return (
              <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-gray-100">
                {items.map((h, i) => {
                  const icon = /직항/.test(h) ? '✈️' : /마사지|스파/.test(h) ? '💆' : /업그레이드|선물/.test(h) ? '🎁' : /특식|미슐랭/.test(h) ? '🍽️' : /케이블카|스피드보트|관람차/.test(h) ? '🎢' : /온천/.test(h) ? '♨️' : '✨';
                  return <span key={i} className="bg-brand-light text-brand px-2.5 py-1 rounded-lg text-xs font-medium">{icon} {h}</span>;
                })}
              </div>
            );
          })()}
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4">
            {durationLabel && (
              <div className="rounded-xl bg-slate-50 px-2.5 py-2">
                <p className="text-[10px] font-semibold text-slate-500">기간</p>
                <p className="mt-0.5 text-sm font-extrabold text-slate-900">{durationLabel}</p>
              </div>
            )}
            {airlineName && (
              <div className="rounded-xl bg-slate-50 px-2.5 py-2">
                <p className="text-[10px] font-semibold text-slate-500">항공</p>
                <p className="mt-0.5 truncate text-sm font-extrabold text-slate-900">{airlineName}</p>
              </div>
            )}
            {(pkg.min_people || pkg.min_participants) && (
              <div className="rounded-xl bg-slate-50 px-2.5 py-2">
                <p className="text-[10px] font-semibold text-slate-500">출발</p>
                <p className="mt-0.5 text-sm font-extrabold text-slate-900">최소 {pkg.min_people || pkg.min_participants}명</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ═══ 인라인 CTA #1 — 가격 카드 바로 아래 (구매 충동 포착) ═══ */}
      <div className="px-4 mt-3 mb-1">
        <button
          type="button"
          onClick={(event) => openInquiryForm('detail_price_card', event.currentTarget)}
          aria-haspopup="dialog"
          aria-expanded={showForm}
          aria-controls="package-detail-reservation-dialog"
          aria-label={detailInlineReservationLabel}
          aria-describedby={detailCtaSummaryId}
          className="w-full h-12 rounded-2xl bg-slate-950 text-white font-bold text-sm shadow-[0_10px_24px_rgba(15,23,42,0.18)] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
        >
          <span>예약 문의하기</span>
          <span className="text-white/65 text-xs font-normal">날짜·인원 상담</span>
        </button>
      </div>

      <DetailFlowGuide steps={detailFlowSteps} onSelect={scrollToSection} />

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

      {/* ═══ 여행 적합도 (monthly_normals/fitness_scores 둘 다 있어야 의미 있음) ═══ */}
      {climateData && Array.isArray(climateData.monthly_normals) && Array.isArray(climateData.fitness_scores) && (
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
      )}
      {/* ═══ 시차 카드 — utc_offset_minutes 만 있으면 독립 노출 (2026-05-16 박제)
           기존: fitness_scores 게이트에 묶여 monthly_normals 미시드 destination 에서 시차도 사라짐.
           시차는 timezone seed 만으로 충분히 의미 있는 정보. ═══ */}
      {climateData && typeof climateData.utc_offset_minutes === 'number' && climateData.timezone && (
        <TimezoneCard
          destination={climateData.destination}
          primaryCity={climateData.primary_city}
          country={climateData.country}
          offsetMinutes={climateData.utc_offset_minutes}
          timezone={climateData.timezone}
        />
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
          <div className="mx-4 mt-6 mb-2 rounded-2xl bg-gradient-to-br from-brand-light/40 to-white border border-brand-light/60 p-5 relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand" />
            <div className="absolute -top-2 right-3 text-7xl text-brand opacity-10 leading-none select-none pointer-events-none font-serif">&ldquo;</div>
            <div className="flex items-center gap-2 mb-3 relative">
              <span className="text-sm">✍️</span>
              <h2 className="text-[11px] font-bold text-brand uppercase tracking-wider">여소남의 추천 코멘트</h2>
            </div>
            {header && (
              <p className="text-base font-bold text-gray-900 mb-2 leading-snug break-keep relative">
                {header}
              </p>
            )}
            <p className="text-sm text-gray-700 leading-relaxed break-keep whitespace-pre-line relative">
              {body}
            </p>
          </div>
        );
      })()}

      {/* ═══ 아이콘 정보바 (모두투어 스타일) ═══ */}
      <div className="flex justify-around py-5 px-4 mt-4 border-b border-gray-100">
        {durationLabel && (
          <div className="flex flex-col items-center gap-1">
            <span className="text-xl">📅</span>
            <span className="text-sm font-bold text-gray-700">{durationLabel}</span>
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
          <span className="text-sm font-bold text-gray-700">{productTypeLabel || '단체'}</span>
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
                    {flightDep.transport && <span className="text-[10px] text-gray-400 ml-1">{flightDep.transport}</span>}
                    <span className="text-[10px] text-gray-400 ml-1">직항</span>
                  </div>
                </div>
                <div className="text-center min-w-[60px]">
                  <p className="text-xl font-black text-gray-900 tabular-nums">
                    {depArrTime || '—'}
                    {view.flightHeader.outbound?.arrDayOffset === 1 && (
                      <span className="text-[10px] text-orange-500 align-top ml-0.5">+1</span>
                    )}
                  </p>
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
                    {flightReturn.transport && <span className="text-[10px] text-gray-400 ml-1">{flightReturn.transport}</span>}
                    <span className="text-[10px] text-gray-400 ml-1">직항</span>
                  </div>
                </div>
                <div className="text-center min-w-[60px]">
                  <p className="text-xl font-black text-gray-900 tabular-nums">
                    {retArrTime || '—'}
                    {view.flightHeader.inbound?.arrDayOffset === 1 && (
                      <span className="text-[10px] text-orange-500 align-top ml-0.5">+1</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{(pkg.departure_airport || '김해').replace(/\s*(국제)?공항.*$/, '')}</p>
                </div>
              </div>
            </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ 스티키 탭 ═══ */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-xl border-b border-slate-100 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
        <div className="flex gap-0 px-3">
          {NAV_SECTIONS.map(section => (
            <button key={section} onClick={() => scrollToSection(section)}
              aria-label={`${section} 섹션으로 이동`}
              aria-current={activeSection === section ? 'true' : undefined}
              className={`flex-1 py-3 text-[11px] font-bold text-center transition-colors border-b-2 ${
                activeSection === section ? 'text-slate-950 border-slate-950' : 'text-gray-500 border-transparent'
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
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs text-gray-500">선택한 출발일</p>
                      <p className="text-sm font-bold text-gray-900">
                        {parseInt(selectedDate.split('-')[1])}월 {parseInt(selectedDate.split('-')[2])}일
                        {selectedDateInfo.confirmed && <span className="ml-1.5 text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-bold">확정</span>}
                      </p>
                    </div>
                    <p className="shrink-0 text-base font-extrabold text-brand">₩{selectedDateInfo.price.toLocaleString()}</p>
                  </div>
                  {selectedProductPriceOptions.length > 1 && (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      <p className="text-xs font-bold text-gray-600">옵션별 요금</p>
                      <div className="mt-2 space-y-1.5">
                        {selectedProductPriceOptions.map((option, index) => (
                          <div key={`${option.targetDate}-${option.price}-${option.label}-${index}`} className="flex items-center justify-between gap-3">
                            <span className="min-w-0 truncate text-xs font-medium text-gray-700">{option.label}</span>
                            <span className="shrink-0 text-sm font-extrabold tabular-nums text-gray-900">₩{option.price.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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
              onClick={(event) => openInquiryForm('detail_recommendation', event.currentTarget)}
              className="w-full h-12 rounded-2xl bg-brand text-white font-bold text-sm shadow-md active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <span>
                {parseInt(selectedDate.split('-')[1])}/{parseInt(selectedDate.split('-')[2])} 출발 예약 문의
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
              onClick={(event) => openInquiryForm('detail_recommendation_secondary', event.currentTarget)}
              className="w-full h-10 rounded-2xl border-2 border-brand text-brand font-semibold text-sm active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
            >
              <span>💬</span>
              <span>날짜 미정 — 카톡으로 먼저 상담하기</span>
            </button>
          )}
        </div>
      )}

      {/* ═══ 포함/불포함/써차지/쇼핑 — CRC + terms-catalog ═══ */}
      {view && <PackageTermsSection view={view} />}

      <section
        ref={el => { sectionRefs.current['추천 대상과 확인할 점'] = el; }}
        data-section="추천 대상과 확인할 점"
        className="px-4 py-6 scroll-mt-[108px]"
        aria-label="추천 대상과 확인할 점"
      >
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-brand">Decision guide</p>
              <h2 className="mt-1 text-lg font-extrabold text-slate-950">이 상품, 이런 분께 잘 맞아요</h2>
            </div>
            <button
              type="button"
              onClick={(event) => openInquiryForm('detail_decision_guide', event.currentTarget)}
              className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-extrabold text-slate-800 active:scale-[0.98] transition"
            >
              조건 확인
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl bg-brand-light/40 p-4">
              <p className="mb-2 text-[12px] font-extrabold text-brand">추천 대상</p>
              <ul className="space-y-2">
                {decisionGuide.goodFor.map(item => (
                  <li key={item} className="flex gap-2 text-sm font-semibold leading-relaxed text-slate-800">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl bg-amber-50 p-4">
              <p className="mb-2 text-[12px] font-extrabold text-amber-700">확인 필요</p>
              <ul className="space-y-2">
                {decisionGuide.cautions.map(item => (
                  <li key={item} className="flex gap-2 text-sm font-semibold leading-relaxed text-slate-800">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {decisionGuide.proofs.length > 0 && (
            <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar">
              {decisionGuide.proofs.map(item => (
                <span key={item} className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-bold text-slate-700">
                  {item}
                </span>
              ))}
            </div>
          )}

          <div
            data-testid="package-detail-consultation-question-list"
            aria-label={`상담 때 확인할 질문 ${decisionGuide.consultationQuestions.length}개: ${decisionGuide.consultationQuestions.join(', ')}`}
            className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] font-extrabold text-slate-900">상담 때 확인할 질문</p>
              <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold text-brand">
                {decisionGuide.consultationQuestions.length}개 준비
              </span>
            </div>
            <ul className="mt-3 space-y-2">
              {decisionGuide.consultationQuestions.map(item => (
                <li key={item} className="flex gap-2 text-[13px] font-semibold leading-relaxed text-slate-700">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ═══ 일정표 ═══ */}
      {days.length > 0 && (
        <div ref={el => { sectionRefs.current['일정표'] = el; }} data-section="일정표" className="px-4 py-8 scroll-mt-[108px]">
          <h2 className="text-lg font-extrabold text-gray-900 mb-5">여행 일정</h2>

          {/* Day 탭 (Voyager 스타일 pill) — 클릭 시 해당 day로 스크롤 */}
          <div className={`${activeSection === '일정표' ? 'sticky' : 'hidden'} top-[41px] z-20 bg-[#F8FAFC]/95 backdrop-blur-md -mx-4 px-4 pb-3 pt-2 border-b border-slate-100`}>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
              {days.map((day, idx) => {
                const thumb = dayAttractionPhotos[idx];
                const isActive = activeDay === day.day;
                return (
                  <button key={day.day} onClick={() => {
                      setActiveDay(day.day);
                      dayRefs.current[day.day]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className={`flex-shrink-0 flex flex-col items-center min-w-[72px] px-3 py-2 rounded-xl transition-all border ${
                      isActive
                        ? 'bg-slate-950 text-white border-slate-950 shadow-lg'
                        : 'bg-white text-gray-500 border-slate-200 hover:border-slate-300'
                    }`}>
                    {thumb ? (
                      <div className={`relative w-8 h-8 rounded-full overflow-hidden mb-1.5 ring-2 ${isActive ? 'ring-white/50' : 'ring-gray-100'}`}>
                        <Image src={thumb} alt="" fill className="object-cover" sizes="32px" />
                      </div>
                    ) : null}
                    <span className="text-xs font-bold uppercase tracking-wider opacity-80">DAY {day.day}</span>
                    <span className="font-extrabold text-base leading-none mt-0.5">{String(day.day).padStart(2, '0')}</span>
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
                  // 2026-05-17 박제 (시즈오카 사고 ERR-shizuoka-client-match + ERR-keyword-탑승):
                  //   schedule[].attraction_ids 가 SSOT. page.tsx Step B 가 이미 정확히 매칭한
                  //   결과를 client 에서 그대로 사용. attraction_ids 없으면 카드 X (잘못된 부분
                  //   키워드 매칭 차단). matchAttractions fallback 제거.
                  //
                  //   ERR-keyword-탑승: "로프웨이 탑승" 같은 attraction 액션 라인까지 정규식
                  //     /탑승/ 으로 차단되던 사고. attraction_ids 가 박힌 라인은 page.tsx 가
                  //     이미 정상 attraction 으로 확정한 것이므로 텍스트 정규식 skip 무시.
                  //     type=flight/hotel/optional/shopping 은 의도된 카테고리 분리라 유지.
                  const itemIds = (item as { attraction_ids?: string[] }).attraction_ids;
                  const hasExplicitMatch = !!(itemIds && itemIds.length > 0);
                  const typeSkip = item.type === 'flight' || item.type === 'hotel' || item.type === 'optional' || item.type === 'shopping';
                  const textSkip = !hasExplicitMatch && /공항|출발|도착|이동|수속|탑승|귀환|체크인|체크아웃|투숙|휴식|미팅|조식|중식|석식|추천|선택관광/.test(item.activity);
                  const skipMatch = typeSkip || textSkip;
                  const attrCandidate = skipMatch ? null : (
                    hasExplicitMatch
                      ? ((attractions as AttractionData[]).find(a => a.id === itemIds![0]) || null)
                      : null
                  );
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
                  const displayActivity = scheduleDisplayText(item);
                  const isIncludedService = isIncludedServiceScheduleItem(item);

                  // 항공편은 하나투어 스타일 카드로 렌더링 (첫날/마지막날만, 중간DAY는 일반 표시)
                  const isFirstOrLastDay = currentDay.day === 1 || currentDay.day === days[days.length - 1]?.day || currentDay.day === days[days.length - 2]?.day;
                  const isArrivalOnlyFlight =
                    item.type === 'flight' &&
                    /도착/.test(item.activity || '') &&
                    !/출발|향발/.test(item.activity || '');
                  if (item.type === 'flight' && isFirstOrLastDay && !isArrivalOnlyFlight) {
                    // ERR-XIY-flight-double-render@2026-05-16 박제 — DAY 1 의 두 번째 flight item
                    // ("서안 도착") 이 잘못된 두 번째 flight 카드 ("서안 출발 → 부산 도착") 로 렌더되던 사고 차단.
                    // 도착-only item 은 앞 출발 item 의 카드에 통합됨.
                    const isArrivalOnly = /도착/.test(item.activity)
                      && !/출발|향발/.test(item.activity)
                      && sIdx > 0
                      && currentDay.schedule?.[sIdx - 1]?.type === 'flight';
                    if (isArrivalOnly) return null;

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
                  const isOptionalTourScheduleLine =
                    item.entity_kind === 'optional_tour'
                    || item.type === 'optional'
                    || /추천\s*선택\s*관광|선택\s*관광|옵션/.test(item.activity || '');
                  if (isOptionalTourScheduleLine && view.optionalTours.count > 0) return null;
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

                        {/* 포함 서비스/특전 하이라이트 카드 */}
                        {isIncludedService ? (
                          <div className="bg-rose-50 border border-rose-100 rounded-xl px-3 py-2.5 flex items-start gap-2">
                            <span className="text-lg shrink-0">{INCLUDED_SERVICE_ICON}</span>
                            <div>
                              <span className="text-xs font-bold text-rose-700 bg-white/80 px-1.5 py-0.5 rounded-full">{INCLUDED_SERVICE_LABEL}</span>
                              {item.service_name && (
                                <p className="font-black text-base text-gray-950 mt-1">{item.service_name}</p>
                              )}
                              <p className={`${item.service_name ? 'text-sm text-gray-700 mt-0.5' : 'font-bold text-base text-text-primary mt-1'} leading-relaxed`}>
                                {displayActivity}
                              </p>
                              {item.service_detail && (
                                <p className="text-xs text-rose-700 mt-1 font-medium">{item.service_detail}</p>
                              )}
                            </div>
                          </div>
                        ) : /\[특전\]|특전\)/.test(item.activity) ? (
                          <div className="bg-brand-light border border-brand-light rounded-xl px-3 py-2.5 flex items-start gap-2">
                            <span className="text-lg shrink-0">🎁</span>
                            <div>
                              <span className="text-xs font-bold text-brand bg-brand-light px-1.5 py-0.5 rounded-full">스페셜 포함</span>
                              <p className="font-bold text-base text-text-primary mt-1">{displayActivity.replace(/\[특전\]\s*/g, '').replace(/\(매너팁별도\)/g, '').trim()}</p>
                            </div>
                          </div>
                        ) : (
                        /* 일반 활동명 */
                        <h3 className="font-bold text-base text-gray-900 leading-snug">
                          {displayActivity}
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
                                  <AttractionPhotoSlide key={`${url}-${pIdx}`} src={url} alt={attr.name} destination={pkg.destination || attr.region || attr.name} />
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
                          <div className="w-14 h-14 rounded-xl bg-brand-light text-brand flex items-center justify-center shrink-0">
                            {/* ERR-HET-hotel-ger-star@2026-04-22 — 게르는 성급 표기가 없는 숙소라 별 대신 🛖 아이콘 */}
                            {gradeLabel && /게르/.test(gradeLabel) ? <Home className="h-6 w-6" aria-hidden /> : <Hotel className="h-6 w-6" aria-hidden />}
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
                        ].filter(m => m.has || !!m.note).map(m => {
                          const active = m.has || !!m.note;
                          return (
                            <div key={m.label} className={`rounded-xl px-3 py-2.5 flex-1 text-center border ${active ? m.colors.on : m.colors.off}`}>
                              <p className="text-xs mb-0.5">{m.emoji} {m.label}</p>
                              <p className="text-sm font-bold">{m.note || m.fallback}</p>
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

      {/* ═══ FAQ ═══ (UX-2 product_type 별 contextual FAQ — 2026-05-14) */}
      <PackageFAQ
        destination={pkg.destination ?? ''}
        productType={pkg.product_type ?? null}
        kakaoChannel={() => {
          trackEngagement({
            event_type: ANALYTICS_EVENTS.kakaoClicked,
            product_id: id,
            product_name: pkg.title,
            cta_type: 'detail_faq_kakao',
            page_url: typeof window !== 'undefined' ? window.location.pathname : `/packages/${id}`,
            intent: handoffIntent,
            budget: handoffBudgetForCta,
            destination: handoffDestination,
            party_type: handoffPartyType,
            selected_products: selectedHandoffProducts,
            next_action: stickyNextActionText,
            metadata: {
              source: 'detail_faq_kakao',
              selectedDate,
              productType: pkg.product_type ?? null,
              selectedTier: selectedTier?.period_label ?? null,
              destination: handoffDestination,
              next_action: stickyNextActionText,
            },
          });
          void openKakaoChannel({
            internalCode: pkg.products?.internal_code || (pkg as unknown as Record<string, unknown>).internal_code as string,
            productTitle: selectedProductName,
            intent: handoffIntent,
            budget: handoffBudgetForCta,
            destination: handoffDestination,
            party_type: handoffPartyType,
            selected_products: selectedHandoffProducts,
            departureDate: selectedDepartureDateForHandoff ?? selectedTier?.departure_dates?.[0],
            escalationSummary: handoffQueryFromQuery ? `검색어: ${handoffQueryFromQuery}` : undefined,
          });
        }}
      />

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

      {/* ═══ 취소·환불 요약 카드 — CTA 직전 ═══ */}
      {(() => {
        const suppressStandardCancel = shouldSuppressStandardCancelTable(initialNotices);

        // 특별약관 상품: 유의사항 섹션에서 이미 안내 → CTA 직전 중복 카드 생략
        if (suppressStandardCancel) {
          return null;
        }

        const cancelNotice = initialNotices.find(n => n.type === 'RESERVATION');
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
                onClick={() => setTermsSheetOpen(true)}
                data-testid="package-terms-open"
                aria-haspopup="dialog"
                aria-expanded={termsSheetOpen}
                aria-controls="package-terms-sheet"
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
        <div
          className="fixed bottom-[calc(136px+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-[90] bg-gray-900 text-white text-xs px-4 py-2.5 rounded-full shadow-lg animate-fade-in"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="package-detail-clipboard-toast"
        >
          📋 문의 메시지가 복사됐어요 — 채팅창에 붙여넣기 하세요
        </div>
      )}
      {/* 링크 공유 토스트 */}
      {shareToast && (
        <div
          className="fixed bottom-[calc(136px+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-[90] bg-gray-900 text-white text-xs px-4 py-2.5 rounded-full shadow-lg animate-fade-in"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="package-detail-share-toast"
        >
          🔗 링크가 복사되었습니다
        </div>
      )}

      {/* ═══ 플로팅 하단바 — 가격 + 카톡 + 예약 문의 (Jiwonnote 분석 P3) ═══ */}
      <div
        className="fixed bottom-0 left-0 right-[calc(100vw-100%)] bg-white z-50 border-t border-slate-200 safe-area-bottom shadow-[0_-16px_40px_rgba(15,23,42,0.12)]"
        role="region"
        aria-labelledby={detailStickyCtaRegionTitleId}
        aria-describedby={detailStickyCtaDescriptionIds}
        data-testid="package-detail-sticky-cta-region"
      >
        <h2 id={detailStickyCtaRegionTitleId} className="sr-only">상품 상담 행동</h2>
        <p id={detailStickyCtaRegionDescriptionId} className="sr-only">
          {stickyCtaRegionDescriptionText}
        </p>
        {/* 신뢰 배너 — 특약 상품은 방어형 카피, 일반 상품은 전환형 카피 */}
        {(() => {
          const specialTermsProduct = hasSpecialTermsBanner(initialNotices);
          return (
            <div className={`text-[10px] text-center py-1.5 font-bold flex items-center justify-center gap-2 px-3 overflow-hidden whitespace-nowrap ${
              specialTermsProduct ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-700'
            }`}>
              <span>{specialTermsProduct ? '✅ 현지 필수비용 투명 공개' : '✅ 숨은 수수료 없음'}</span>
              {pkg.product_type && /노팁|no.?tip/i.test(pkg.product_type) && <span>✅ 팁 없음</span>}
              {pkg.product_type && /노쇼핑|no.?shopping/i.test(pkg.product_type) && <span>✅ 쇼핑 없음</span>}
              <span className="truncate">
                ✅ {specialTermsProduct
                  ? '예약 즉시 항공·숙박 확보'
                  : (nextConfirmedDate ? `${nextConfirmedDate} 출발 확정` : '출발 확정 후 안심 예약')}
              </span>
            </div>
          );
        })()}
        <div className="max-w-lg md:max-w-3xl mx-auto px-4 md:px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <p
            data-testid="package-detail-sticky-next-action"
            className="mb-2 rounded-2xl border border-brand/15 bg-brand-light px-3 py-2 text-[12px] font-extrabold leading-5 text-brand"
          >
            {stickyNextActionText}
          </p>
          <p
            id={detailStickyPriceCaveatId}
            data-testid="package-detail-sticky-price-caveat"
            aria-label={stickyPriceCaveatText}
            className="mb-2 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-bold leading-5 text-amber-800"
          >
            {stickyPriceCaveatText}
          </p>
          {stickyHandoffItems.length > 0 && (
            <div
              className="mb-2 flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-slate-100 bg-slate-50 px-2.5 py-2 no-scrollbar"
              aria-label="상담 전달 조건"
              aria-describedby={detailStickyCtaDescriptionIds}
              data-testid="package-detail-sticky-handoff-summary"
            >
              <span
                data-testid="package-detail-sticky-readiness"
                className="shrink-0 rounded-full bg-brand-light px-2.5 py-1 text-[11px] font-extrabold text-brand"
              >
                준비 {detailHandoffReadyCount}/{detailHandoffChecklist.length}
              </span>
              {stickyHandoffItems.map((item) => (
                <span key={item.label} className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold text-slate-700 shadow-sm">
                  <span className="text-slate-500">{item.label}</span>
                  <span className="mx-1 text-slate-300">/</span>
                  {item.value}
                </span>
              ))}
              {stickyConsultationQuestionText && (
                <span
                  data-testid="package-detail-sticky-consultation-question"
                  aria-label={`상담 때 먼저 확인할 질문: ${stickyConsultationQuestionText}`}
                  className="shrink-0 rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-[11px] font-extrabold text-amber-700"
                >
                  질문 / {stickyConsultationQuestionText}
                </span>
              )}
            </div>
          )}
          <div className="grid gap-2 md:flex md:items-center md:gap-2.5">
          {/* 가격/날짜 정보 — 좌측 1인 표시 */}
          <div
            className="min-w-0 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 md:flex-1 md:border-0 md:bg-transparent md:px-0 md:py-0"
            aria-describedby={detailStickyPriceDescriptionId}
            data-testid="package-detail-sticky-price-summary"
          >
            <p id={detailStickyPriceDescriptionId} className="sr-only">
              {stickyPriceSummaryText}
            </p>
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

          <div
            data-testid="package-detail-sticky-action-grid"
            className="grid grid-cols-[0.8fr_0.95fr_0.8fr_1.2fr] gap-2 md:flex md:items-center md:gap-2.5"
          >
          {/* 카톡 — secondary, 빠른 채팅 (리드 저장 + 카카오 채널 오픈) */}
          <button
            type="button"
            aria-label={stickyKakaoActionLabel}
            aria-describedby={detailKakaoDescriptionIds}
            data-analytics-id="mobile_kakao_consult"
            data-testid="package-detail-sticky-kakao"
            onClick={async () => {
              trackEngagement({
                event_type: ANALYTICS_EVENTS.kakaoClicked,
                product_id: id,
                product_name: pkg.title,
                cta_type: 'mobile_kakao_consult',
                page_url: typeof window !== 'undefined' ? window.location.pathname : `/packages/${id}`,
                intent: handoffIntent,
                budget: handoffBudgetForCta,
                destination: handoffDestination,
                party_type: handoffPartyType,
                selected_products: selectedHandoffProducts,
                next_action: stickyNextActionText,
                metadata: {
                  source: 'detail_mobile_sticky_kakao',
                  selectedDate,
                  productType: pkg.product_type ?? null,
                  selectedTier: selectedTier?.period_label ?? null,
                  readiness: detailHandoffReadinessText,
                  decision_summary: stickyKakaoDecisionSummaryText,
                  handoff_preview: stickyKakaoHandoffPreviewText,
                  next_action: stickyNextActionText,
                },
              });
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
                  form: { name: '카카오문의', phone: '-', desiredDate: selectedDepartureDateForHandoff, adults: 1, children: 0, privacyConsent: true },
                  tracking: {
                    sessionId: getSessionId(),
                    landingUrl: window.location.href,
                    utmSource: new URLSearchParams(window.location.search).get('utm_source'),
                    utmMedium: new URLSearchParams(window.location.search).get('utm_medium'),
                    utmCampaign: new URLSearchParams(window.location.search).get('utm_campaign'),
                    intent: handoffIntent,
                    budget: handoffBudgetForCta,
                    destination: handoffDestination,
                    party_type: handoffPartyType,
                    selected_products: selectedHandoffProducts,
                    ready_count: detailHandoffReadyCount,
                    missing_fields: detailHandoffMissingLabels,
                    decision_summary: stickyKakaoDecisionSummaryText,
                    handoff_preview: stickyKakaoHandoffPreviewText,
                    next_action: stickyNextActionText,
                  },
                  submittedAt: new Date().toISOString(),
                }),
              }).catch(() => {});
              const copied = await openKakaoChannel({
                internalCode: pkg.products?.internal_code || (pkg as unknown as Record<string, unknown>).internal_code as string,
                productTitle: selectedProductName,
                intent: handoffIntent,
                budget: handoffBudgetForCta,
                destination: handoffDestination,
                party_type: handoffPartyType,
                selected_products: selectedHandoffProducts,
                departureDate: selectedDepartureDateForHandoff ?? selectedTier?.departure_dates?.[0],
                escalationSummary: handoffQueryFromQuery ? `검색어: ${handoffQueryFromQuery}` : undefined,
              });
              if (copied) {
                setClipboardToast(true);
                setTimeout(() => setClipboardToast(false), 4000);
              }
            }}
            className="flex h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#FEE500] px-3 text-[13px] font-bold text-[#3C1E1E] shadow-sm transition-all active:scale-[0.98] md:w-11 md:px-0"
          >
            <span className="text-base leading-none" aria-hidden="true">💬</span>
            <span className="text-xs font-extrabold md:sr-only">카톡</span>
          </button>

          <Link
            href={conciergeHandoffHref}
            onClick={() => {
              trackEngagement({
                event_type: ANALYTICS_EVENTS.stickyCtaClicked,
                product_id: id,
                product_name: pkg.title,
                cta_type: 'detail_sticky_ai_consult',
                page_url: typeof window !== 'undefined' ? window.location.pathname : `/packages/${id}`,
                intent: handoffIntent,
                budget: handoffBudgetForCta,
                destination: handoffDestination,
                party_type: handoffPartyType,
                selected_products: selectedHandoffProducts,
                next_action: stickyNextActionText,
                metadata: {
                  source: 'detail_sticky_ai_consult',
                  selectedDate,
                  productType: pkg.product_type ?? null,
                  selectedTier: selectedTier?.period_label ?? null,
                  readiness: detailHandoffReadinessText,
                  ready_count: detailHandoffReadyCount,
                  missing_fields: detailHandoffMissingLabels,
                  decision_summary: stickyAiConsultDecisionSummaryText,
                  handoff_preview: stickyAiConsultHandoffPreviewText,
                  next_action: stickyNextActionText,
                },
              });
            }}
            className="flex h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-full border border-brand/25 bg-brand-light px-2.5 text-xs font-extrabold text-brand shadow-sm transition-all active:scale-[0.98] md:w-auto md:px-3"
            aria-label={stickyAiConsultActionLabel}
            aria-describedby={detailAiConsultDescriptionIds}
            data-testid="package-detail-sticky-ai-consult"
            data-analytics-id="mobile_sticky_ai_consult"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>AI</span>
          </Link>

          <Link
            href={groupInquiryHref}
            onClick={() => {
              trackEngagement({
                event_type: ANALYTICS_EVENTS.stickyCtaClicked,
                product_id: id,
                product_name: pkg.title,
                cta_type: 'detail_sticky_group_inquiry',
                page_url: typeof window !== 'undefined' ? window.location.pathname : `/packages/${id}`,
                intent: handoffIntent,
                budget: handoffBudgetForCta,
                destination: handoffDestination,
                party_type: handoffPartyType,
                selected_products: selectedHandoffProducts,
                next_action: stickyNextActionText,
                metadata: {
                  source: 'detail_sticky_group_inquiry',
                  selectedDate,
                  productType: pkg.product_type ?? null,
                  selectedTier: selectedTier?.period_label ?? null,
                  readiness: detailHandoffReadinessText,
                  ready_count: detailHandoffReadyCount,
                  missing_fields: detailHandoffMissingLabels,
                  decision_summary: stickyGroupInquiryDecisionSummaryText,
                  handoff_preview: stickyGroupInquiryHandoffPreviewText,
                  next_action: stickyNextActionText,
                },
              });
            }}
            className="flex h-11 w-full shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white px-3 text-xs font-extrabold text-slate-800 shadow-sm transition-all active:scale-[0.98] md:w-auto"
            aria-label={stickyGroupInquiryActionLabel}
            aria-describedby={detailGroupInquiryDescriptionIds}
            data-testid="package-detail-sticky-group-inquiry"
            data-analytics-id="mobile_sticky_group_inquiry"
          >
            견적
          </Link>

          {/* 예약 문의 — primary, 폼 열기 (상태형: 날짜 선택 여부에 따라 텍스트 변경) */}
          <button
            type="button"
            onClick={(event) => openInquiryForm('detail_sticky_cta', event.currentTarget)}
            className="h-11 w-full shrink-0 rounded-full bg-slate-950 px-3 text-sm font-bold text-white shadow-lg transition-all active:scale-[0.98] md:w-auto md:px-5 lg:px-6"
            aria-label={stickyReservationActionLabel}
            aria-haspopup="dialog"
            aria-expanded={showForm}
            aria-controls="package-detail-reservation-dialog"
            aria-describedby={detailReservationDescriptionIds}
            data-analytics-id="mobile_sticky_reservation"
            data-testid="package-detail-reservation-cta"
          >
            {stickyReservationLabel}
          </button>
          </div>
        </div>
      </div>

      {/* ═══ 관광지 상세 바텀시트 ═══ */}
      </div>

      {attractionModal && (
        <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true" aria-labelledby="attraction-modal-title">
          <button
            type="button"
            aria-label="관광지 상세 닫기"
            tabIndex={-1}
            className="absolute inset-0 bg-black/40"
            onClick={() => setAttractionModal(null)}
          />
          <div ref={attractionDialogRef} className="relative bg-white w-full max-w-lg md:max-w-2xl mx-auto rounded-t-3xl overflow-hidden max-h-[80vh] overflow-y-auto">
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
                <h3 id="attraction-modal-title" className="font-extrabold text-lg text-gray-900">{attractionModal.name}</h3>
                <button type="button" ref={attractionCloseButtonRef} aria-label="관광지 상세 닫기" onClick={() => setAttractionModal(null)} className="text-gray-400 text-xl ml-3 shrink-0">✕</button>
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
        <div id="package-detail-reservation-dialog" className="fixed inset-0 flex items-end" style={{ zIndex: 70 }} role="dialog" aria-modal="true" aria-labelledby="reservation-inquiry-title" aria-describedby={reservationDialogDescriptionIds} data-testid="package-detail-reservation-dialog">
          <button
            type="button"
            aria-label="예약 문의 배경 닫기"
            tabIndex={-1}
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowForm(false)}
          />
          <div ref={reservationDialogRef} className="relative bg-white w-full max-w-lg md:max-w-2xl mx-auto max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-3xl p-6 shadow-[0_-20px_50px_rgba(15,23,42,0.18)]">
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <button
              type="button"
              ref={reservationCloseButtonRef}
              data-testid="package-detail-reservation-close"
              aria-label="예약 문의 닫기"
              onClick={() => setShowForm(false)}
              className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
            >
              ✕
            </button>
            <h3 id="reservation-inquiry-title" className="text-lg font-extrabold text-gray-900 mb-2">
              {submitted ? '문의 접수 완료' : '예약 문의'}
            </h3>
            <p id="reservation-inquiry-description" className="mb-4 text-xs leading-relaxed text-slate-500">
              {submitted
                ? '빠른 시간 내에 담당자가 출발 가능일과 인원을 확인해 연락드립니다.'
                : '이름과 연락처만 남기면 담당자가 출발 가능일과 인원을 확인해 연락드립니다.'}
            </p>
            <p id={reservationFieldHintId} className="sr-only">
              필수 입력은 이름, 연락처, 개인정보 동의입니다. 희망 출발일과 요청사항은 선택 입력입니다.
            </p>
            {submitted ? (
              <div className="text-center py-8">
                <p className="text-3xl mb-2">✅</p>
                <p className="font-bold text-gray-900 text-lg">문의가 접수되었습니다!</p>
                <p className="text-sm text-gray-500 mt-1">빠른 시간 내에 연락드리겠습니다.</p>
              </div>
            ) : (
              <>
                <section
                  id={reservationContextSummaryId}
                  aria-labelledby={reservationContextTitleId}
                  className="mb-4 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-text-primary"
                  data-testid="package-detail-reservation-context"
                >
                  <h4 id={reservationContextTitleId} className="mb-2 font-bold text-slate-900">문의 조건 요약</h4>
                  <div
                    data-testid="package-detail-reservation-readiness"
                    aria-label={detailHandoffReadinessText}
                    className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-2"
                  >
                    <span className="font-extrabold text-slate-900">전달 준비 {detailHandoffReadyCount}/{detailHandoffChecklist.length}</span>
                    <span className="min-w-0 truncate text-right font-semibold text-slate-500">
                      {detailHandoffMissingLabels.length > 0
                        ? detailHandoffMissingLabels.join(', ')
                        : '완료'}
                    </span>
                  </div>
                  <dl className="grid gap-1.5">
                    {reservationContextItems.map((item) => (
                      <div key={item.label} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2">
                        <dt className="font-semibold text-slate-500">{item.label}</dt>
                        <dd className="min-w-0 truncate font-bold text-slate-800">{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-slate-700">이름 <span className="text-brand">*</span></span>
                    <input ref={reservationNameInputRef} id="reservation-name" name="name" autoComplete="name" aria-describedby={reservationNameDescriptionIds} aria-invalid={showReservationNameError} placeholder="홍길동" value={formData.name} onChange={e => { setFormData(f => ({ ...f, name: e.target.value })); if (reservationSubmitError) setReservationSubmitError(''); }}
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20 focus:border-slate-400" />
                    {showReservationNameError && (
                      <p id="reservation-name-error" className="mt-1 text-xs font-semibold text-red-600" role="alert">이름을 입력해주세요.</p>
                    )}
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-slate-700">연락처 <span className="text-brand">*</span></span>
                    <input ref={reservationPhoneInputRef} id="reservation-phone" name="phone" autoComplete="tel" inputMode="tel" aria-describedby={reservationPhoneDescriptionIds} aria-invalid={showReservationPhoneError} placeholder="010-0000-0000" value={formData.phone} onChange={e => { setFormData(f => ({ ...f, phone: e.target.value })); if (reservationSubmitError) setReservationSubmitError(''); }}
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20 focus:border-slate-400" />
                    {showReservationPhoneError && (
                      <p id="reservation-phone-error" className="mt-1 text-xs font-semibold text-red-600" role="alert">연락처를 입력해주세요.</p>
                    )}
                  </label>
                  {!selectedTier && <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-slate-700">희망 출발일</span>
                    <input id="reservation-departure-date" name="departureDate" autoComplete="off" aria-describedby={reservationFieldHintId} placeholder="예: 7월 23일 또는 날짜 미정" value={formData.date} onChange={e => setFormData(f => ({ ...f, date: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20 focus:border-slate-400" />
                  </label>}
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-slate-700">요청사항</span>
                    <textarea id="reservation-message" name="message" aria-describedby={reservationFieldHintId} placeholder="인원, 객실, 부모님 동행 여부 등" value={formData.message} onChange={e => setFormData(f => ({ ...f, message: e.target.value }))}
                      rows={2} className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20 focus:border-slate-400 resize-none" />
                  </label>
                  <div>
                    <label className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-3 text-xs leading-relaxed text-slate-600">
                      <input
                        ref={reservationConsentInputRef}
                        id="reservation-consent"
                        type="checkbox"
                        checked={reservationConsent}
                        onChange={(e) => {
                          setReservationConsent(e.target.checked);
                          if (reservationSubmitError) setReservationSubmitError('');
                        }}
                        aria-invalid={showReservationConsentError}
                        aria-describedby={reservationConsentDescriptionIds}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
                      />
                      <span>
                        예약 문의와 상담 안내를 위해 입력한 정보를 여소남이 확인하는 데 동의합니다.
                        <Link href="/privacy" className="ml-1 font-bold text-brand underline underline-offset-2">개인정보 안내</Link>
                      </span>
                    </label>
                    {showReservationConsentError && (
                      <p id="reservation-consent-error" className="mt-1 text-xs font-semibold text-red-600" role="alert">개인정보 안내에 동의해주세요.</p>
                    )}
                  </div>
                  {reservationSubmitError && (
                    <div className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold leading-relaxed text-red-700">
                      <p
                        ref={reservationSubmitErrorRef}
                        id="reservation-submit-error"
                        className="outline-none focus:ring-2 focus:ring-red-200"
                        role="alert"
                        tabIndex={-1}
                      >
                        {reservationSubmitError}
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => void openReservationKakaoFallback()}
                          aria-describedby={reservationSubmitDescriptionIds}
                          className="h-9 rounded-full bg-[#FEE500] px-3 text-[12px] font-extrabold text-[#3C1E1E]"
                        >
                          카톡으로 이어가기
                        </button>
                        <button
                          type="button"
                          onClick={focusFirstReservationMissingField}
                          aria-describedby={reservationSubmitDescriptionIds}
                          className="h-9 rounded-full border border-red-100 bg-white px-3 text-[12px] font-extrabold text-red-700"
                        >
                          입력 다시 확인
                        </button>
                      </div>
                    </div>
                  )}
                  <div
                    id={reservationSubmitReadinessId}
                    data-testid="package-detail-reservation-submit-readiness"
                    aria-label={reservationSubmitReadinessText}
                    className="rounded-xl border border-slate-100 bg-slate-50 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[12px] font-extrabold text-slate-900">
                        문의 접수 준비
                      </p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        reservationFormReady ? 'bg-emerald-50 text-emerald-700' : 'bg-white text-slate-500 ring-1 ring-slate-200'
                      }`}>
                        {reservationFormReady ? '바로 접수 가능' : `남은 항목 ${reservationSubmitMissingLabels.length}개`}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {reservationReadinessGroups.map((group) => (
                        <div
                          key={group.title}
                          data-testid={group.testId}
                          className="rounded-lg bg-white px-2.5 py-2 ring-1 ring-slate-100"
                        >
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <p className="text-[11px] font-extrabold text-slate-800">{group.title}</p>
                            <span className="text-[11px] font-bold text-slate-500">{group.readyCount}/{group.totalCount}</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {group.items.map((item) => (
                              <span
                                key={`${group.title}-${item.label}`}
                                className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${
                                  item.complete ? 'bg-brand/5 text-brand ring-1 ring-brand/20' : 'bg-slate-50 text-slate-500 ring-1 ring-slate-200'
                                }`}
                              >
                                {item.complete && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
                                <span className="truncate">{item.label}</span>
                                {item.value && (
                                  <span className="max-w-[7rem] truncate text-slate-500">{item.value}</span>
                                )}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <p id="reservation-form-hint" className={`rounded-xl px-3 py-2 text-[11px] font-semibold leading-relaxed ${
                    reservationFormReady ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500'
                  }`} aria-live="polite" aria-atomic="true">
                    {reservationFormHint}
                  </p>
                  <p
                    id={reservationSubmitDecisionSummaryId}
                    data-testid="package-detail-reservation-submit-decision-summary"
                    aria-label={reservationSubmitDecisionSummaryText}
                    className={`rounded-xl border px-3 py-2 text-[11px] font-bold leading-relaxed ${
                      reservationFormReady
                        ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                        : 'border-slate-100 bg-slate-50 text-slate-600'
                    }`}
                  >
                    {reservationSubmitDecisionSummaryText}
                  </p>
                  <p
                    data-testid="package-detail-reservation-handoff-preview"
                    aria-label={reservationSubmitHandoffPreviewText}
                    className="rounded-xl bg-blue-50 px-3 py-2 text-[11px] font-bold leading-relaxed text-blue-800"
                  >
                    {reservationSubmitHandoffPreviewText}
                  </p>
                  <button onClick={handleSubmit} disabled={isSubmitting}
                    aria-busy={isSubmitting}
                    aria-disabled={!reservationFormReady}
                    aria-describedby={reservationSubmitDescriptionIds}
                    title={!reservationFormReady ? '필수 항목을 확인해 주세요' : undefined}
                    data-analytics-id="reservation_sheet_submit"
                    data-testid="package-detail-reservation-submit"
                    className="w-full py-3 bg-slate-950 text-white font-bold rounded-xl text-sm disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 shadow-lg disabled:shadow-none flex items-center justify-center gap-2">
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

      <PackageTermsBottomSheet
        open={termsSheetOpen}
        onClose={() => setTermsSheetOpen(false)}
        notices={initialNotices}
        hasSpecialTerms={hasSpecialTermsBanner(initialNotices)}
        productTitle={pkg.title}
      />
    </main>
    </>
  );
}
