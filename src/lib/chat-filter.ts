/**
 * 안심 중개 채팅 PII 필터
 *
 * 고객 ↔ 랜드사 간 직거래를 방지하기 위해 메시지에서 연락처 정보를 감지하고
 * "***(여소남 안심번호)"로 마스킹 처리한다.
 *
 * 결제 완료(COMPLETED) 이후에만 조건부 언마스킹(unmask)을 허용한다.
 */

// ── PII 감지 패턴 ──────────────────────────────────────────────

const PII_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  // 한국 휴대폰 번호: 010-1234-5678 / 01012345678 / 010.1234.5678
  {
    name: '휴대폰번호',
    regex: /01[016789][.\-\s]?\d{3,4}[.\-\s]?\d{4}/g,
  },
  // 한국 유선 전화: 02-1234-5678 / 031-123-4567
  {
    name: '유선전화',
    regex: /0[2-9]\d?[.\-\s]\d{3,4}[.\-\s]\d{4}/g,
  },
  // 이메일 주소
  {
    name: '이메일',
    regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
  },
  // 카카오톡 ID: "카카오 abc123" / "카톡 abc123" / "카카오id: abc" / "kakao: abc"
  {
    name: '카카오ID',
    regex: /(?:카카오톡?|카톡|kakao|kakaotalk)[\s:_\-]*[a-zA-Z0-9가-힣_.\-]{2,30}/gi,
  },
  // 라인 ID: "라인 abc" / "line: abc"
  {
    name: '라인ID',
    regex: /(?:라인|line)[\s:_\-]+[a-zA-Z0-9_.\-]{2,30}/gi,
  },
  // 텔레그램: "@username" (@ 포함)
  {
    name: '텔레그램',
    regex: /@[a-zA-Z0-9_]{5,32}/g,
  },
  // 사업자등록번호: 123-45-67890
  {
    name: '사업자번호',
    regex: /\d{3}[.\-\s]\d{2}[.\-\s]\d{5}/g,
  },
  // 계좌번호 패턴: 연속된 숫자 10-14자리 (은행 계좌)
  {
    name: '계좌번호',
    regex: /\b\d{10,14}\b/g,
  },
];

const MASK_PLACEHOLDER = '***(여소남 안심번호)';

// ── 공개 인터페이스 ────────────────────────────────────────────

export interface FilterResult {
  maskedMessage: string;
  isFiltered: boolean;
  detectedTypes: string[];
}

/**
 * 메시지에서 PII를 감지하고 마스킹 처리한다.
 */
export function filterMessage(rawMessage: string): FilterResult {
  let maskedMessage = rawMessage;
  const detectedTypes: string[] = [];

  for (const { name, regex } of PII_PATTERNS) {
    // regex는 /g 플래그라 lastIndex 초기화 필요
    regex.lastIndex = 0;
    if (regex.test(rawMessage)) {
      detectedTypes.push(name);
      regex.lastIndex = 0; // test() 후 lastIndex 리셋
      maskedMessage = maskedMessage.replace(regex, MASK_PLACEHOLDER);
    }
  }

  return {
    maskedMessage,
    isFiltered: detectedTypes.length > 0,
    detectedTypes,
  };
}

/**
 * 결제 완료(COMPLETED) 상태인지 확인 후 원본 메시지를 반환한다.
 * 미완료 상태에서는 마스킹본을 그대로 반환한다.
 *
 * @param rawMessage     원본 메시지 (DB에만 보관)
 * @param maskedMessage  마스킹 메시지
 * @param bookingStatus  예약 결제 상태
 */
export function resolveMessage(
  rawMessage: string,
  maskedMessage: string,
  bookingStatus: string | null | undefined,
): string {
  // 결제 완료 상태에서만 원본 노출
  if (bookingStatus === 'COMPLETED' || bookingStatus === 'completed') {
    return rawMessage;
  }
  return maskedMessage;
}

/**
 * PII 감지 여부만 빠르게 확인 (저장 없이 사전 검사용).
 */
export function hasPII(text: string): boolean {
  for (const { regex } of PII_PATTERNS) {
    regex.lastIndex = 0;
    if (regex.test(text)) return true;
  }
  return false;
}
