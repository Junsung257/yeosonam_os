/**
 * @file section-aware-parser.ts — 원문 섹션 추적 + 컨텍스트 기반 분류 (2026-05-14 박제, 사장님 비전 V5)
 *
 * 핵심 통찰 (사장님):
 *   같은 "다낭 전신마사지 120분" 이라도 어느 섹션에 등장했는지가 분류 SSOT.
 *     ▶포함 사항: → category=inclusion
 *     ▶특전:     → category=perk
 *     ▶선택관광: → category=optional
 *     일정 day 안: → category=schedule_activity
 *     불포함:    → category=exclude
 *
 * LLM 분류 ≠ context 분류. 원문 위치가 진짜 정답.
 */

export type ItemCategory =
  | 'perk'           // 특전 (스페셜 보너스)
  | 'inclusion'      // 포함 사항 (기본)
  | 'optional'       // 선택관광 (옵션)
  | 'exclude'        // 불포함
  | 'surcharge'      // 추가요금/할증
  | 'remark'         // 비고/안내
  | 'schedule'       // 일정 활동
  | 'shopping'       // 쇼핑
  | 'unknown';

export interface SectionMarker {
  category: ItemCategory;
  /** 원문 시작 offset (char) */
  start: number;
  /** 원문 끝 offset (char, 다음 섹션 시작 직전) */
  end: number;
  /** 매칭된 헤더 라인 (예: "▶ 포함 사항") */
  header: string;
}

export interface ClassifiedItem {
  text: string;
  category: ItemCategory;
  /** 원문 어느 라인에서 추출됐는지 (0-indexed) */
  source_line: number;
  /** 원문 character offset */
  source_offset: number;
}

/**
 * 섹션 헤더 패턴 — 한국 여행사 카탈로그 표준.
 * 우선순위 순으로 매칭 (긴 명시 → 짧은 일반어).
 */
const SECTION_PATTERNS: Array<{ re: RegExp; category: ItemCategory; minPriority: number }> = [
  // 특전 (가장 명시적, 가장 우선)
  { re: /^[\s　]*[▶●•·]?\s*(?:✨\s*)?(?:특\s*전|VIP\s*혜택|보너스|스페셜)[\s:：]?\s*$/m, category: 'perk', minPriority: 100 },
  // 선택관광 (옵션투어)
  { re: /^[\s　]*[▶●•·]?\s*(선\s*택\s*관\s*광|옵\s*션\s*투\s*어|선\s*택\s*투\s*어|optional\s*tour)[\s:：]?\s*$/im, category: 'optional', minPriority: 95 },
  // 포함 사항
  { re: /^[\s　]*[▶●•·]?\s*(?:✅\s*)?(포\s*함\s*사\s*항|기\s*본\s*포\s*함|inclusion[s]?|포\s*함)[\s:：]?\s*$/im, category: 'inclusion', minPriority: 90 },
  // 불포함
  { re: /^[\s　]*[▶●•·]?\s*(?:❌\s*)?(불\s*포\s*함\s*사\s*항|불\s*포\s*함|미\s*포\s*함|exclude[ds]?)[\s:：]?\s*$/im, category: 'exclude', minPriority: 85 },
  // 추가요금/할증
  { re: /^[\s　]*[▶●•·]?\s*(?:💲\s*)?(추\s*가\s*요\s*금|할\s*증|써\s*차\s*지|surcharge)[\s:：]?\s*$/im, category: 'surcharge', minPriority: 80 },
  // 쇼핑센터
  { re: /^[\s　]*[▶●•·]?\s*(?:🛍️\s*)?(쇼\s*핑\s*센\s*터|쇼\s*핑)[\s:：]?\s*$/im, category: 'shopping', minPriority: 75 },
  // REMARK / 비고 / 특이사항
  { re: /^[\s　]*[▶●•·]?\s*(REMARK|비\s*\s*고|특\s*이\s*사\s*항|주\s*의\s*사\s*항|안\s*내|유\s*의)[\s:：]?\s*$/im, category: 'remark', minPriority: 70 },
];

/** 일정표 헤더 — 별도 처리 (각 day 가 schedule 컨텍스트) */
const ITINERARY_HEADER_RE = /^[\s　]*(?:제\s*)?(\d+)\s*일\s*[차]?[\s:：]?\s*$|^[\s　]*(?:day|DAY)\s*(\d+)\s*[:：]?\s*$/im;

/**
 * 원문을 줄단위로 스캔하며 각 라인의 섹션 컨텍스트 결정.
 *   - 섹션 헤더 만나면 현재 컨텍스트 전환
 *   - 일정 day 헤더 만나면 schedule 컨텍스트
 *   - 그 외 라인은 현재 컨텍스트 유지
 */
export function parseSections(rawText: string): {
  markers: SectionMarker[];
  classifyOffset: (offset: number) => ItemCategory;
} {
  if (!rawText) return { markers: [], classifyOffset: () => 'unknown' };

  const lines = rawText.split(/\r?\n/);
  const markers: SectionMarker[] = [];
  let currentCategory: ItemCategory = 'unknown';
  let currentStart = 0;
  let currentHeader = '';
  let charPos = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let detected: ItemCategory | null = null;
    let header = '';

    // 일정 day 헤더 우선
    if (ITINERARY_HEADER_RE.test(line)) {
      detected = 'schedule';
      header = line.trim();
    } else {
      for (const pattern of SECTION_PATTERNS) {
        if (pattern.re.test(line)) {
          detected = pattern.category;
          header = line.trim();
          break;
        }
      }
    }

    if (detected && detected !== currentCategory) {
      // 이전 섹션 close
      if (currentCategory !== 'unknown') {
        markers.push({
          category: currentCategory,
          start: currentStart,
          end: charPos,
          header: currentHeader,
        });
      }
      currentCategory = detected;
      currentStart = charPos;
      currentHeader = header;
    }

    charPos += line.length + 1; // +1 for \n
  }

  // 마지막 섹션 close
  if (currentCategory !== 'unknown') {
    markers.push({
      category: currentCategory,
      start: currentStart,
      end: rawText.length,
      header: currentHeader,
    });
  }

  // 빠른 lookup 을 위한 offset → category 함수 (binary search)
  const classifyOffset = (offset: number): ItemCategory => {
    for (const m of markers) {
      if (offset >= m.start && offset < m.end) return m.category;
    }
    return 'unknown';
  };

  return { markers, classifyOffset };
}

/**
 * 원문 한 줄(또는 단일 항목)의 분류를 시도.
 * 1. 섹션 컨텍스트 (가장 강한 신호)
 * 2. 키워드 휴리스틱 (fallback)
 */
const PERK_KEYWORDS = /마사지\s*\d+분|업그레이드|VIP|프리미엄|무료|선물|망고도시락|콩카페|위즐|커피핀|특식|와인|쿠킹|사진촬영|케이블카|스피드보트|비경|관람차|스파/i;
const OPTIONAL_KEYWORDS = /선택관광|옵션|optional|2층\s*버스|크루즈\s*\$|\$\d+/i;
const SURCHARGE_KEYWORDS = /추가요금|할증|싱글차지|써차지|박당|인당.*만원|surcharge/i;
const INCLUSION_KEYWORDS = /왕복훼리비|왕복항공|항공료|호텔|차량|버스|가이드|보험|입장료|유류세|부두세|공항이용료|출국세|tax/i;

export function classifyByKeyword(text: string): ItemCategory {
  if (!text) return 'unknown';
  if (PERK_KEYWORDS.test(text)) return 'perk';
  if (OPTIONAL_KEYWORDS.test(text)) return 'optional';
  if (SURCHARGE_KEYWORDS.test(text)) return 'surcharge';
  if (INCLUSION_KEYWORDS.test(text)) return 'inclusion';
  return 'unknown';
}

/**
 * 컨텍스트 + 키워드 양쪽으로 분류. context 가 unknown 이거나 약한 신호일 때만 keyword 사용.
 * context > keyword 우선 — 사장님 비전 SSOT.
 */
export function classifyItem(text: string, contextCategory: ItemCategory): {
  category: ItemCategory;
  confidence: number;
  reason: string;
} {
  // 1) context 가 명확하면 그대로
  if (contextCategory !== 'unknown' && contextCategory !== 'schedule') {
    return { category: contextCategory, confidence: 0.95, reason: 'section_context' };
  }

  // 2) schedule 컨텍스트면 keyword 로 세분화 (옵션/특전 구분)
  if (contextCategory === 'schedule') {
    const kw = classifyByKeyword(text);
    if (kw === 'optional' || kw === 'perk') {
      return { category: kw, confidence: 0.80, reason: 'schedule_keyword' };
    }
    return { category: 'schedule', confidence: 0.90, reason: 'schedule_default' };
  }

  // 3) unknown 컨텍스트면 keyword fallback
  const kw = classifyByKeyword(text);
  if (kw !== 'unknown') {
    return { category: kw, confidence: 0.65, reason: 'keyword_only' };
  }

  return { category: 'unknown', confidence: 0.0, reason: 'no_signal' };
}
