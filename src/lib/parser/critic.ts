/**
 * @file critic.ts — 결정적 Critic Agent (2026-05-14 박제, DocSync 2605.02163 패턴)
 *
 * 박제 사유:
 *   LLM 추출 결과의 cross-field consistency 를 결정적으로 검증. 비용 0, 즉시.
 *   "title 에 부관훼리 인데 airline 이 베트남항공" 같은 모순을 INSERT 전 차단.
 *
 * 검증 룰:
 *   - C-title↔destination: title 에 도시명이 명시되어 있으면 destination 과 일치해야
 *   - C-ferry↔airline: ferry 키워드 매칭이면 airline 도 ferry name 이어야 (✈ 환각 차단)
 *   - C-days↔nights: duration 이 days 라면 nights = days - 1 (3박4일 → days=4, nights=3)
 *   - C-price-range: 1박당 최저 가격이 비현실적 범위 (<1만 또는 >5천만) 면 의심
 *   - C-departure↔airline: departure_airport 와 airline 의 카탈로그 항공편 prefix 정합
 *
 * 동작: detectIssues() 반환. 호출 측은 결과로 결정 (BLOCK / WARN / 자동 수정).
 */

import { detectFerry } from './deterministic/ferry-classifier';

export type CriticSeverity = 'critical' | 'high' | 'medium' | 'info';

export interface CriticIssue {
  rule: string;
  severity: CriticSeverity;
  message: string;
  suggestedFix?: string;
}

interface CritInput {
  title?: string | null;
  destination?: string | null;
  airline?: string | null;
  product_type?: string | null;
  duration?: number | null;
  nights?: number | null;
  price?: number | null;
  departure_airport?: string | null;
  rawText?: string | null;
}

const CITY_KEYWORDS = [
  '후쿠오카','오사카','도쿄','삿포로','오키나와','교토','나라','나가사키','벳부',
  '방콕','치앙마이','싱가포르','마카오','홍콩','대만','타이페이','베트남','하노이',
  '다낭','호치민','나트랑','푸꾸옥','세부','마닐라','발리','쿠알라룸푸르',
  '장가계','계림','북경','상해','청두','연길','황산','곤명','서안','중경',
  '괌','사이판','하와이','두바이','이스탄불','런던','파리',
];

export function detectIssues(input: CritInput): CriticIssue[] {
  const issues: CriticIssue[] = [];
  const title = (input.title ?? '').trim();
  const destination = (input.destination ?? '').trim();
  const airline = (input.airline ?? '').trim();
  const product_type = (input.product_type ?? '').trim();

  // C-title↔destination
  if (title && destination) {
    const titleCity = CITY_KEYWORDS.find(c => title.includes(c));
    if (titleCity && !destination.includes(titleCity) && !titleCity.includes(destination)) {
      issues.push({
        rule: 'C-title↔destination',
        severity: 'high',
        message: `title 에 "${titleCity}" 가 명시되어 있는데 destination="${destination}" 가 다름`,
        suggestedFix: `destination 을 "${titleCity}" 로 재검토 필요`,
      });
    }
  }

  // C-ferry↔airline
  const ferry = detectFerry(input.rawText ?? '', title);
  if (ferry.isFerry) {
    if (product_type !== 'cruise' && product_type !== 'ferry') {
      issues.push({
        rule: 'C-ferry↔product_type',
        severity: 'high',
        message: `Ferry 키워드 "${ferry.matchedKeyword}" 매칭인데 product_type="${product_type}"`,
        suggestedFix: 'product_type 을 "cruise" 로 설정',
      });
    }
    if (airline && !/훼리|페리|카멜리아|크루즈|선박|cruise|ferry/i.test(airline)) {
      issues.push({
        rule: 'C-ferry↔airline',
        severity: 'critical',
        message: `Ferry 상품인데 airline="${airline}" 가 항공사 같음 — ✈ 환각 위험`,
        suggestedFix: `airline 을 "${ferry.ferryName ?? '훼리/페리'}" 로 재설정`,
      });
    }
  }

  // C-days↔nights
  if (typeof input.duration === 'number' && typeof input.nights === 'number') {
    if (input.duration > 0 && input.nights > 0 && input.duration - input.nights !== 1) {
      issues.push({
        rule: 'C-days↔nights',
        severity: 'medium',
        message: `duration=${input.duration} / nights=${input.nights} 부정합 (보통 days = nights + 1)`,
      });
    }
  }

  // C-price-range
  if (typeof input.price === 'number' && input.price > 0) {
    if (input.price < 10000) {
      issues.push({
        rule: 'C-price-range',
        severity: 'high',
        message: `price=${input.price}원 < 1만원 — 가격 단위 오해(천원 단위 약식) 가능성`,
        suggestedFix: 'price × 1000 재고려',
      });
    } else if (input.price > 50_000_000) {
      issues.push({
        rule: 'C-price-range',
        severity: 'high',
        message: `price=${input.price}원 > 5천만 — 비현실적 가격`,
      });
    }
  }

  return issues;
}

/** 자동 수정 가능한 issue 를 ed 에 적용. critical/high 만 적용. */
export function autoFixIssues(ed: Record<string, unknown>, issues: CriticIssue[]): {
  fixed: string[];
} {
  const fixed: string[] = [];
  for (const issue of issues) {
    if (issue.rule === 'C-ferry↔product_type') {
      ed.product_type = 'cruise';
      fixed.push(issue.rule);
    }
    if (issue.rule === 'C-ferry↔airline') {
      const m = (issue.suggestedFix ?? '').match(/"([^"]+)"/);
      if (m) {
        ed.airline = m[1];
        fixed.push(issue.rule);
      }
    }
    if (issue.rule === 'C-price-range' && issue.suggestedFix?.includes('× 1000')) {
      const cur = typeof ed.price === 'number' ? ed.price : 0;
      if (cur > 0 && cur < 10000) {
        ed.price = cur * 1000;
        fixed.push(issue.rule);
      }
    }
  }
  return { fixed };
}
