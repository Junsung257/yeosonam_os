/**
 * itinerary-render.ts — A4 포스터 + 모바일 랜딩 공통 렌더링 계약
 *
 * 목적:
 * - A4(`YeosonamA4Template`)와 모바일(`DetailClient`)이 동일 데이터를
 *   서로 다르게 해석하여 발생하는 불일치(ERR 패턴 A) 구조적 차단.
 * - 렌더러가 "pkg 필드를 직접 해석"하는 대신, 이 모듈의 helper/어댑터만 소비.
 *
 * 범위:
 * - 점진적 도입: 현재는 optional_tours 정규화 + 헤더 메타 추출만 공유.
 * - 추후 일정 타임라인/미매칭 매칭 결과도 이 파일로 이관 예정.
 */

// ── optional_tours.region 정규화 ─────────────────────────────────────────────

/**
 * 국가/지역 키워드 매핑 — 선택관광 이름에서 자동 추출할 때 사용
 * (단, 등록 시 region 필드를 직접 채우는 것이 우선)
 */
const REGION_ALIAS: Record<string, string> = {
  '말레이시아': '말레이시아',
  '쿠알라': '말레이시아',
  '말라카': '말레이시아',
  '겐팅': '말레이시아',
  '싱가포르': '싱가포르',
  '태국': '태국',
  '방콕': '태국',
  '파타야': '태국',
  '푸켓': '태국',
  '베트남': '베트남',
  '다낭': '베트남',
  '하노이': '베트남',
  '나트랑': '베트남',
  '대만': '대만',
  '타이페이': '대만',
  '타이베이': '대만',
  '일본': '일본',
  '후쿠오카': '일본',
  '오사카': '일본',
  '홋카이도': '일본',
  '중국': '중국',
  '서안': '중국',
  '북경': '중국',
  '상해': '중국',
  '장가계': '중국',
  '칭다오': '중국',
  '라오스': '라오스',
  '몽골': '몽골',
  '필리핀': '필리핀',
  '보홀': '필리핀',
  '세부': '필리핀',
  '인도네시아': '인도네시아',
  '발리': '인도네시아',
};

export interface OptionalTourInput {
  name: string;
  region?: string | null;
  price?: string | null;
  price_usd?: number | null;
  price_krw?: number | null;
  note?: string | null;
}

export interface NormalizedOptionalTour {
  name: string;             // 괄호/region 제거된 순수 이름
  region: string | null;    // "싱가포르" | "말레이시아" | ...
  displayName: string;      // "2층버스 (싱가포르)" — 렌더러가 바로 표시
  price: string | null;     // "$45/인" — 형식 통일
  note: string | null;
}

/**
 * 이름에서 region 추출 (등록 시 region 필드 미설정 대비 폴백)
 * 우선순위: 명시 region > 이름 괄호 내 region 키워드 > 이름 본문 region 키워드
 */
function inferRegion(name: string, explicit?: string | null): string | null {
  if (explicit && explicit.trim()) return explicit.trim();
  // 괄호 내 region 키워드 탐색: "2층버스 (싱가포르)"
  const parenMatch = name.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const inside = parenMatch[1];
    for (const [keyword, region] of Object.entries(REGION_ALIAS)) {
      if (inside.includes(keyword)) return region;
    }
  }
  // 본문 내 region 키워드 탐색: "쿠알라 야경투어"
  for (const [keyword, region] of Object.entries(REGION_ALIAS)) {
    if (name.includes(keyword)) return region;
  }
  return null;
}

/**
 * 이름 본문에서 괄호 제거 + 중복 region 제거 (displayName 재조립용)
 * 예: "2층버스 (싱가포르)" + region="싱가포르" → base "2층버스"
 */
function stripRegionFromName(name: string): string {
  // 뒤쪽 괄호가 region 키워드면 제거
  const parenMatch = name.match(/\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const inside = parenMatch[1];
    const hasRegionKw = Object.keys(REGION_ALIAS).some(kw => inside.includes(kw));
    if (hasRegionKw) return name.replace(/\s*\([^)]+\)\s*$/, '').trim();
  }
  return name.trim();
}

/**
 * 가격 필드 통일 — price(string) / price_usd(number) / price_krw(number) 혼재 허용
 * 반환 형식: "$45/인" | "45,000원" | null
 */
function formatTourPrice(tour: OptionalTourInput): string | null {
  if (tour.price && String(tour.price).trim()) return String(tour.price).trim();
  if (typeof tour.price_usd === 'number' && tour.price_usd > 0) return `$${tour.price_usd}/인`;
  if (typeof tour.price_krw === 'number' && tour.price_krw > 0) return `${tour.price_krw.toLocaleString()}원`;
  return null;
}

/**
 * 선택관광 단일 항목 정규화
 * A4와 모바일이 동일한 정규화 결과를 받도록 보장 (ERR-KUL-04: 라벨 일관성)
 */
export function normalizeOptionalTour(tour: OptionalTourInput): NormalizedOptionalTour {
  const region = inferRegion(tour.name || '', tour.region);
  const baseName = stripRegionFromName(tour.name || '');
  const displayName = region ? `${baseName} (${region})` : baseName;
  return {
    name: baseName,
    region,
    displayName,
    price: formatTourPrice(tour),
    note: tour.note?.trim() || null,
  };
}

/**
 * 편의 함수: 선택관광 이름 단일 라벨 생성 (렌더러에서 직접 호출)
 * A4/모바일 둘 다 `normalizeOptionalTourName(tour)` 만 사용하면 라벨 일관성 보장됨.
 */
export function normalizeOptionalTourName(tour: OptionalTourInput): string {
  return normalizeOptionalTour(tour).displayName;
}

/**
 * 선택관광 배열을 region별 그룹으로 묶기 (A4 섹션 렌더용)
 */
export interface OptionalTourGroup {
  region: string;           // "말레이시아" | "싱가포르" | "기타"
  tours: NormalizedOptionalTour[];
}

export function groupOptionalToursByRegion(tours: OptionalTourInput[]): OptionalTourGroup[] {
  const normalized = tours.map(normalizeOptionalTour);
  const groups = new Map<string, NormalizedOptionalTour[]>();
  for (const t of normalized) {
    const key = t.region || '기타';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  return Array.from(groups.entries()).map(([region, tours]) => ({ region, tours }));
}

// ── 유의사항 병합: 특약 ↔ 표준약관 충돌 방지 ─────────────────────────────
// Why: notices_parsed(상품 고유 특약)와 하드코딩 표준약관이 동시에 렌더되면
//      "14~7일 50% 공제(특약)" vs "30일 전 전액 환불(표준)" 같은 모순이 발생해
//      법적 분쟁 리스크. 특약이 있을 땐 표준약관의 '예약 및 취소 규정' 블록만 제외.
// How to apply: 모바일 DetailClient / A4 / 이메일 템플릿 전부 이 함수로 통일.

export interface NoticeBlock {
  type: string;
  title: string;
  text: string;
}

export function hasSpecialCancelPolicy(notices: readonly NoticeBlock[] | null | undefined): boolean {
  if (!notices || notices.length === 0) return false;
  return notices.some(n => {
    if (!n || typeof n !== 'object') return false;
    if (n.type === 'PAYMENT') return true;
    const combined = `${n.title || ''} ${n.text || ''}`;
    return /특별약관|특약|특별\s*규정/.test(combined);
  });
}

/**
 * 상품의 notices_parsed와 표준약관 템플릿을 안전하게 병합.
 * 특약(type=PAYMENT 또는 "특별약관" 문구)이 있으면 표준약관의
 * '예약 및 취소 규정'(type=RESERVATION) 블록을 자동 제외.
 */
export function mergeNotices(
  notices: readonly NoticeBlock[] | null | undefined,
  template: readonly NoticeBlock[],
): NoticeBlock[] {
  const typed = (notices || []).filter(
    (n): n is NoticeBlock =>
      !!n && typeof n === 'object' && typeof (n as NoticeBlock).type === 'string'
  );
  const hasSpecial = hasSpecialCancelPolicy(typed);
  const filteredTemplate = hasSpecial
    ? template.filter(t => t.type !== 'RESERVATION')
    : [...template];
  return [...typed, ...filteredTemplate];
}
