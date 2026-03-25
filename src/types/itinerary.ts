// ─── 여소남 OS: 고객용 표준 여행 일정표 스키마 ─────────────────────────────
// 목적: PDF 1개 → price_tiers(요금표) + itinerary_data(일정표) → A4 JPG 자동 생성
// 원칙: 포함/불포함/RMK 원문 그대로 보존 (분쟁 방지), 원가 정보 완전 제거

export interface TravelItinerary {
  meta:           ItineraryMeta;
  highlights:     ItineraryHighlights;  // 포함/불포함/쇼핑/RMK — 상단 배치
  days:           DaySchedule[];
  optional_tours: OptionalTour[];       // 선택관광 전체 목록 (하단)
}

// ── 1. 헤더 정보 ───────────────────────────────────────────────────────────
export interface ItineraryMeta {
  title:              string;        // "노팁 노옵션 장가계 3박4일"
  product_type:       string | null; // "실속" | "품격" | "노팁노옵션"
  destination:        string;        // "장가계"
  nights:             number;        // 3
  days:               number;        // 4
  departure_airport:  string | null; // "부산(김해)"
  airline:            string | null; // "에어부산"
  flight_out:         string | null; // "BX371" (출발 항공편)
  flight_in:          string | null; // "BX372" (귀국 항공편)
  departure_days:     string | null; // "매주 월/화/수/목/금/토/일"
  min_participants:   number;        // 4
  room_type:          string | null; // "2인 1실"
  ticketing_deadline: string | null; // "3/27(금)까지" 원문 그대로
  hashtags:           string[];      // ["#질성산", "#리무진차량", "#매일특식"]
  brand:              '여소남';
}

// ── 2. 포함/불포함/쇼핑/RMK (원문 보존 — 절대 편집 금지) ─────────────────
export interface ItineraryHighlights {
  inclusions: string[];      // 포함내역 전부 원문
  excludes:   string[];      // 불포함내역 전부 원문 (금액 포함)
  shopping:   string | null; // 쇼핑 원문 "3회(+농산물)"
  remarks:    string[];      // RMK/비고 전체 원문 (랜드사 원문 절대 편집 금지)
}

// ── 3. 일차별 일정 ─────────────────────────────────────────────────────────
export interface DaySchedule {
  day:      number;      // 1, 2, 3, 4
  regions:  string[];    // ["부산", "장가계"] — 하루 다지역 대응
  meals:    MealInfo;
  schedule: ScheduleItem[];
  hotel:    HotelInfo | null;
}

export interface MealInfo {
  breakfast: boolean; // 조식
  lunch:     boolean; // 중식
  dinner:    boolean; // 석식
  // 특별 식사 메모 (예: "원탁요리", "비빔밥")
  breakfast_note: string | null;
  lunch_note:     string | null;
  dinner_note:    string | null;
}

export interface HotelInfo {
  name:  string;        // "장가계 국제호텔"
  grade: string | null; // "4성" | "준5성"
  note:  string | null; // "또는 동급"
}

export interface ScheduleItem {
  time:      string | null;   // "09:00"
  activity:  string;          // 원문 그대로
  transport: string | null;   // "BX371" | "전용차량" | "C92(예정)"
  note:      string | null;   // 부연 설명
  type:      ScheduleItemType;
}

export type ScheduleItemType =
  | 'normal'    // 일반 관광/이동
  | 'optional'  // 선택관광 (별도 요금)
  | 'shopping'  // 쇼핑센터
  | 'flight'    // 항공 이동
  | 'train'     // 기차/고속철
  | 'meal'      // 특별 식사 강조
  | 'hotel';    // 체크인/아웃

// ── 4. 선택관광 목록 ───────────────────────────────────────────────────────
export interface OptionalTour {
  name:      string;
  price_usd: number | null;
  price_krw: number | null;
  note:      string | null; // "팁별도", "소아제외"
}

// ── 렌더링 파라미터 (API 호출 시 사용) ────────────────────────────────────
export type ItineraryMode = 'summary' | 'detail';

export interface ScreenshotRequest {
  mode:          ItineraryMode;
  departureDate?: string;  // "2026-04-05" — 지정 시 해당 날짜/가격 채움
}

export interface ScreenshotResponse {
  jpgs: string[];  // summary: 1장, detail: 2장 [priceJpg, itineraryJpg]
}

// ── 렌더링 시 날짜 주입 결과 ───────────────────────────────────────────────
// price_tiers(기존)와 itinerary_data(신규)를 합쳐서 생성
export interface ResolvedItinerary extends TravelItinerary {
  // 날짜 지정 시 추가되는 필드
  departureDate?:    string;  // "2026-04-05"
  confirmedPrice?:   number;  // 해당 날짜 price_tiers adult_price
  // 각 day에 실제 날짜가 계산되어 주입됨
}
