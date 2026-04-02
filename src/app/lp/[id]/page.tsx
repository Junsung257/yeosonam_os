'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ShieldCheck, Award, Phone, ChevronDown, ChevronUp,
  Flame, MapPin, Utensils, Hotel, Camera, Bus, Star,
  MessageCircle, Clock, Users, CheckCircle2, XCircle,
} from 'lucide-react';
import { useTracking } from '@/hooks/useTracking';
import LeadBottomSheet from '@/components/lp/LeadBottomSheet';
import { submitLeadPipeline } from '@/lib/submitPipeline';
import type { PriceListItem } from '@/lib/parser';
import PriceSectionCard from '@/components/lp/PriceSection';

// ─────────────────────────────────────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────────────────────────────────────

type ChannelSource = 'insta' | 'kakao' | 'default';

interface ChannelMessage {
  headline: string;
  subline: string;
}

interface DayActivity {
  type: 'sightseeing' | 'meal' | 'hotel' | 'flight' | 'optional' | 'shopping' | 'transport';
  label: string;
  detail?: string;
}

interface ItineraryDay {
  day: number;
  title: string;
  regions: string;
  meals: { breakfast: boolean; lunch: boolean; dinner: boolean };
  activities: DayActivity[];
  hotel?: string;
}

interface LandingProductData {
  id: string;
  destination: string;
  duration: string;
  // A/B 테스트용 히어로 이미지
  heroImageA: string;
  heroImageB: string;
  // 스캐어시티
  availableSeats: number;
  departureDateLabel: string;   // "6/5"
  departureFullDate: string;    // "2026-06-05"
  earlyBirdDaysLeft: number;    // 얼리버드 D-N
  // 채널별 커스텀 메시지
  customMessage: Record<ChannelSource, ChannelMessage>;
  // 가격
  priceFrom: number;
  originalPrice: number;
  // 상세 요금표 (날짜/조건별 카드형 가격표)
  price_list?:       PriceListItem[];
  singleSupplement?: string;
  guideTrip?:        string;
  // 카카오 CTA
  kakaoChannelUrl: string;
  // 신뢰 지표
  reviewCount: number;
  reviewScore: number;
  departureGuaranteed: boolean;
  // 일정
  itinerary: {
    days: ItineraryDay[];
    highlights: string[];
    includes: string[];
    excludes: string[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock 데이터
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_DATA: LandingProductData = {
  id: 'jangjiajie-special-0605',
  destination: '장가계',
  duration: '5박 6일',
  heroImageA: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
  heroImageB: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&q=80',
  availableSeats: 2,
  departureDateLabel: '6/5',
  departureFullDate: '2026-06-05',
  earlyBirdDaysLeft: 3,
  customMessage: {
    insta: {
      headline: '이 계절, 장가계가\n당신을 기다립니다',
      subline: '유리다리 위에서 바라본 그 풍경 — 말로 다 할 수 없습니다',
    },
    kakao: {
      headline: '출발 확정 · 잔여 2석\n지금 바로 상담하세요',
      subline: '전 일정 정품 호텔 · 직항 · 직판 최저가 보장',
    },
    default: {
      headline: '장가계 5박 6일\n특가 패키지',
      subline: '천문산 유리다리 · 원가계 · 황룡동굴 완전 정복',
    },
  },
  priceFrom: 1_290_000,
  originalPrice: 1_690_000,
  price_list: [
    {
      period: '5/5~5/25 (매주 화)',
      rules: [
        { condition: '전 출발일', price_text: '1,290,000원', price: 1290000, badge: '특가♥' },
      ],
      notes: '성인/아동 동일 요금 · 싱글차지 120,000원/인',
    },
    {
      period: '5/26~6/30 (매주 화)',
      rules: [
        { condition: '일반 출발일', price_text: '1,390,000원', price: 1390000, badge: '일반' },
        { condition: '제외일 6/3(수)', price_text: '별도문의', price: null, badge: '별도문의' },
      ],
      notes: null,
    },
    {
      period: '7/1~8/31 성수기',
      rules: [
        { condition: '화·목 출발', price_text: '1,590,000원', price: 1590000, badge: '호텔UP' },
        { condition: '확정 출발일 7/5(화)', price_text: '1,590,000원', price: 1590000, badge: '확정' },
      ],
      notes: '나담 축제기간(7/9~7/15) 써차지 $30 별도 · 싱글차지 150,000원/인',
    },
  ],
  singleSupplement: '120,000원~150,000원/인 (기간별 상이)',
  guideTrip: '$50/인 (현지 지불)',
  kakaoChannelUrl: 'https://pf.kakao.com/_xcFxkBG/chat',
  reviewCount: 284,
  reviewScore: 4.9,
  departureGuaranteed: true,
  itinerary: {
    highlights: ['천문산 유리다리', '원가계 절경', '황룡동굴 탐방', '봉황고성 야경'],
    includes: ['왕복 직항', '전 일정 4성 호텔', '조식 5회 · 중식 5회 · 석식 4회', '전용버스', '한국인 가이드', '입장료 전체'],
    excludes: ['여행자 보험', '개인 경비', '선택관광', '팁'],
    days: [
      {
        day: 1,
        title: '인천 출발 → 장가계 도착',
        regions: '인천 · 장사',
        meals: { breakfast: false, lunch: false, dinner: true },
        activities: [
          { type: 'flight', label: '인천 → 장사 직항' },
          { type: 'transport', label: '장사 → 장가계 이동 (전용차, 약 3시간)' },
          { type: 'hotel', label: '장가계 시내 호텔 체크인', detail: '황금국제호텔 (4성)' },
        ],
        hotel: '황금국제호텔',
      },
      {
        day: 2,
        title: '천문산 유리다리 · 천문동',
        regions: '장가계',
        meals: { breakfast: true, lunch: true, dinner: true },
        activities: [
          { type: 'sightseeing', label: '천문산 케이블카 탑승', detail: '세계 최장 7,455m' },
          { type: 'sightseeing', label: '천문산 유리다리', detail: '해발 1,400m 짜릿한 체험' },
          { type: 'sightseeing', label: '천문동(天門洞)', detail: '999계단 하이라이트' },
          { type: 'optional', label: '[선택] 유리다리 VIP 구역', detail: '1인 ¥200' },
        ],
        hotel: '황금국제호텔',
      },
      {
        day: 3,
        title: '원가계 · 황석채 비경',
        regions: '원가계 국가삼림공원',
        meals: { breakfast: true, lunch: true, dinner: true },
        activities: [
          { type: 'sightseeing', label: '원가계 탑승 엘리베이터', detail: '세계 최고 실외 엘리베이터' },
          { type: 'sightseeing', label: '황석채 전망대', detail: '아바타 촬영지 실제 풍경' },
          { type: 'sightseeing', label: '금편계곡 산책', detail: '약 7.5km 트레킹' },
        ],
        hotel: '원가계 베스트 호텔',
      },
      {
        day: 4,
        title: '황룡동굴 · 보봉호 유람',
        regions: '장가계 · 장사',
        meals: { breakfast: true, lunch: true, dinner: true },
        activities: [
          { type: 'sightseeing', label: '황룡동굴 탐방', detail: '세계 4대 용암동굴' },
          { type: 'sightseeing', label: '보봉호 유람선', detail: '에메랄드빛 호수 크루즈' },
          { type: 'transport', label: '장가계 → 봉황고성 이동' },
        ],
        hotel: '봉황고성 민박형 호텔',
      },
      {
        day: 5,
        title: '봉황고성 전일 자유여행',
        regions: '봉황고성',
        meals: { breakfast: true, lunch: false, dinner: false },
        activities: [
          { type: 'sightseeing', label: '봉황고성 성내 골목 탐방' },
          { type: 'sightseeing', label: '타강(沱江) 뗏목 체험' },
          { type: 'optional', label: '[선택] 봉황고성 야간 조명 투어', detail: '1인 ¥80' },
          { type: 'shopping', label: '특산품 쇼핑: 은(銀) 공예품, 묘족 의상' },
        ],
        hotel: '봉황고성 민박형 호텔',
      },
      {
        day: 6,
        title: '장사 출발 → 인천 귀국',
        regions: '장사 · 인천',
        meals: { breakfast: true, lunch: false, dinner: false },
        activities: [
          { type: 'transport', label: '봉황고성 → 장사 공항 이동' },
          { type: 'flight', label: '장사 → 인천 직항' },
        ],
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('ko-KR');
}

const ACTIVITY_ICON: Record<DayActivity['type'], React.ReactNode> = {
  sightseeing: <Camera className="w-4 h-4 text-blue-500" />,
  meal:        <Utensils className="w-4 h-4 text-orange-400" />,
  hotel:       <Hotel className="w-4 h-4 text-purple-500" />,
  flight:      <span className="text-sm">✈️</span>,
  transport:   <Bus className="w-4 h-4 text-gray-400" />,
  optional:    <Star className="w-4 h-4 text-yellow-500" />,
  shopping:    <span className="text-sm">🛍</span>,
};

// ─────────────────────────────────────────────────────────────────────────────
// 서브 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

/** 상단 고정 스캐어시티 티커 */
function ScarcityTicker({ seats, dateLabel }: { seats: number; dateLabel: string }) {
  const isUrgent = seats <= 3;
  const bgClass = isUrgent
    ? 'bg-red-600 text-white'
    : 'bg-orange-500 text-white';

  return (
    <div className={`sticky top-0 z-50 text-center py-2.5 px-4 text-sm font-bold tracking-wide ${bgClass} ${isUrgent ? 'animate-pulse' : ''}`}>
      <Flame className="inline w-4 h-4 mr-1 -mt-0.5" />
      {dateLabel} 출발 &nbsp;—&nbsp; 잔여 <span className="text-yellow-300 text-base">{seats}석</span> 마감 임박!
    </div>
  );
}

/** 신뢰 배지 행 */
function TrustBadges({ reviewScore, reviewCount, guaranteed }: {
  reviewScore: number; reviewCount: number; guaranteed: boolean;
}) {
  return (
    <div className="flex justify-around py-5 bg-gray-50 border-y border-gray-100">
      <div className="flex flex-col items-center gap-1">
        <ShieldCheck className="w-6 h-6 text-blue-600" />
        <span className="text-xs font-semibold text-gray-700 text-center leading-tight">
          {guaranteed ? '출발\n100% 보장' : '출발 확정'}
        </span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <Award className="w-6 h-6 text-amber-500" />
        <span className="text-xs font-semibold text-gray-700 text-center leading-tight">직판\n최저가</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-0.5">
          <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
          <span className="text-sm font-bold text-gray-800">{reviewScore}</span>
        </div>
        <span className="text-xs text-gray-500">{fmt(reviewCount)}개 후기</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <Phone className="w-6 h-6 text-green-600" />
        <span className="text-xs font-semibold text-gray-700 text-center leading-tight">24시간\n현지 지원</span>
      </div>
    </div>
  );
}

/** 가격 섹션 */
function PriceSection({ priceFrom, originalPrice, earlyBirdDaysLeft, seats }: {
  priceFrom: number; originalPrice: number; earlyBirdDaysLeft: number; seats: number;
}) {
  const discount = Math.round((1 - priceFrom / originalPrice) * 100);
  return (
    <section className="px-5 py-6 bg-white">
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full animate-bounce ${
          earlyBirdDaysLeft <= 1 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'
        }`}>
          ⚡ 얼리버드 D-{earlyBirdDaysLeft}
        </span>
        <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-600">
          {discount}% 할인
        </span>
      </div>
      <div className="flex items-end gap-3 mt-2">
        <div>
          <p className="text-sm text-gray-400 line-through">{fmt(originalPrice)}원</p>
          <p className="text-3xl font-extrabold text-gray-900">
            {fmt(priceFrom)}<span className="text-lg font-semibold text-gray-600">원~</span>
          </p>
        </div>
        <p className="text-xs text-gray-400 pb-1">1인 기준 · 유류세 포함</p>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-sm text-red-600 font-medium">
        <Users className="w-4 h-4" />
        잔여 {seats}석 — 이 가격 곧 종료됩니다
      </div>
    </section>
  );
}

/** 하이라이트 태그 */
function Highlights({ items }: { items: string[] }) {
  return (
    <section className="px-5 py-5 bg-white border-t border-gray-100">
      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">여행 하이라이트</h3>
      <div className="flex flex-wrap gap-2">
        {items.map(h => (
          <span key={h} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-sm font-medium">
            <MapPin className="w-3.5 h-3.5" /> {h}
          </span>
        ))}
      </div>
    </section>
  );
}

/** 포함/불포함 */
function IncludeExclude({ includes, excludes }: { includes: string[]; excludes: string[] }) {
  return (
    <section className="px-5 py-5 bg-white border-t border-gray-100">
      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">포함 / 불포함</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div className="space-y-2">
          {includes.map(i => (
            <div key={i} className="flex items-start gap-2 text-sm text-gray-700">
              <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
              {i}
            </div>
          ))}
        </div>
        <div className="space-y-2">
          {excludes.map(e => (
            <div key={e} className="flex items-start gap-2 text-sm text-gray-500">
              <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              {e}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** 식사 아이콘 행 */
function MealRow({ meals }: { meals: ItineraryDay['meals'] }) {
  return (
    <div className="flex gap-3 mt-1">
      <span className={`flex items-center gap-0.5 text-xs ${meals.breakfast ? 'text-orange-500' : 'text-gray-300'}`}>
        <Utensils className="w-3 h-3" /> 조
      </span>
      <span className={`flex items-center gap-0.5 text-xs ${meals.lunch ? 'text-orange-500' : 'text-gray-300'}`}>
        <Utensils className="w-3 h-3" /> 중
      </span>
      <span className={`flex items-center gap-0.5 text-xs ${meals.dinner ? 'text-orange-500' : 'text-gray-300'}`}>
        <Utensils className="w-3 h-3" /> 석
      </span>
    </div>
  );
}

/** 일정 아코디언 단일 Day */
function DayAccordion({ dayData, defaultOpen = false }: { dayData: ItineraryDay; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-start justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex gap-3 items-start">
          <div className="mt-0.5 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
            D{dayData.day}
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-sm leading-snug">{dayData.title}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <MapPin className="w-3 h-3 text-gray-400" />
              <span className="text-xs text-gray-400">{dayData.regions}</span>
            </div>
            <MealRow meals={dayData.meals} />
          </div>
        </div>
        <div className="mt-1 shrink-0 ml-2 text-gray-400">
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* 상세 슬라이드다운 */}
      <div className={`overflow-hidden transition-all duration-300 ${open ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="px-5 pb-4 space-y-2.5 bg-gray-50/60">
          {/* 타임라인 라인 */}
          <div className="ml-4 border-l-2 border-blue-100 pl-4 space-y-2.5 pt-1">
            {dayData.activities.map((act, i) => (
              <div key={i} className={`flex items-start gap-2.5 ${act.type === 'optional' ? 'opacity-70' : ''}`}>
                <div className="mt-0.5 shrink-0">{ACTIVITY_ICON[act.type]}</div>
                <div>
                  <p className="text-sm text-gray-800 font-medium leading-snug">{act.label}</p>
                  {act.detail && (
                    <p className="text-xs text-gray-400 mt-0.5">{act.detail}</p>
                  )}
                  {act.type === 'optional' && (
                    <span className="inline-block mt-1 text-xs px-2 py-0.5 bg-yellow-50 text-yellow-700 rounded-full font-medium">선택관광</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {/* 숙박 */}
          {dayData.hotel && (
            <div className="flex items-center gap-2 pl-0.5 pt-1">
              <Hotel className="w-4 h-4 text-purple-400 shrink-0" />
              <span className="text-xs text-gray-600 font-medium">{dayData.hotel}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 일정표 전체 섹션 (Intersection Observer 대상) */
function ItinerarySection({
  days,
  onViewed,
}: {
  days: ItineraryDay[];
  onViewed: () => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= 0.5) {
          onViewed();
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onViewed]);

  return (
    <section ref={sectionRef} className="bg-white border-t border-gray-100 mt-2">
      <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100">
        <h3 className="text-base font-bold text-gray-900">상세 일정</h3>
        <span className="text-xs text-gray-400 flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" /> {days.length}일 전체 일정
        </span>
      </div>
      {days.map((d, i) => (
        <DayAccordion key={d.day} dayData={d} defaultOpen={i === 0} />
      ))}
    </section>
  );
}

/** 후기 카드 슬라이더 (Mock) */
const MOCK_REVIEWS = [
  { name: '김**', rating: 5, text: '천문산 유리다리에서 숨이 멎는 줄 알았어요. 가이드분도 너무 친절하셨고 음식도 현지 특색이 살아있어 좋았습니다.', date: '2025.10' },
  { name: '이**', rating: 5, text: '원가계 풍경이 진짜 압도적입니다. 아바타 영화가 왜 여기서 촬영했는지 이해됩니다. 다음에도 여소남으로 예약할게요!', date: '2025.11' },
  { name: '박**', rating: 5, text: '봉황고성 야경이 특히 기억에 남아요. 일정 구성이 알차면서도 여유 있어서 체력적으로 힘들지 않았습니다.', date: '2025.12' },
];

function ReviewSection({ score, count }: { score: number; count: number }) {
  return (
    <section className="bg-white border-t border-gray-100 mt-2 px-5 py-6">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-base font-bold text-gray-900">고객 후기</h3>
        <div className="flex items-center gap-1">
          <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
          <span className="text-sm font-bold text-gray-800">{score}</span>
          <span className="text-xs text-gray-400">({fmt(count)})</span>
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory">
        {MOCK_REVIEWS.map((r, i) => (
          <div key={i} className="shrink-0 w-64 snap-start bg-gray-50 rounded-2xl p-4 border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <div className="flex gap-0.5">
                {Array.from({ length: r.rating }).map((_, j) => (
                  <Star key={j} className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                ))}
              </div>
              <span className="text-xs text-gray-400">{r.date}</span>
            </div>
            <p className="text-xs text-gray-700 leading-relaxed line-clamp-4">{r.text}</p>
            <p className="text-xs text-gray-400 mt-2 font-medium">{r.name}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 페이지
// ─────────────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const searchParams = useSearchParams();
  const source = (searchParams.get('source') ?? 'default') as ChannelSource;
  const validSource: ChannelSource = ['insta', 'kakao'].includes(source) ? source : 'default';

  const data = MOCK_DATA;
  const msg = data.customMessage[validSource];

  // Intersection Observer → FAB 활성화
  const { itineraryViewed, setItineraryViewed, registerScrollSentinel, getSnapshot } = useTracking();
  const handleItineraryViewed = useCallback(() => setItineraryViewed(true), [setItineraryViewed]);

  const [sheetOpen, setSheetOpen] = useState(false);

  // 스크롤 깊이 센티널 refs
  const sentinel25Ref = useRef<HTMLDivElement>(null);
  const sentinel50Ref = useRef<HTMLDivElement>(null);
  const sentinel90Ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c25 = registerScrollSentinel(sentinel25Ref.current, 25);
    const c50 = registerScrollSentinel(sentinel50Ref.current, 50);
    const c90 = registerScrollSentinel(sentinel90Ref.current, 90);
    return () => { c25?.(); c50?.(); c90?.(); };
  }, [registerScrollSentinel]);

  // 채널별 히어로 스타일
  const isInsta = validSource === 'insta';
  const isKakao = validSource === 'kakao';
  const heroImage = isInsta ? data.heroImageA : data.heroImageB;

  // 채널별 FAB 텍스트
  const fabText = isInsta ? '✨ 감성 여행 상담받기' : '💬 지금 카카오로 상담하기';

  return (
    <div className="min-h-screen bg-gray-50 max-w-[430px] mx-auto relative pb-32">

      {/* ── 스캐어시티 티커 ─────────────────────────────────────── */}
      <ScarcityTicker seats={data.availableSeats} dateLabel={data.departureDateLabel} />

      {/* 스크롤 25% 센티널 */}
      <div ref={sentinel25Ref} className="absolute" style={{ top: '25%', height: 1, width: 1, pointerEvents: 'none' }} />

      {/* ── 히어로 섹션 ────────────────────────────────────────── */}
      <section className="relative overflow-hidden" style={{ height: '72vw', maxHeight: 360 }}>
        {/* 배경 이미지 */}
        <img
          src={heroImage}
          alt={data.destination}
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* 그라디언트 오버레이 — 채널별 */}
        <div className={`absolute inset-0 ${
          isInsta
            ? 'bg-gradient-to-b from-rose-900/20 via-transparent to-gray-900/80'
            : isKakao
            ? 'bg-gradient-to-b from-blue-900/30 via-transparent to-gray-900/85'
            : 'bg-gradient-to-b from-gray-900/20 via-transparent to-gray-900/75'
        }`} />
        {/* 텍스트 오버레이 */}
        <div className="absolute bottom-0 left-0 right-0 px-5 pb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/20 text-white backdrop-blur-sm">
              {data.destination}
            </span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/20 text-white backdrop-blur-sm">
              {data.duration}
            </span>
          </div>
          <h1 className={`text-white leading-tight whitespace-pre-line drop-shadow-md ${
            isInsta
              ? 'text-2xl font-light tracking-wide'
              : isKakao
              ? 'text-2xl font-extrabold'
              : 'text-2xl font-bold'
          }`}>
            {msg.headline}
          </h1>
          <p className="text-white/80 text-sm mt-2 leading-relaxed drop-shadow-sm">{msg.subline}</p>
        </div>
      </section>

      {/* ── 신뢰 배지 ───────────────────────────────────────────── */}
      <TrustBadges
        reviewScore={data.reviewScore}
        reviewCount={data.reviewCount}
        guaranteed={data.departureGuaranteed}
      />

      {/* ── 가격 섹션 (히어로: 얼리버드 배지 + 스칼라 가격) ────────── */}
      <PriceSection
        priceFrom={data.priceFrom}
        originalPrice={data.originalPrice}
        earlyBirdDaysLeft={data.earlyBirdDaysLeft}
        seats={data.availableSeats}
      />

      {/* ── 상세 요금표 (날짜/조건별 카드 UI) ──────────────────────── */}
      {data.price_list && data.price_list.length > 0 && (
        <PriceSectionCard
          title={`${data.destination} ${data.duration}`}
          destination={data.destination}
          priceList={data.price_list}
          singleSupplement={data.singleSupplement}
          guideTrip={data.guideTrip}
        />
      )}

      {/* ── 하이라이트 ──────────────────────────────────────────── */}
      <Highlights items={data.itinerary.highlights} />

      {/* 스크롤 50% 센티널 */}
      <div ref={sentinel50Ref} className="absolute" style={{ top: '50%', height: 1, width: 1, pointerEvents: 'none' }} />

      {/* ── 일정표 (Intersection Observer) ──────────────────────── */}
      <ItinerarySection
        days={data.itinerary.days}
        onViewed={handleItineraryViewed}
      />

      {/* ── 포함/불포함 ─────────────────────────────────────────── */}
      <IncludeExclude
        includes={data.itinerary.includes}
        excludes={data.itinerary.excludes}
      />

      {/* ── 후기 ────────────────────────────────────────────────── */}
      <ReviewSection score={data.reviewScore} count={data.reviewCount} />

      {/* 스크롤 90% 센티널 */}
      <div ref={sentinel90Ref} className="h-1" />

      {/* ── 하단 여백 ───────────────────────────────────────────── */}
      <div className="h-12" />

      {/* ── 플로팅 CTA (FAB) ────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-center pb-safe-area">
        <div className="w-full max-w-[430px] px-4 pb-5 pt-3 bg-gradient-to-t from-white via-white/90 to-transparent">
          <button
            onClick={() => setSheetOpen(true)}
            className={`w-full py-4 rounded-2xl font-extrabold text-base flex items-center justify-center gap-2 shadow-xl transition-all duration-300
              bg-[#FEE500] text-gray-900 hover:brightness-95 active:scale-[0.98]
              ${itineraryViewed ? 'animate-pulse scale-[1.02] shadow-yellow-300/60 shadow-2xl' : 'shadow-gray-300/60'}`}
          >
            <MessageCircle className="w-5 h-5" />
            {fabText}
          </button>
          <p className="text-center text-xs text-gray-400 mt-2">
            무료 상담 · 평균 응답 3분 이내
          </p>
        </div>
      </div>

      {/* ── 상담 신청 Bottom Sheet ───────────────────────────────── */}
      <LeadBottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        defaultDate={data.departureFullDate}
        onSubmit={async (form) => {
          await submitLeadPipeline(
            data.id,
            form,
            getSnapshot(),
            data.kakaoChannelUrl
          );
          setSheetOpen(false);
        }}
      />
    </div>
  );
}
