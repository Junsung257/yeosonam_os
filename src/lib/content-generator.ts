/**
 * ══════════════════════════════════════════════════════════
 * Content Generator — 여행 특화 앵글별 AI 콘텐츠 생성 엔진
 * ══════════════════════════════════════════════════════════
 */

import { searchPexelsPhotos, isPexelsConfigured } from './pexels';
import { getMinPriceFromDates } from './price-dates';
import { matchAttraction as matchAttr } from './attraction-matcher';

// ── 타입 ─────────────────────────────────────────────────

export type AngleType = 'value' | 'emotional' | 'filial' | 'luxury' | 'urgency' | 'activity' | 'food';
export type Channel = 'instagram_card' | 'instagram_reel' | 'naver_blog' | 'google_search' | 'youtube_short' | 'kakao';
export type ImageRatio = '1:1' | '4:5' | '9:16' | '16:9';

export interface SlideElement {
  id: string;
  type: 'text' | 'image' | 'shape';
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline' | 'line-through';
  color?: string;
  textAlign?: 'left' | 'center' | 'right';
  bgColor?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Slide {
  id: string;
  bgColor: string;
  bgImage?: string;
  bgOverlay?: string;
  bgOpacity: number;
  elements: SlideElement[];
}

export interface ProductData {
  id: string;
  title: string;
  destination?: string;
  duration?: number;
  nights?: number;
  price?: number;
  price_tiers?: { adult_price?: number; period_label?: string }[];
  price_dates?: { date: string; price: number; confirmed: boolean }[];
  inclusions?: string[];
  excludes?: string[];
  product_type?: string;
  airline?: string;
  departure_airport?: string;
  product_highlights?: string[];
  itinerary?: string[];
  optional_tours?: { name: string; price_usd?: number }[];
}

export interface GenerateOptions {
  angle: AngleType;
  channel: Channel;
  ratio: ImageRatio;
  slideCount: number;
  tone: string;
  extraPrompt?: string;
}

// ── 앵글 프리셋 ──────────────────────────────────────────

export const ANGLE_PRESETS: Record<AngleType, { label: string; description: string; color: string; emoji: string }> = {
  value:     { label: '가성비',    description: '가격, 포함사항 강조',        color: '#059669', emoji: '' },
  emotional: { label: '감성',      description: '풍경, 체험, 감정 강조',      color: '#8b5cf6', emoji: '' },
  filial:    { label: '효도',      description: '안심, 노팁, 편안 강조',      color: '#d97706', emoji: '' },
  luxury:    { label: '럭셔리',    description: '5성급, 마사지, 특식 강조',    color: '#0ea5e9', emoji: '' },
  urgency:   { label: '긴급',      description: '마감임박, 잔여석 강조',      color: '#ef4444', emoji: '' },
  activity:  { label: '액티비티',  description: '관광지, 체험 강조',          color: '#f59e0b', emoji: '' },
  food:      { label: '미식',      description: '특식, 맛집 강조',            color: '#ec4899', emoji: '' },
};

// 각 앵글의 서브 키워드: 긴꼬리 SEO용 (1개 상품 → 여러 검색어 타겟)
export const ANGLE_SUB_KEYWORDS: Record<AngleType, { keyword: string; focus: string }[]> = {
  value: [
    { keyword: '가성비',      focus: '가격 대비 만족도, 전체 패키지 가치' },
    { keyword: '노팁 노옵션', focus: '숨은 비용 제로, 투명한 가격' },
    { keyword: '실속 패키지',  focus: '합리적 선택, 필수만 담은 구성' },
    { keyword: '특가 여행',    focus: '같은 일정 경쟁사 대비 가격 강점' },
    { keyword: '저렴한 여행',  focus: '절약 팁, 여행 예산 관리' },
  ],
  emotional: [
    { keyword: '힐링 여행',    focus: '휴식, 마음의 여유, 스트레스 해소' },
    { keyword: '감성 여행',    focus: '분위기, 풍경, 사진 포인트' },
    { keyword: '낭만 여행',    focus: '야경, 커플/친구 추억' },
    { keyword: '가족 여행',    focus: '함께하는 시간, 세대 공감' },
    { keyword: '자연 힐링',    focus: '자연 경관, 청정 환경' },
  ],
  filial: [
    { keyword: '효도여행',     focus: '부모님 만족, 편안한 동선' },
    { keyword: '어르신 여행',  focus: '시니어 맞춤, 무릎/체력 부담 없는 코스' },
    { keyword: '부모님 여행',  focus: '첫 해외, 안심 패키지' },
    { keyword: '노팁 안심',    focus: '추가 비용 없이 편안한 여행' },
    { keyword: '가족 효도',    focus: '가족 모두 만족, 세심한 케어' },
  ],
  luxury: [
    { keyword: '5성급 호텔',   focus: '숙박 품격, 서비스 수준' },
    { keyword: '럭셔리 패키지', focus: '프리미엄 구성, VIP 케어' },
    { keyword: '프리미엄 여행', focus: '고급 레스토랑, 특식' },
    { keyword: '신혼여행',     focus: '허니문 특화, 로맨틱 포인트' },
    { keyword: '고급 패키지',   focus: '전 구성 고급화, 가치 중심' },
  ],
  urgency: [
    { keyword: '마감임박',     focus: '잔여석 한정, 기회 놓치면 끝' },
    { keyword: '특가 땡처리',  focus: '시즌 오프 할인, 한정 특가' },
    { keyword: '잔여석 할인',  focus: '출발 확정, 남은 자리 공략' },
    { keyword: '초특가',       focus: '역대급 가격, 한정 수량' },
    { keyword: '한정 특가',    focus: '기간 한정, 오늘만 이 가격' },
  ],
  activity: [
    { keyword: '액티비티 여행', focus: '체험 중심, 스릴 포인트' },
    { keyword: '투어 패키지',  focus: '관광지 종합, 알찬 일정' },
    { keyword: '체험 여행',    focus: '현지 문화 체험, 참여형' },
    { keyword: '모험 여행',    focus: '새로운 경험, 도전' },
    { keyword: '관광 일정',    focus: '명소 루트, 동선 효율' },
  ],
  food: [
    { keyword: '미식 여행',    focus: '현지 특식, 맛집 투어' },
    { keyword: '맛집 투어',    focus: '로컬 레스토랑, 숨은 맛집' },
    { keyword: '현지 음식',    focus: '정통 요리, 길거리 음식' },
    { keyword: '특식 패키지',  focus: '씨푸드/뷔페 등 고급 식사' },
    { keyword: '먹방 여행',    focus: '음식 중심 일정, SNS 인증' },
  ],
};

export const CHANNEL_PRESETS: Record<Channel, { label: string; description: string }> = {
  instagram_card:  { label: '인스타 카드뉴스', description: '1080px 슬라이드' },
  instagram_reel:  { label: '인스타 릴스',     description: '스크립트 + 자막' },
  naver_blog:      { label: '네이버 블로그',   description: 'SEO 최적화 포스팅' },
  google_search:   { label: '구글 검색광고',   description: '제목 + 설명 카피' },
  youtube_short:   { label: '유튜브 쇼츠',     description: '60초 스크립트' },
  kakao:           { label: '카카오 알림톡',   description: '알림 문구' },
};

// ── 유틸 ─────────────────────────────────────────────────

function uid(): string { return crypto.randomUUID(); }
function getLowestPrice(p: ProductData): number {
  if (p.price_dates?.length) {
    const min = getMinPriceFromDates(p.price_dates as any);
    if (min > 0) return min;
  }
  const prices: number[] = [];
  if (p.price && p.price > 0) prices.push(p.price);
  if (p.price_tiers) for (const t of p.price_tiers) if (t.adult_price && t.adult_price > 0) prices.push(t.adult_price);
  return prices.length > 0 ? Math.min(...prices) : 0;
}

function generateTrackingId(dest: string): string {
  const destCode = (dest || 'ETC').slice(0, 3).toUpperCase();
  const date = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `YSN-${destCode}-${date}-${rand}`;
}

async function getPexelsImage(keyword: string): Promise<string> {
  if (!isPexelsConfigured()) return '';
  try {
    const photos = await searchPexelsPhotos(keyword, 3);
    return photos[0]?.src?.large2x ?? '';
  } catch { return ''; }
}

// ── 앵글별 슬라이드 텍스트 생성 ──────────────────────────

function getAngleTexts(product: ProductData, angle: AngleType, slideCount: number): { headline: string; body: string }[] {
  const dest = product.destination || '여행지';
  const price = getLowestPrice(product);
  const priceStr = price > 0 ? `${price.toLocaleString()}원` : '';
  const nights = product.nights ?? (product.duration ? product.duration - 1 : 0);
  const dur = product.duration ? `${nights}박${product.duration}일` : '';
  const type = product.product_type || '';
  const inclusions = product.inclusions || [];
  const highlights = product.product_highlights || [];

  const slides: { headline: string; body: string }[] = [];

  switch (angle) {
    case 'value':
      slides.push({ headline: `${dest} ${dur}`, body: priceStr ? `단 ${priceStr}부터` : `${dest} 여행` });
      slides.push({ headline: '이 가격에 이 구성?', body: inclusions.slice(0, 3).join('\n') || '항공+호텔+관광 올인클루시브' });
      slides.push({ headline: '포함사항 총정리', body: inclusions.slice(0, 5).join('\n') || '전일정 포함' });
      slides.push({ headline: type ? `${type} 일정` : '알찬 일정', body: (product.itinerary || []).slice(0, 2).join('\n') || `${dest} 핵심 관광` });
      slides.push({ headline: '가성비 끝판왕', body: `${dest} ${dur} ${priceStr}\n지금 바로 예약` });
      slides.push({ headline: '여소남과 함께', body: '가치있는 여행을 소개합니다\nyeosonam.com' });
      break;

    case 'emotional':
      slides.push({ headline: `${dest}의 밤,\n잊을 수 없는 순간`, body: '' });
      slides.push({ headline: '눈 앞에 펼쳐진\n그 풍경', body: highlights[0] || `${dest}의 아름다운 풍경을 만나다` });
      slides.push({ headline: '여행의 설렘,\n그 순간을 함께', body: highlights[1] || '새로운 경험이 기다리는 곳' });
      slides.push({ headline: '마음이 쉬어가는\n시간', body: inclusions.find(i => i.includes('마사지') || i.includes('호텔')) || '온전한 휴식' });
      slides.push({ headline: `${dest}에서\n나를 만나다`, body: `${dur} ${priceStr ? priceStr + '~' : ''}` });
      slides.push({ headline: '여소남', body: '가치있는 여행을 소개합니다' });
      break;

    case 'filial':
      slides.push({ headline: '부모님 첫 해외여행\n안심 패키지', body: dest });
      slides.push({ headline: type?.includes('노팁') ? '노팁이라 편해요' : '편안한 여행', body: '가이드가 처음부터 끝까지 동행' });
      slides.push({ headline: '전일정 관리', body: inclusions.slice(0, 3).join('\n') || '항공+숙박+식사+관광' });
      slides.push({ headline: '특별한 식사', body: inclusions.filter(i => i.includes('식') || i.includes('뷔페')).join('\n') || '현지 특식 포함' });
      slides.push({ headline: `효도여행 ${priceStr ? priceStr + '~' : ''}`, body: `${dest} ${dur}` });
      slides.push({ headline: '여소남과 함께\n감사의 마음을 전하세요', body: 'yeosonam.com' });
      break;

    case 'luxury':
      slides.push({ headline: `${dest}\n프리미엄 여행`, body: '' });
      slides.push({ headline: '5성급 호텔', body: inclusions.find(i => i.includes('5성') || i.includes('호텔')) || '최고급 숙박' });
      slides.push({ headline: '스페셜 케어', body: inclusions.find(i => i.includes('마사지') || i.includes('스파')) || '프리미엄 서비스' });
      slides.push({ headline: '미식의 향연', body: inclusions.filter(i => i.includes('식') || i.includes('뷔페')).slice(0, 2).join('\n') || '특별한 다이닝' });
      slides.push({ headline: `${dur} ${priceStr}~`, body: '나를 위한 럭셔리' });
      slides.push({ headline: '여소남 프리미엄', body: '가치있는 여행을 소개합니다' });
      break;

    case 'urgency':
      slides.push({ headline: '마감임박!', body: `${dest} ${dur}` });
      slides.push({ headline: `${priceStr || '특가'}`, body: '이 가격 다시 없습니다' });
      slides.push({ headline: '선착순 마감', body: '잔여석이 얼마 남지 않았습니다' });
      slides.push({ headline: '놓치면 후회', body: inclusions.slice(0, 3).join('\n') || '올인클루시브 포함' });
      slides.push({ headline: '지금 바로\n예약하세요', body: `${dest} ${dur} ${priceStr}` });
      slides.push({ headline: '여소남', body: '가치있는 여행을 소개합니다\nyeosonam.com' });
      break;

    case 'activity':
      slides.push({ headline: `${dest}\n액티비티 여행`, body: '' });
      slides.push({ headline: '이런 체험이?', body: highlights[0] || (product.itinerary || [])[0] || `${dest} 핵심 관광` });
      slides.push({ headline: '놓칠 수 없는 명소', body: highlights[1] || (product.itinerary || [])[1] || '현지 인기 스팟' });
      slides.push({ headline: '알찬 일정', body: (product.itinerary || []).slice(0, 2).join('\n') || `${dest} 완전 정복` });
      slides.push({ headline: `${dur} ${priceStr}~`, body: '모험이 기다립니다' });
      slides.push({ headline: '여소남', body: '가치있는 여행을 소개합니다' });
      break;

    case 'food':
      slides.push({ headline: `${dest}\n미식 여행`, body: '' });
      const foods = inclusions.filter(i => i.includes('식') || i.includes('뷔페') || i.includes('맛'));
      slides.push({ headline: '현지 특식', body: foods[0] || '현지 최고의 맛' });
      slides.push({ headline: '매일 새로운 맛', body: foods.slice(1, 3).join('\n') || '다양한 미식 체험' });
      slides.push({ headline: '먹방 여행', body: `${dest}에서만 맛볼 수 있는 특별함` });
      slides.push({ headline: `${dur} ${priceStr}~`, body: '미식 여행의 시작' });
      slides.push({ headline: '여소남', body: '가치있는 여행을 소개합니다' });
      break;
  }

  return slides.slice(0, slideCount);
}

// ── 디자인 템플릿 프리셋 (10종) ───────────────────────────

export type TemplateId = 'dark_cinematic' | 'clean_white' | 'bold_gradient' | 'magazine' | 'minimal_photo'
  | 'neon_night' | 'warm_earth' | 'ocean_blue' | 'luxury_gold' | 'fresh_green';

export interface TemplatePreset {
  id: TemplateId;
  name: string;
  description: string;
  preview: string; // 프리뷰 설명
  coverStyle: {
    bgColor: string;
    bgOverlay: string;
    bgOpacity: number;
    headlineFont: string;
    headlineSize: number;
    headlineColor: string;
    headlineY: number;
    bodyFont: string;
    bodySize: number;
    bodyColor: string;
    bodyY: number;
    brandBgColor: string;
    brandTextColor: string;
  };
  bodyStyle: {
    bgColor: string;
    bgOverlay: string;
    bgOpacity: number;
    usePhoto: boolean;
    headlineFont: string;
    headlineSize: number;
    headlineColor: string;
    headlineAlign: 'left' | 'center' | 'right';
    headlineY: number;
    bodyFont: string;
    bodySize: number;
    bodyColor: string;
    bodyAlign: 'left' | 'center' | 'right';
    bodyY: number;
    accentColor: string;
  };
  ctaStyle: {
    bgColor: string;
    bgOverlay: string;
    ctaText: string;
    ctaBgColor: string;
    ctaTextColor: string;
  };
}

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    id: 'dark_cinematic', name: '다크 시네마틱', description: '풍경 사진 + 큰 흰색 텍스트 (장가계/자연 추천)',
    preview: '어두운 배경 + 대형 타이포',
    coverStyle: { bgColor: '#0a0a0a', bgOverlay: 'linear-gradient(to top, rgba(0,0,0,0.8), rgba(0,0,0,0.2))', bgOpacity: 75,
      headlineFont: 'Pretendard', headlineSize: 52, headlineColor: '#ffffff', headlineY: 30,
      bodyFont: 'Pretendard', bodySize: 22, bodyColor: '#cccccc', bodyY: 60,
      brandBgColor: '#ffffff', brandTextColor: '#000000' },
    bodyStyle: { bgColor: '#0a0a0a', bgOverlay: 'linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0.3))', bgOpacity: 80, usePhoto: true,
      headlineFont: 'Pretendard', headlineSize: 40, headlineColor: '#ffffff', headlineAlign: 'left', headlineY: 15,
      bodyFont: 'Pretendard', bodySize: 20, bodyColor: '#d4d4d4', bodyAlign: 'left', bodyY: 50,
      accentColor: '#f59e0b' },
    ctaStyle: { bgColor: '#0a0a0a', bgOverlay: 'linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.4))',
      ctaText: '지금 예약하기', ctaBgColor: '#ffffff', ctaTextColor: '#000000' },
  },
  {
    id: 'clean_white', name: '클린 화이트', description: '흰 배경 + 정보형 카드 (마이리얼트립 스타일)',
    preview: '밝은 배경 + 카드형 레이아웃',
    coverStyle: { bgColor: '#fafafa', bgOverlay: '', bgOpacity: 0,
      headlineFont: 'Pretendard', headlineSize: 44, headlineColor: '#1a1a1a', headlineY: 25,
      bodyFont: 'Pretendard', bodySize: 20, bodyColor: '#666666', bodyY: 58,
      brandBgColor: '#001f3f', brandTextColor: '#ffffff' },
    bodyStyle: { bgColor: '#fafafa', bgOverlay: '', bgOpacity: 0, usePhoto: false,
      headlineFont: 'Pretendard', headlineSize: 36, headlineColor: '#1a1a1a', headlineAlign: 'left', headlineY: 8,
      bodyFont: 'Pretendard', bodySize: 18, bodyColor: '#444444', bodyAlign: 'left', bodyY: 28,
      accentColor: '#005d90' },
    ctaStyle: { bgColor: '#fafafa', bgOverlay: '',
      ctaText: '자세히 보기', ctaBgColor: '#001f3f', ctaTextColor: '#ffffff' },
  },
  {
    id: 'bold_gradient', name: '볼드 그라디언트', description: '강렬한 그라디언트 + 큰 타이포 (가격 강조)',
    preview: '파란→보라 그라디언트 + 대형 폰트',
    coverStyle: { bgColor: '#1e1b4b', bgOverlay: 'linear-gradient(135deg, #1e3a5f 0%, #4c1d95 100%)', bgOpacity: 95,
      headlineFont: 'Pretendard', headlineSize: 56, headlineColor: '#ffffff', headlineY: 25,
      bodyFont: 'Pretendard', bodySize: 24, bodyColor: '#c4b5fd', bodyY: 58,
      brandBgColor: '#f59e0b', brandTextColor: '#000000' },
    bodyStyle: { bgColor: '#1e1b4b', bgOverlay: 'linear-gradient(135deg, #1e3a5f 0%, #4c1d95 100%)', bgOpacity: 90, usePhoto: false,
      headlineFont: 'Pretendard', headlineSize: 38, headlineColor: '#ffffff', headlineAlign: 'center', headlineY: 15,
      bodyFont: 'Pretendard', bodySize: 20, bodyColor: '#c4b5fd', bodyAlign: 'center', bodyY: 45,
      accentColor: '#f59e0b' },
    ctaStyle: { bgColor: '#1e1b4b', bgOverlay: 'linear-gradient(135deg, #1e3a5f 0%, #4c1d95 100%)',
      ctaText: '특가 예약', ctaBgColor: '#f59e0b', ctaTextColor: '#000000' },
  },
  {
    id: 'magazine', name: '매거진', description: '사진 상단 + 하단 텍스트 박스 (안데르센 스타일)',
    preview: '사진 위 + 아래 정보 카드',
    coverStyle: { bgColor: '#000000', bgOverlay: 'linear-gradient(to top, rgba(0,0,0,0.95) 35%, transparent 65%)', bgOpacity: 90,
      headlineFont: 'Pretendard', headlineSize: 48, headlineColor: '#ffffff', headlineY: 55,
      bodyFont: 'Pretendard', bodySize: 20, bodyColor: '#e5e5e5', bodyY: 78,
      brandBgColor: '#ef4444', brandTextColor: '#ffffff' },
    bodyStyle: { bgColor: '#ffffff', bgOverlay: '', bgOpacity: 0, usePhoto: false,
      headlineFont: 'Pretendard', headlineSize: 34, headlineColor: '#1a1a1a', headlineAlign: 'left', headlineY: 5,
      bodyFont: 'Pretendard', bodySize: 17, bodyColor: '#555555', bodyAlign: 'left', bodyY: 25,
      accentColor: '#ef4444' },
    ctaStyle: { bgColor: '#000000', bgOverlay: 'linear-gradient(to top, rgba(0,0,0,0.95) 40%, transparent)',
      ctaText: '예약 문의', ctaBgColor: '#ef4444', ctaTextColor: '#ffffff' },
  },
  {
    id: 'minimal_photo', name: '미니멀 포토', description: '풀사진 + 하단 소형 텍스트 (ddokbi 스타일)',
    preview: '전면 사진 + 하단 캡션',
    coverStyle: { bgColor: '#000000', bgOverlay: 'linear-gradient(to top, rgba(0,0,0,0.7) 25%, transparent 55%)', bgOpacity: 65,
      headlineFont: 'Pretendard', headlineSize: 44, headlineColor: '#ffffff', headlineY: 50,
      bodyFont: 'Pretendard', bodySize: 18, bodyColor: '#d4d4d4', bodyY: 72,
      brandBgColor: '#22c55e', brandTextColor: '#ffffff' },
    bodyStyle: { bgColor: '#000000', bgOverlay: 'linear-gradient(to top, rgba(0,0,0,0.6) 20%, transparent 50%)', bgOpacity: 55, usePhoto: true,
      headlineFont: 'Pretendard', headlineSize: 32, headlineColor: '#ffffff', headlineAlign: 'left', headlineY: 60,
      bodyFont: 'Pretendard', bodySize: 16, bodyColor: '#cccccc', bodyAlign: 'left', bodyY: 78,
      accentColor: '#22c55e' },
    ctaStyle: { bgColor: '#000000', bgOverlay: 'linear-gradient(to top, rgba(0,0,0,0.8) 30%, transparent)',
      ctaText: '상세 정보 보기', ctaBgColor: '#22c55e', ctaTextColor: '#ffffff' },
  },
  {
    id: 'neon_night', name: '네온 나이트', description: '다크 배경 + 네온 악센트 (클럽/야경 추천)',
    preview: '블랙 + 핑크/퍼플 네온',
    coverStyle: { bgColor: '#0f0f23', bgOverlay: 'linear-gradient(135deg, rgba(236,72,153,0.3), rgba(139,92,246,0.3))', bgOpacity: 80,
      headlineFont: 'Pretendard', headlineSize: 50, headlineColor: '#f472b6', headlineY: 30,
      bodyFont: 'Pretendard', bodySize: 22, bodyColor: '#e9d5ff', bodyY: 60,
      brandBgColor: '#ec4899', brandTextColor: '#ffffff' },
    bodyStyle: { bgColor: '#0f0f23', bgOverlay: '', bgOpacity: 0, usePhoto: false,
      headlineFont: 'Pretendard', headlineSize: 36, headlineColor: '#c084fc', headlineAlign: 'center', headlineY: 15,
      bodyFont: 'Pretendard', bodySize: 18, bodyColor: '#d4d4d8', bodyAlign: 'center', bodyY: 45,
      accentColor: '#f472b6' },
    ctaStyle: { bgColor: '#0f0f23', bgOverlay: 'linear-gradient(135deg, rgba(236,72,153,0.2), rgba(139,92,246,0.2))',
      ctaText: '지금 바로', ctaBgColor: '#ec4899', ctaTextColor: '#ffffff' },
  },
  {
    id: 'warm_earth', name: '웜 어스', description: '베이지/브라운 톤 (효도여행/온천 추천)',
    preview: '따뜻한 베이지 톤',
    coverStyle: { bgColor: '#fef3c7', bgOverlay: '', bgOpacity: 0,
      headlineFont: 'Pretendard', headlineSize: 46, headlineColor: '#78350f', headlineY: 28,
      bodyFont: 'Pretendard', bodySize: 20, bodyColor: '#92400e', bodyY: 58,
      brandBgColor: '#92400e', brandTextColor: '#ffffff' },
    bodyStyle: { bgColor: '#fffbeb', bgOverlay: '', bgOpacity: 0, usePhoto: false,
      headlineFont: 'Pretendard', headlineSize: 34, headlineColor: '#78350f', headlineAlign: 'left', headlineY: 8,
      bodyFont: 'Pretendard', bodySize: 17, bodyColor: '#a16207', bodyAlign: 'left', bodyY: 28,
      accentColor: '#d97706' },
    ctaStyle: { bgColor: '#fef3c7', bgOverlay: '',
      ctaText: '편안한 여행 시작', ctaBgColor: '#92400e', ctaTextColor: '#ffffff' },
  },
  {
    id: 'ocean_blue', name: '오션 블루', description: '파란 그라디언트 (해변/동남아 추천)',
    preview: '시원한 블루 톤',
    coverStyle: { bgColor: '#0c4a6e', bgOverlay: 'linear-gradient(to bottom, #0369a1, #0c4a6e)', bgOpacity: 90,
      headlineFont: 'Pretendard', headlineSize: 50, headlineColor: '#ffffff', headlineY: 28,
      bodyFont: 'Pretendard', bodySize: 22, bodyColor: '#bae6fd', bodyY: 60,
      brandBgColor: '#0ea5e9', brandTextColor: '#ffffff' },
    bodyStyle: { bgColor: '#f0f9ff', bgOverlay: '', bgOpacity: 0, usePhoto: false,
      headlineFont: 'Pretendard', headlineSize: 36, headlineColor: '#0c4a6e', headlineAlign: 'left', headlineY: 8,
      bodyFont: 'Pretendard', bodySize: 18, bodyColor: '#0369a1', bodyAlign: 'left', bodyY: 28,
      accentColor: '#0ea5e9' },
    ctaStyle: { bgColor: '#0c4a6e', bgOverlay: 'linear-gradient(to bottom, #0369a1, #0c4a6e)',
      ctaText: '바다로 떠나기', ctaBgColor: '#38bdf8', ctaTextColor: '#0c4a6e' },
  },
  {
    id: 'luxury_gold', name: '럭셔리 골드', description: '블랙 + 골드 악센트 (프리미엄 추천)',
    preview: '블랙 배경 + 골드 포인트',
    coverStyle: { bgColor: '#0a0a0a', bgOverlay: '', bgOpacity: 0,
      headlineFont: 'Pretendard', headlineSize: 48, headlineColor: '#fbbf24', headlineY: 30,
      bodyFont: 'Pretendard', bodySize: 20, bodyColor: '#d4d4d4', bodyY: 62,
      brandBgColor: '#fbbf24', brandTextColor: '#000000' },
    bodyStyle: { bgColor: '#111111', bgOverlay: '', bgOpacity: 0, usePhoto: false,
      headlineFont: 'Pretendard', headlineSize: 36, headlineColor: '#fbbf24', headlineAlign: 'center', headlineY: 12,
      bodyFont: 'Pretendard', bodySize: 18, bodyColor: '#a3a3a3', bodyAlign: 'center', bodyY: 40,
      accentColor: '#fbbf24' },
    ctaStyle: { bgColor: '#0a0a0a', bgOverlay: '',
      ctaText: 'VIP 예약', ctaBgColor: '#fbbf24', ctaTextColor: '#000000' },
  },
  {
    id: 'fresh_green', name: '프레시 그린', description: '자연/에코 톤 (트레킹/자연관광 추천)',
    preview: '초록 + 자연 느낌',
    coverStyle: { bgColor: '#052e16', bgOverlay: 'linear-gradient(to bottom, #14532d, #052e16)', bgOpacity: 85,
      headlineFont: 'Pretendard', headlineSize: 48, headlineColor: '#86efac', headlineY: 28,
      bodyFont: 'Pretendard', bodySize: 20, bodyColor: '#d1fae5', bodyY: 60,
      brandBgColor: '#22c55e', brandTextColor: '#ffffff' },
    bodyStyle: { bgColor: '#f0fdf4', bgOverlay: '', bgOpacity: 0, usePhoto: false,
      headlineFont: 'Pretendard', headlineSize: 34, headlineColor: '#14532d', headlineAlign: 'left', headlineY: 8,
      bodyFont: 'Pretendard', bodySize: 17, bodyColor: '#166534', bodyAlign: 'left', bodyY: 28,
      accentColor: '#22c55e' },
    ctaStyle: { bgColor: '#052e16', bgOverlay: 'linear-gradient(to bottom, #14532d, #052e16)',
      ctaText: '자연으로 떠나기', ctaBgColor: '#22c55e', ctaTextColor: '#ffffff' },
  },
];

// ── 템플릿 기반 슬라이드 생성 ────────────────────────────

export async function generateCardSlides(
  product: ProductData, options: GenerateOptions & { templateId?: TemplateId },
): Promise<Slide[]> {
  const texts = getAngleTexts(product, options.angle, options.slideCount);
  const dest = product.destination || '여행';
  const template = TEMPLATE_PRESETS.find(t => t.id === (options.templateId || 'dark_cinematic')) || TEMPLATE_PRESETS[0];
  const cs = template.coverStyle;
  const bs = template.bodyStyle;
  const ct = template.ctaStyle;

  // Pexels 이미지 (사진 사용하는 템플릿만)
  const needsPhotos = bs.usePhoto || template.id === 'dark_cinematic' || template.id === 'minimal_photo' || template.id === 'magazine';
  const imageKeywords = texts.map((_, i) =>
    i === 0 ? `${dest} travel landscape beautiful` :
    i === texts.length - 1 ? `${dest} vacation sunset` :
    `${dest} tourism ${['sightseeing', 'culture', 'food', 'nature', 'hotel'][i % 5]}`
  );
  const images = needsPhotos
    ? await Promise.all(imageKeywords.map(kw => getPexelsImage(kw)))
    : texts.map(() => '');

  return texts.map((t, i) => {
    const isCover = i === 0;
    const isCta = i === texts.length - 1;
    const style = isCover ? cs : isCta ? { ...bs, headlineSize: cs.headlineSize } : bs;

    // 커버 슬라이드
    if (isCover) {
      return {
        id: uid(),
        bgColor: cs.bgColor,
        bgImage: images[0] || '',
        bgOverlay: cs.bgOverlay,
        bgOpacity: cs.bgOpacity,
        elements: [
          // 브랜드 뱃지
          { id: uid(), type: 'text' as const, text: '여소남', fontFamily: cs.headlineFont,
            fontSize: 14, fontWeight: 'bold' as const, fontStyle: 'normal' as const, textDecoration: 'none' as const,
            color: cs.brandTextColor, textAlign: 'center' as const,
            bgColor: cs.brandBgColor, x: 5, y: 5, width: 15, height: 5 },
          // 헤드라인
          { id: uid(), type: 'text' as const, text: t.headline, fontFamily: cs.headlineFont,
            fontSize: cs.headlineSize, fontWeight: 'bold' as const, fontStyle: 'normal' as const, textDecoration: 'none' as const,
            color: cs.headlineColor, textAlign: 'center' as const,
            x: 5, y: cs.headlineY, width: 90, height: 25 },
          // 본문
          ...(t.body ? [{ id: uid(), type: 'text' as const, text: t.body, fontFamily: cs.bodyFont,
            fontSize: cs.bodySize, fontWeight: 'normal' as const, fontStyle: 'normal' as const, textDecoration: 'none' as const,
            color: cs.bodyColor, textAlign: 'center' as const,
            x: 10, y: cs.bodyY, width: 80, height: 20 }] : []),
        ],
      };
    }

    // CTA 슬라이드
    if (isCta) {
      return {
        id: uid(),
        bgColor: ct.bgColor,
        bgImage: images[i] || '',
        bgOverlay: ct.bgOverlay,
        bgOpacity: cs.bgOpacity,
        elements: [
          { id: uid(), type: 'text' as const, text: t.headline, fontFamily: cs.headlineFont,
            fontSize: 40, fontWeight: 'bold' as const, fontStyle: 'normal' as const, textDecoration: 'none' as const,
            color: '#ffffff', textAlign: 'center' as const,
            x: 5, y: 20, width: 90, height: 20 },
          ...(t.body ? [{ id: uid(), type: 'text' as const, text: t.body, fontFamily: cs.bodyFont,
            fontSize: 20, fontWeight: 'normal' as const, fontStyle: 'normal' as const, textDecoration: 'none' as const,
            color: '#cccccc', textAlign: 'center' as const,
            x: 10, y: 45, width: 80, height: 15 }] : []),
          // CTA 버튼
          { id: uid(), type: 'text' as const, text: ct.ctaText, fontFamily: cs.headlineFont,
            fontSize: 20, fontWeight: 'bold' as const, fontStyle: 'normal' as const, textDecoration: 'none' as const,
            color: ct.ctaTextColor, textAlign: 'center' as const,
            bgColor: ct.ctaBgColor, x: 20, y: 70, width: 60, height: 8 },
          // 브랜드
          { id: uid(), type: 'text' as const, text: 'yeosonam.com', fontFamily: cs.bodyFont,
            fontSize: 14, fontWeight: 'normal' as const, fontStyle: 'normal' as const, textDecoration: 'none' as const,
            color: '#888888', textAlign: 'center' as const,
            x: 25, y: 88, width: 50, height: 5 },
        ],
      };
    }

    // 본문 슬라이드
    return {
      id: uid(),
      bgColor: bs.bgColor,
      bgImage: bs.usePhoto ? (images[i] || '') : '',
      bgOverlay: bs.bgOverlay,
      bgOpacity: bs.bgOpacity,
      elements: [
        // 페이지 인디케이터
        { id: uid(), type: 'text' as const, text: `${i + 1}`, fontFamily: bs.headlineFont,
          fontSize: 14, fontWeight: 'bold' as const, fontStyle: 'normal' as const, textDecoration: 'none' as const,
          color: bs.accentColor, textAlign: 'center' as const,
          bgColor: bs.usePhoto ? 'rgba(0,0,0,0.5)' : undefined,
          x: 85, y: 5, width: 10, height: 5 },
        // 헤드라인
        { id: uid(), type: 'text' as const, text: t.headline, fontFamily: bs.headlineFont,
          fontSize: bs.headlineSize, fontWeight: 'bold' as const, fontStyle: 'normal' as const, textDecoration: 'none' as const,
          color: bs.headlineColor, textAlign: bs.headlineAlign,
          x: 5, y: bs.headlineY, width: 90, height: 20 },
        // 악센트 라인
        { id: uid(), type: 'shape' as const,
          x: bs.headlineAlign === 'left' ? 5 : bs.headlineAlign === 'right' ? 75 : 40,
          y: bs.headlineY + 22,
          width: 20, height: 0.5,
          bgColor: bs.accentColor, text: '', fontFamily: '', fontSize: 0, fontWeight: 'normal' as const,
          fontStyle: 'normal' as const, textDecoration: 'none' as const, color: '', textAlign: 'left' as const },
        // 본문
        ...(t.body ? [{ id: uid(), type: 'text' as const, text: t.body, fontFamily: bs.bodyFont,
          fontSize: bs.bodySize, fontWeight: 'normal' as const, fontStyle: 'normal' as const, textDecoration: 'none' as const,
          color: bs.bodyColor, textAlign: bs.bodyAlign,
          x: 5, y: bs.bodyY, width: 90, height: 35 }] : []),
      ],
    };
  });
}

// ── 블로그 생성 (정규식 기반, AI 대체 가능) ──────────────

/**
 * 블로그 본문 생성 (관광지 DB 자동 결합 + H2/H3 구조 + FAQ)
 * @param attractions - 해당 목적지의 관광지 데이터 (사진/설명 자동 삽입)
 */
export function generateBlogPost(
  product: ProductData,
  angle: AngleType,
  attractions?: { name: string; short_desc?: string | null; photos?: { src_medium: string }[]; badge_type?: string | null; aliases?: string[] | null }[],
): string {
  const dest = product.destination || '여행지';
  const nights = product.nights ?? (product.duration ? product.duration - 1 : 0);
  const dur = product.duration ? `${nights}박${product.duration}일` : '';
  const price = getLowestPrice(product);
  const priceStr = price > 0 ? `${price.toLocaleString()}원` : '';
  const inclusions = product.inclusions || [];
  const itinerary = product.itinerary || [];
  const highlights = product.product_highlights || [];
  const angleLabel = ANGLE_PRESETS[angle].label;

  const sections: string[] = [];

  // ── H1 (후킹형 — seo_title과 구분되어 키워드 스터핑 방지, 친근한 존댓말) ────────
  const h1Options: Record<AngleType, string> = {
    value: `${dest} ${dur} ${priceStr || '이 가격'}, 이게 말이 되나 싶으시죠?`,
    emotional: `${dest} ${dur}, 잠깐 일상을 내려놓고 싶으실 때`,
    filial: `부모님과 가는 ${dest} ${dur}, 동선부터 편하게`,
    luxury: `${dest} ${dur} 프리미엄, 어디서 갈리는 걸까요?`,
    urgency: `${dest} ${dur} 특가, 지금 이 가격이 말이 되는 이유`,
    activity: `${dest} ${dur} 액티비티, 몸에 맞는 일정 고르는 법`,
    food: `${dest} ${dur} 먹는 여행, 뭐부터 잡으면 좋을까요?`,
  };
  sections.push(`# ${h1Options[angle] || `${dest} ${dur} ${angleLabel} 여행`}`);

  // ── TL;DR (핵심 요약 — GEO 인용률 상승 패턴) ────────
  const tldrLines: string[] = [];
  if (dest && dur) tldrLines.push(`- ${dest} ${dur} ${angleLabel} 여행 (여소남 엄선)`);
  if (priceStr) tldrLines.push(`- 출발가 ${priceStr}~ (숨은 비용 없음)`);
  if (product.airline) tldrLines.push(`- ${product.airline} 이용 · ${product.departure_airport ?? ''} 출발`.trim());
  if (highlights.length > 0) {
    const top = highlights[0].replace(/\*\*/g, '').slice(0, 60);
    if (top) tldrLines.push(`- 핵심 포인트: ${top}`);
  }
  if (tldrLines.length >= 2) {
    sections.push(`\n## 핵심 요약`);
    sections.push(tldrLines.join('\n'));
  }

  // ── 여행 개요 ──────────────────────────────────────────
  const overview = [`\n## 여행 개요`, `- **목적지:** ${dest}`, `- **기간:** ${dur}`];
  if (priceStr) overview.push(`- **가격:** ${priceStr}~`);
  if (product.airline) overview.push(`- **항공:** ${product.airline}`);
  if (product.departure_airport) overview.push(`- **출발:** ${product.departure_airport}`);
  sections.push(overview.join('\n'));

  // ── 핵심 하이라이트 ─────────────────────────────────────
  if (highlights.length > 0) {
    sections.push(`\n## 이 상품의 핵심 포인트`);
    sections.push(highlights.slice(0, 5).map(h => `- ${h}`).join('\n'));
  }

  // ── 일정 하이라이트 (관광지 DB 자동 결합) ──────────────
  if (itinerary.length > 0 || attractions?.length) {
    sections.push(`\n## 일정 하이라이트`);

    // 일정에서 관광지를 매칭하여 사진/설명 삽입
    // 팩트 보호: 관광지 이름 or 별칭이 일정에 완전히 포함된 경우만 인정 (지역명만 일치하는 유사매칭 제외)
    const matchedSpots: { name: string; desc: string; photo?: string }[] = [];
    if (attractions?.length && itinerary.length > 0) {
      for (const item of itinerary) {
        const attr = matchAttr(item, attractions as any, product.destination);
        if (!attr) continue;

        const itemNoSpace = item.replace(/\s+/g, '').toLowerCase();
        const nameNoSpace = attr.name.replace(/\s+/g, '').toLowerCase();
        const hasFullMatch =
          itemNoSpace.includes(nameNoSpace) ||
          (attr.aliases?.some(al =>
            al.length >= 2 && itemNoSpace.includes(al.replace(/\s+/g, '').toLowerCase())
          ) ?? false);
        if (!hasFullMatch) continue;

        if (!matchedSpots.find(s => s.name === attr.name)) {
          // short_desc에서 가격 정보 제거 ("$30 | 야경 유람선" → "야경 유람선")
          const cleanDesc = (attr.short_desc || '')
            .replace(/\$\s*\d+[^\s|]*/g, '')      // $30, $30~ 등
            .replace(/USD\s*\d+/gi, '')            // USD 30
            .replace(/\d+,?\d*\s*원/g, '')         // 30,000원, 3만원
            .replace(/\d+만\s*원?/g, '')           // 3만, 3만원
            .replace(/^\s*[|\-–—]\s*/, '')         // 앞의 구분자 제거
            .replace(/\s*[|]\s*$/, '')             // 뒤의 구분자
            .replace(/\s*[|]\s*/g, ' ')            // 중간 파이프 → 공백
            .replace(/\s+/g, ' ')                  // 연속 공백 정리
            .trim();

          matchedSpots.push({
            name: attr.name,
            desc: cleanDesc,
            photo: attr.photos?.[0]?.src_medium,
          });
        }
        if (matchedSpots.length >= 5) break;
      }
    }

    if (matchedSpots.length > 0) {
      for (const spot of matchedSpots) {
        sections.push(`\n### ${spot.name}`);
        // alt 형식: "${destination} ${관광지명}" — 이미지 로드 실패 시에도 맥락 유지
        if (spot.photo) sections.push(`![${dest} ${spot.name}](${spot.photo})`);
        if (spot.desc) sections.push(spot.desc);
      }
    } else {
      sections.push(itinerary.slice(0, 8).map(i => `- ${i}`).join('\n'));
    }
  }

  // ── 포함사항 ──────────────────────────────────────────
  if (inclusions.length > 0) {
    sections.push(`\n## 포함사항`);
    sections.push(inclusions.map(i => `- ${i}`).join('\n'));
  }

  // ── 선택관광 ──────────────────────────────────────────
  if (product.optional_tours?.length) {
    sections.push(`\n## 선택관광`);
    sections.push(product.optional_tours.slice(0, 5).map(t =>
      `- **${t.name}**${t.price_usd ? ` (USD ${t.price_usd})` : ''}`
    ).join('\n'));
  }

  // ── FAQ (FAQPage JSON-LD 자동 추출 + 롱테일 검색 유입) ──────────────
  // 1) notices_parsed 우선, 2) 없으면 상품 스펙 기반 기본 FAQ 3종 생성
  const notices = (product as any).notices_parsed;
  const faqItems: { title: string; text: string }[] = [];

  if (Array.isArray(notices) && notices.length > 0) {
    const parsed = notices
      .filter((n: any) => typeof n === 'object' && n !== null && 'title' in n && 'text' in n)
      .slice(0, 4);
    faqItems.push(...parsed);
  }

  // 기본 FAQ — notices 부족 시 채움 (최소 3개 보장)
  if (faqItems.length < 3) {
    const defaults: { title: string; text: string }[] = [];
    if (product.departure_airport && product.airline) {
      defaults.push({
        title: `${product.departure_airport.replace(/\(.*?\)/g, '').trim()} 출발 공항 수속은 몇 시간 전에 가야 하나요?`,
        text: `국제선이라 출발 2시간 30분 전 공항 도착을 권장합니다. ${product.airline} 카운터 위치는 출국장 전광판에서 확인하실 수 있고, 여소남 예약 확정서에도 표기해 드립니다.`,
      });
    }
    if (dest) {
      defaults.push({
        title: `${dest} 여행에 비자가 필요한가요?`,
        text: `여소남은 예약 확정 시 해당 국가 비자 정책과 유효기간(보통 여권 잔여 6개월 이상)을 안내해 드립니다. 단수/복수, 도착비자 여부는 변동될 수 있어 출발 전 재확인이 원칙입니다.`,
      });
    }
    if (priceStr) {
      defaults.push({
        title: `${priceStr}~ 금액에 모든 비용이 포함되나요?`,
        text: `항공·숙박·현지 이동·일정표상 식사·기사 가이드 경비 등 명시된 포함 항목은 모두 포함된 가격입니다. 선택관광·일부 개인 경비·환율 변동에 따른 유류할증료 조정분은 별도이며, 예약 시 구체 내역을 확인하실 수 있습니다.`,
      });
    }
    defaults.push({
      title: `현지 사정으로 일정이 변경될 수 있나요?`,
      text: `기상·항공 스케줄·현지 운영 사정에 따라 순서 조정이 있을 수 있으며, 동급 대체 일정으로 진행됩니다. 여소남 OP(운영팀)가 출발 전 최종 일정을 재확인해 드립니다.`,
    });

    for (const d of defaults) {
      if (faqItems.length >= 5) break;
      if (!faqItems.some((f) => f.title === d.title)) faqItems.push(d);
    }
  }

  if (faqItems.length > 0) {
    sections.push(`\n## 자주 묻는 질문`);
    for (const faq of faqItems) {
      // FAQPage JSON-LD 자동 추출 패턴: **Q. 질문**\n\nA. 답변
      sections.push(`\n**Q. ${faq.title}**\n\nA. ${faq.text}`);
    }
  }

  // ── CTA (친근한 존댓말, 상품 상세 페이지 연결) ────────────────
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
  const productUrl = product.id ? `${baseUrl}/packages/${product.id}` : baseUrl;
  sections.push(`\n## [지금 상품 살펴보기]`);
  sections.push(
    `여소남에서 ${dest} ${angleLabel} 여행 중 가치 있는 상품만 골라 두었어요.\n` +
      `일정이 몸에 맞는지 일정표만 한 번 훑어 주세요. 고민되시면 카카오톡 상담으로 편하게 물어보셔도 돼요.\n\n` +
      `**[👉 ${dest} ${dur} ${angleLabel} 상품 상세 보기](${productUrl})**`,
  );

  return sections.join('\n');
}

// ── 블로그 SEO 메타 자동 생성 ─────────────────────────────

// 주요 목적지 한글 → 영문 로마자 매핑 (SEO 친화적 slug용)
const DEST_ROMAN: Record<string, string> = {
  '다낭': 'danang', '호이안': 'hoian', '나트랑': 'nhatrang', '달랏': 'dalat',
  '판랑': 'phanrang', '하노이': 'hanoi', '호치민': 'hcmc', '푸꾸옥': 'phuquoc',
  '방콕': 'bangkok', '푸켓': 'phuket', '치앙마이': 'chiangmai', '파타야': 'pattaya',
  '발리': 'bali', '자카르타': 'jakarta',
  '마닐라': 'manila', '세부': 'cebu', '보라카이': 'boracay',
  '비엔티엔': 'vientiane', '루앙프라방': 'luangprabang', '방비엥': 'vangvieng',
  '장가계': 'zhangjiajie', '상해': 'shanghai', '북경': 'beijing', '서안': 'xian', '청도': 'qingdao', '석가장': 'shijiazhuang',
  '울란바토르': 'ulaanbaatar', '테를지': 'terelj', '엘승타사르하이': 'elsentasarhai',
  '시모노세키': 'shimonoseki', '후쿠오카': 'fukuoka', '벳부': 'beppu', '유후인': 'yufuin',
};

function romanizeDestination(dest: string): string {
  const parts = dest.split(/[\/\s]+/).filter(Boolean);
  const romanParts = parts.map(p => DEST_ROMAN[p] || null).filter(Boolean);
  if (romanParts.length > 0) return romanParts.join('-');
  // 매핑 실패 시 알파벳/숫자만 유지 (한글 제거)
  return dest.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

const ANGLE_SLUG: Record<AngleType, string> = {
  value: 'value', emotional: 'healing', filial: 'filial',
  luxury: 'luxury', urgency: 'deal', activity: 'activity', food: 'food',
};

export interface BlogSeo {
  slug: string;
  seoTitle: string;
  seoDescription: string;
}

/**
 * 블로그 SEO 메타데이터 자동 생성
 * VA는 이 결과를 수정만 하면 됨 (수동 입력 불필요)
 */
export function generateBlogSeo(
  product: ProductData,
  angle: AngleType,
): BlogSeo {
  const dest = product.destination || '여행';
  const nights = product.nights ?? (product.duration ? product.duration - 1 : 0);
  const dur = product.duration ? `${nights}박${product.duration}일` : '';
  const angleLabel = ANGLE_PRESETS[angle].label;
  const price = getLowestPrice(product);
  const priceStr = price > 0 ? `${price.toLocaleString()}원` : '';
  const year = new Date().getFullYear();

  // slug: destination(영문)-박수일수-angle (SEO 친화적: URL 공유 안전)
  const destRoman = romanizeDestination(dest);
  const durPart = product.duration ? `${nights}n${product.duration}d` : '';
  const slugParts = [destRoman, durPart, ANGLE_SLUG[angle]];
  const slug = slugParts.filter(Boolean).join('-');

  // SEO 제목 최적화
  // 루트 layout(src/app/layout.tsx)의 metadata template이 " | 여소남"을 자동으로 붙이므로
  // seoTitle에는 브랜드/접미사를 넣지 않는다 (이전 형식 " | 여소남 2026"은 이중 표기 유발).
  // 패턴: [출발지]출발 [목적지] [기간] [앵글] 패키지 [가격]~ ([년도])
  const departure = (product as any).departure_airport as string | undefined;
  const depPrefix = departure ? `${departure.replace(/\(.*?\)/g, '').trim()}출발 ` : '';
  const priceShort = price > 0 ? ` ${Math.round(price / 10000)}만원~` : '';
  const destClean = dest.replace(/\s+/g, ' ').trim();
  // 55자 이내 (brand 접미사 " | 여소남" 약 6자 여유)
  const MAX = 55;
  let title = `${depPrefix}${destClean} ${dur} ${angleLabel} 패키지${priceShort} (${year})`;
  if (title.length > MAX) {
    title = `${depPrefix}${destClean} ${dur} ${angleLabel} 패키지${priceShort}`;
  }
  if (title.length > MAX) {
    title = `${destClean} ${dur} ${angleLabel} 패키지${priceShort}`;
  }
  if (title.length > MAX) {
    title = `${destClean} ${dur} ${angleLabel} 패키지 추천`;
  }
  const seoTitle = title.substring(0, MAX);

  // SEO 설명: 160자 이내 (highlights + 가격 + inclusions 핵심)
  // 목적지+기간 중복 제거 (이미 앞 descParts에 들어감)
  const stripDupKeywords = (text: string) => text
    .replace(new RegExp(dest.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'g'), '')
    .replace(new RegExp(dur.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'g'), '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,·.]+|[\s,·.]+$/g, '')
    .trim();

  const highlightsRaw = (product.product_highlights || []).slice(0, 2)
    .map(stripDupKeywords)
    .filter(h => h.length > 2)
    .join(', ');
  const inclKey = (product.inclusions || []).slice(0, 2).join(', ');
  const descParts = [
    `${dest} ${dur} ${angleLabel} 패키지`,
    priceStr ? `${priceStr}~` : '',
    highlightsRaw || inclKey,
    '여소남에서 비교하고 안심 예약하세요.',
  ].filter(Boolean);
  const seoDescription = descParts.join('. ').substring(0, 160);

  return { slug, seoTitle, seoDescription };
}

// ── 검색광고 카피 생성 ───────────────────────────────────

export function generateAdCopy(product: ProductData, angle: AngleType): { headlines: string[]; descriptions: string[] } {
  const dest = product.destination || '여행';
  const dur = product.duration ? `${product.duration}일` : '';
  const price = getLowestPrice(product);
  const priceStr = price > 0 ? `${price.toLocaleString()}원~` : '';

  const headlines = {
    value: [`${dest} ${dur} ${priceStr}`, `${dest} 가성비 패키지`, `${dest} 올인클루시브`],
    emotional: [`${dest} 감성 여행`, `${dest}에서 만나는 힐링`, `${dest} 특별한 순간`],
    filial: [`부모님 ${dest} 효도여행`, `${dest} 안심 패키지`, `노팁 ${dest} 여행`],
    luxury: [`${dest} 5성급 프리미엄`, `${dest} 럭셔리 투어`, `${dest} VIP 패키지`],
    urgency: [`${dest} 마감임박 특가`, `${dest} 잔여석 한정`, `${dest} 땡처리 ${priceStr}`],
    activity: [`${dest} 액티비티 투어`, `${dest} 체험 여행`, `${dest} 관광 패키지`],
    food: [`${dest} 미식 여행`, `${dest} 맛집 투어`, `${dest} 특식 패키지`],
  };

  const descriptions = {
    value: [`${dest} ${dur} 항공+호텔+관광 포함 ${priceStr} 여소남`, `가성비 최고 ${dest} 패키지. 전일정 포함.`],
    emotional: [`${dest}의 아름다운 풍경과 함께하는 ${dur} 여행. 여소남과 함께.`, `잊을 수 없는 순간, ${dest} 감성 여행.`],
    filial: [`부모님 첫 해외여행도 안심. ${dest} 노팁 패키지 ${priceStr}`, `효도여행 전문 여소남. ${dest} ${dur}.`],
    luxury: [`5성급 호텔 + 프리미엄 서비스. ${dest} ${dur} ${priceStr}`, `나를 위한 럭셔리, ${dest} VIP 투어.`],
    urgency: [`마감임박! ${dest} ${dur} ${priceStr} 잔여석 확인. 여소남`, `놓치면 후회! ${dest} 특가 선착순.`],
    activity: [`${dest} 핵심 관광지 완전 정복. ${dur} 체험 여행 ${priceStr}`, `액티비티 가득한 ${dest} 투어.`],
    food: [`${dest} 현지 특식 포함 미식 여행. ${dur} ${priceStr}`, `매일 새로운 맛, ${dest} 미식 투어.`],
  };

  return { headlines: headlines[angle], descriptions: descriptions[angle] };
}

// ── 추적 ID 생성 (외부 사용) ─────────────────────────────

export { generateTrackingId };
