/**
 * Legacy-compatible decision gap adapter.
 *
 * V2 treated uncommon title tokens as missing topics and told the writer to
 * create H2 sections. V3 evaluates whether a reader decision is unresolved.
 * Competitor wording is never promoted into an outline requirement.
 */

export interface SerpGapResult {
  missingTopics: string[];
  coverageScore: number;
  suggestions: string[];
}

interface DecisionRole {
  purpose: string;
  pattern: RegExp;
}

const ROLES: DecisionRole[] = [
  { purpose: '질문에 대한 직접 답', pattern: /가능|괜찮|추천|선택|답|결론/i },
  { purpose: '선택을 바꾸는 조건', pattern: /기준|조건|경우|상황|유형|누구/i },
  { purpose: '시간과 이동 부담', pattern: /이동|동선|소요\s*시간|거리|교통/i },
  { purpose: '비용과 포함 범위', pattern: /비용|예산|가격|요금|포함|추가/i },
  { purpose: '위험과 실패 대안', pattern: /주의|위험|우천|대안|취소|지연|휴무/i },
  { purpose: '예약 전 공식 확인', pattern: /공식|확인|예약|운영\s*시간|시행일/i },
];

function visibleText(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`|>\[\]()]/g, ' ')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

export function analyzeSerpGap(
  keyword: string,
  myHtml: string,
  competitorTitles: string[],
): SerpGapResult {
  const ownText = visibleText(`${keyword} ${myHtml}`);
  const sampleText = competitorTitles.map(visibleText).join(' ');
  const relevantRoles = ROLES.filter((role) => role.pattern.test(sampleText) || role.pattern.test(keyword));
  const missing = relevantRoles.filter((role) => !role.pattern.test(ownText));
  const denominator = Math.max(1, relevantRoles.length);
  const coverageScore = Math.round(((denominator - missing.length) / denominator) * 100);
  return {
    missingTopics: missing.map((role) => role.purpose),
    coverageScore,
    suggestions: missing.map((role) => (
      `"${role.purpose}"가 독자의 주된 결정을 실제로 해결하는지 검토하세요. 근거가 없으면 섹션을 만들지 않습니다.`
    )),
  };
}
