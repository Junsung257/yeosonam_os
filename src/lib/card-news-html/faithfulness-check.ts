/**
 * @file faithfulness-check.ts — 카드뉴스 HTML 사실 충실성 후처리 검증
 *
 * Claude 가 생성한 HTML 에 "원문에 없는데 자주 환각하는 패턴" 이 있는지 regex 로 탐지.
 * Anthropic API 호출 없음 — 순수 텍스트 분석.
 *
 * Faithfulness Rule (A0) 의 자동화된 첫 번째 방어선.
 *
 * 사용:
 *   const report = checkFaithfulness({ html, rawText });
 *   if (report.suspicions.length > 0) console.warn(report.suspicions);
 */

export interface FaithfulnessReport {
  ok: boolean;
  suspicions: Array<{
    pattern: string;          // 의심 키워드/구문 정체
    matched: string;          // HTML 에서 잡힌 실제 텍스트
    reason: string;           // 왜 의심스러운지
    severity: 'high' | 'medium' | 'low';
  }>;
  htmlTextLen: number;
  rawTextLen: number;
}

/**
 * 흔한 환각 패턴. 이 패턴이 HTML 에 등장하면서 원문에는 없으면 의심.
 *
 * 카테고리:
 *   - age: 연령 제한 (만 N세 이상 같은)
 *   - discount: 조건부 할인 (N일 전 예약, 조기 발권 등)
 *   - passport: 여권 잔여 기간
 *   - capacity: 정원/잔여석 구체 수치 (원문에 없으면)
 *   - guarantee: 보장 문구 ("100% 환불", "최저가 보장" 등)
 */
const HALLUCINATION_PATTERNS: Array<{
  category: string;
  pattern: RegExp;
  reason: string;
  severity: 'high' | 'medium' | 'low';
}> = [
  {
    category: 'age',
    pattern: /만\s*\d{1,2}\s*세\s*(이상|이하|부터)?/g,
    reason: '연령 제한은 자주 환각됨 — 원문에 명시 없으면 제거 필요',
    severity: 'high',
  },
  {
    category: 'discount',
    pattern: /\d{1,3}\s*일\s*전\s*(까지\s*)?(예약|결제|발권)\s*시?\s*[가-힣]*\s*(할인|특가|혜택)/g,
    reason: '조기 예약/발권 할인 조건은 자주 환각됨',
    severity: 'high',
  },
  {
    category: 'passport',
    pattern: /여권\s*(잔여\s*)?(유효\s*)?(기간\s*)?\d+\s*개?월\s*(이상)?/g,
    reason: '여권 잔여 기간은 일반 상식이지만 원문에 없으면 제거',
    severity: 'medium',
  },
  {
    category: 'capacity',
    pattern: /(잔여|남은)\s*\d+\s*(석|자리|좌석|명)/g,
    reason: '잔여석 구체 수치는 자주 환각됨',
    severity: 'high',
  },
  {
    category: 'guarantee',
    pattern: /100\s*%\s*(환불|보장|최저가)/g,
    reason: '"100% 환불/보장" 같은 강한 보장 문구는 법적 리스크',
    severity: 'high',
  },
  {
    category: 'best_price',
    pattern: /(업계|시장)?\s*최저가\s*(보장)?/g,
    reason: '"최저가 보장" 광고 관련 법규 주의',
    severity: 'medium',
  },
];

/**
 * HTML 에서 텍스트만 추출 (간단 파싱).
 * 정확한 DOM 파싱은 아니지만 환각 검출 용도로 충분.
 */
function extractText(html: string): string {
  return html
    // <style>, <script> 블럭 통째 제거
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    // SVG 안의 텍스트는 보존하기 위해 SVG 자체는 유지하되 태그만 제거
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 원문에 해당 부분 문자열이 있는지 normalize 비교 (공백/구두점 무시).
 */
function rawContains(rawText: string, fragment: string): boolean {
  const norm = (s: string) => s.replace(/[\s.,·\-/()]+/g, '').toLowerCase();
  return norm(rawText).includes(norm(fragment));
}

export function checkFaithfulness(input: {
  html: string;
  rawText: string;
}): FaithfulnessReport {
  const htmlText = extractText(input.html);
  const rawText = input.rawText;

  const suspicions: FaithfulnessReport['suspicions'] = [];

  for (const rule of HALLUCINATION_PATTERNS) {
    rule.pattern.lastIndex = 0; // global regex 재사용 시 안전
    const matches = htmlText.match(rule.pattern);
    if (!matches) continue;

    for (const m of matches) {
      // 원문에 같은 표현이 있으면 환각이 아님 — 통과
      if (rawContains(rawText, m)) continue;

      suspicions.push({
        pattern: rule.category,
        matched: m,
        reason: rule.reason,
        severity: rule.severity,
      });
    }
  }

  return {
    ok: suspicions.length === 0,
    suspicions,
    htmlTextLen: htmlText.length,
    rawTextLen: rawText.length,
  };
}

/**
 * 보고서를 사람이 읽을 수 있는 한 줄 요약으로.
 */
export function summarizeFaithfulnessReport(report: FaithfulnessReport): string {
  if (report.ok) return '✓ 환각 의심 없음';
  const high = report.suspicions.filter((s) => s.severity === 'high').length;
  const medium = report.suspicions.filter((s) => s.severity === 'medium').length;
  const parts: string[] = [];
  if (high > 0) parts.push(`high ${high}건`);
  if (medium > 0) parts.push(`medium ${medium}건`);
  return `⚠ 의심 ${parts.join(' · ')}: ${report.suspicions.map((s) => s.matched).slice(0, 3).join(', ')}`;
}
