const RISKY_CUSTOMER_PROMISE_PATTERN = [
  '\\uCD9C\\uBC1C\\s*\\uD655\\uC815', // 출발확정
  '\\uD655\\uC815\\s*\\uB610\\uB294\\s*\\uAC00\\uB2A5', // 확정 또는 가능
  '\\uC608\\uC57D\\s*\\uC989\\uC2DC', // 예약 즉시
  '\\uC989\\uC2DC\\s*\\uD655\\uC815', // 즉시 확정
  '\\uCD5C\\uC800\\uAC00\\s*\\uBCF4\\uC7A5', // 최저가 보장
  '\\uC88C\\uC11D\\s*\\uD655\\uBCF4', // 좌석 확보
  '\\uC88C\\uC11D\\uD655\\uBCF4', // 좌석확보
  '\\uC219\\uBC15\\s*\\uD655\\uC815', // 숙박 확정
  '100%\\s*\\uBCF4\\uC7A5', // 100% 보장
  '\\uBB34\\uC870\\uAC74\\s*\\uCD9C\\uBC1C', // 무조건 출발
  '(?:\\uD56D\\uACF5|\\uD638\\uD154|\\uC219\\uBC15|\\uC88C\\uC11D)[^\\n.!?\\u3002]{0,12}\\uD655\\uBCF4', // 항공/호텔/숙박/좌석 확보
  'Decision\\s*guide',
].join('|');

const RISKY_CUSTOMER_PROMISE_RE = new RegExp(`(?:${RISKY_CUSTOMER_PROMISE_PATTERN})`, 'iu');
const RISKY_CUSTOMER_PROMISE_RE_GLOBAL = new RegExp(`(?:${RISKY_CUSTOMER_PROMISE_PATTERN})`, 'giu');

const QUANTITY_FIXED_DEPARTURE_RE =
  /(?:\d+\s*(?:\uBA85|\uC778)\s*(?:\uBD80\uD130|\uC774\uC0C1)?\s*)?\uCD9C\uBC1C\s*\uD655\uC815!?/giu;
const CONFIRMED_OR_AVAILABLE_RE = /\uD655\uC815\s*\uB610\uB294\s*\uAC00\uB2A5/giu;
const RESERVATION_IMMEDIATE_SENTENCE_RE =
  /(?:\uC608\uC57D\s*\uC989\uC2DC|\uC989\uC2DC\s*\uD655\uC815)[^\n.!?\u3002]*(?:[.!?\u3002]|$)/giu;
const GUARANTEE_OR_HOLD_SENTENCE_RE =
  /[^\n.!?\u3002]*(?:\uCD5C\uC800\uAC00\s*\uBCF4\uC7A5|100%\s*\uBCF4\uC7A5|\uBB34\uC870\uAC74\s*\uCD9C\uBC1C|(?:\uD56D\uACF5|\uC88C\uC11D|\uD638\uD154|\uC219\uBC15)[^\n.!?\u3002]{0,12}\uD655\uBCF4)[^\n.!?\u3002]*(?:[.!?\u3002]|$)/giu;
const LOW_INFORMATION_RISK_RESIDUE_RE =
  /^(?:\d{1,2}[/-]\d{1,2}(?:\([^)]+\))?\s*(?:\uAE4C\uC9C0)?\s*)?(?:\uD56D\uACF5\uAD8C\s*)?\uBC1C\uAD8C\uC870\uAC74\s*$/u;

function compactCustomerCopy(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s*([,|])\s*/g, '$1 ')
    .replace(/\s*([./·])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,./|·-]+|[\s,./|·-]+$/g, '')
    .trim();
}

export function hasRiskyCustomerPromiseCopy(value: string): boolean {
  return RISKY_CUSTOMER_PROMISE_RE.test(value);
}

export function stripRiskyCustomerPromiseCopy(value: string): string | null {
  const candidate = compactCustomerCopy(
    value
      .replace(RESERVATION_IMMEDIATE_SENTENCE_RE, ' ')
      .replace(GUARANTEE_OR_HOLD_SENTENCE_RE, ' ')
      .replace(CONFIRMED_OR_AVAILABLE_RE, '\uC608\uC57D \uAC00\uB2A5') // 예약 가능
      .replace(QUANTITY_FIXED_DEPARTURE_RE, ' ')
      .replace(RISKY_CUSTOMER_PROMISE_RE_GLOBAL, ' '),
  );

  if (!candidate || candidate.length <= 4) return null;
  if (LOW_INFORMATION_RISK_RESIDUE_RE.test(candidate)) return null;
  return hasRiskyCustomerPromiseCopy(candidate) ? null : candidate;
}
