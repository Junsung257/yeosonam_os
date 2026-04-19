/**
 * @file package-rules.ts
 * @description W13~W19 시맨틱 검증 (raw_text 대조 기반)
 *
 * `db/templates/insert-template.js`의 validatePackage() warnings 중
 * raw_text 대조가 필요한 W13~W19를 TS로 포팅. AI 에이전트 경로
 * (`agent-tools/package-tool.ts`)에서도 동일한 시맨틱 방어를 받기 위함.
 *
 * Zod TravelPackageInsertSchema는 shape/type만 검증 → 이 모듈은
 * 그 위 레이어에서 환각/교차오염을 잡는다.
 */

interface PackageRuleInput {
  raw_text?: string | null;
  min_participants?: number | null;
  notices_parsed?: Array<{ text?: string | null }> | null;
  surcharges?: unknown[] | null;
  departure_days?: string | string[] | null;
  optional_tours?: Array<{ name?: string | null; region?: string | null }> | null;
  itinerary_data?: { days?: Array<{ day?: number; schedule?: Array<{ activity?: string | null }> }> } | null;
  duration?: number | null;
}

const AMBIGUOUS_OT = ['2층버스', '리버보트', '야시장투어', '크루즈', '마사지', '스카이파크', '스카이 파크'];
const OT_REGION_KW = ['말레이시아', '쿠알라', '말라카', '겐팅', '싱가포르', '태국', '방콕', '파타야', '푸켓', '베트남', '다낭', '하노이', '나트랑', '대만', '타이페이', '타이베이', '일본', '후쿠오카', '오사카', '중국', '서안', '라오스', '몽골', '필리핀', '보홀', '세부', '인도네시아', '발리'];
const LANDMARK_WHITELIST = ['메르데카 광장', '바투동굴', '겐팅 하이랜드', '푸트라자야', '보타닉가든', '가든스 바이 더 베이', '야경투어'];

export interface BusinessRuleResult {
  warnings: string[];
}

export function validatePackageBusinessRules(pkg: PackageRuleInput): BusinessRuleResult {
  const warnings: string[] = [];
  const rawText = pkg.raw_text ?? '';

  // W13 — ERR-20260418-01: min_participants 원문 대조
  if (rawText) {
    const m = rawText.match(/(?:최소 출발|성인)\s*(\d+)\s*명\s*이상/);
    if (m) {
      const rawMin = Number(m[1]);
      if (pkg.min_participants != null && pkg.min_participants !== rawMin) {
        warnings.push(`[W13 ERR-20260418-01] min_participants 원문 불일치: 원문 ${rawMin}명 vs 파싱 ${pkg.min_participants}명 — 템플릿 기본값 조작 의심`);
      }
    }
  }

  // W14 — ERR-20260418-02: notices_parsed 축약 감지
  if (rawText && Array.isArray(pkg.notices_parsed)) {
    const bigoMatch = rawText.match(/비\s*고[\s\S]{0,2000}?(?=\n\s*일\s*자|$)/);
    const rawLen = bigoMatch?.[0]?.length ?? 0;
    const parsedLen = pkg.notices_parsed.reduce((s, n) => s + (n.text?.length ?? 0), 0);
    if (rawLen > 100 && parsedLen < rawLen * 0.5) {
      warnings.push(`[W14 ERR-20260418-02] notices_parsed 축약 의심: 원문 비고 ${rawLen}자 vs 파싱 ${parsedLen}자 (${Math.round((parsedLen / rawLen) * 100)}%)`);
    }
  }

  // W15 — ERR-20260418-03: surcharges 기간 누락
  if (rawText) {
    const ranges = rawText.match(/\d+\/\d+\s*[~-]\s*\d+/g) ?? [];
    const surchargeCount = Array.isArray(pkg.surcharges) ? pkg.surcharges.length : 0;
    if (ranges.length >= 2 && surchargeCount < Math.ceil(ranges.length / 2)) {
      warnings.push(`[W15 ERR-20260418-03] surcharges 기간 누락 의심: 원문 날짜범위 ${ranges.length}개 vs 파싱 surcharges ${surchargeCount}개`);
    }
  }

  // W16 — ERR-KUL-01: departure_days JSON 배열 문자열 누출
  if (pkg.departure_days && typeof pkg.departure_days === 'string') {
    const dd = pkg.departure_days.trim();
    if (dd.startsWith('[') && dd.endsWith(']')) {
      warnings.push(`[W16 ERR-KUL-01] departure_days가 JSON 배열 문자열입니다 (${dd}) — 평문("월/수")으로 저장해야 UI에 정상 렌더됩니다.`);
    }
  }

  // W17 — ERR-KUL-04: optional_tours 모호 이름에 region 누락
  if (Array.isArray(pkg.optional_tours)) {
    for (const tour of pkg.optional_tours) {
      const name = tour.name ?? '';
      if (!name) continue;
      const nameHasRegion = OT_REGION_KW.some(kw => name.includes(kw));
      const isAmbiguous = AMBIGUOUS_OT.some(kw => name.includes(kw));
      if (isAmbiguous && !nameHasRegion && !tour.region) {
        warnings.push(`[W17 ERR-KUL-04] optional_tours 모호 이름: "${name}" — region 필드가 없고 이름에도 지역 키워드가 없습니다. A4/모바일 라벨에 "(지역)" 표기가 누락됩니다.`);
      }
    }
  }

  // W18 — ERR-KUL-02/03: DAY 교차 오염 (원문에 없는 랜드마크)
  if (rawText && pkg.itinerary_data?.days) {
    for (const day of pkg.itinerary_data.days) {
      for (const item of day.schedule ?? []) {
        const act = item.activity ?? '';
        for (const landmark of LANDMARK_WHITELIST) {
          if (act.includes(landmark) && !rawText.includes(landmark)) {
            warnings.push(`[W18 ERR-KUL-02] DAY${day.day} "${landmark}" — 원문에 없는 랜드마크가 일정에 삽입됨 (다른 상품에서 복사된 교차 오염 의심).`);
          }
        }
      }
    }
  }

  // W19 — duration ↔ itinerary_data.days.length 일치
  if (pkg.itinerary_data && typeof pkg.duration === 'number') {
    const days = pkg.itinerary_data.days ?? [];
    if (days.length > 0 && days.length !== pkg.duration) {
      warnings.push(`[W19] 일차 수 불일치: pkg.duration=${pkg.duration} vs itinerary_data.days.length=${days.length}`);
    }
  }

  return { warnings };
}
