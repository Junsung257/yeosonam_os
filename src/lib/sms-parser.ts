/**
 * 신한은행 입금 SMS 파싱 라이브러리
 *
 * 지원 형식:
 *   [신한은행] 홍길동 300,000원 입금 잔액1,234,567원 03/09 10:30
 *   [Web발신][신한은행] 입금 홍길동 300,000원 잔액1,234,567원
 *   [신한은행] 입금통보 홍길동 300,000원 03/09
 *   신한은행 300,000원 홍길동 입금
 */

export interface ParsedSMS {
  isDeposit: boolean;        // 입금 여부 (출금이면 false)
  senderName: string | null; // 입금자명
  amount: number | null;     // 입금액 (원)
  balance: number | null;    // 잔액
  receivedAt: Date;          // 수신 시각
}

// 금액 문자열 → 숫자 (예: "300,000" → 300000)
function parseAmount(str: string): number {
  return parseInt(str.replace(/,/g, ''), 10);
}

// 월/일 문자열 + 현재 연도로 Date 생성
function parseDateFromSMS(dateStr: string, timeStr?: string): Date {
  const now = new Date();
  const [month, day] = dateStr.split('/').map(Number);
  const year = now.getMonth() + 1 < month ? now.getFullYear() - 1 : now.getFullYear();
  const base = new Date(year, month - 1, day);
  if (timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    base.setHours(h, m);
  }
  return base;
}

export function parseShinhanSMS(smsText: string, receivedAt?: Date): ParsedSMS {
  const text = smsText.trim();
  const baseTime = receivedAt || new Date();

  // 신한은행 메시지인지 확인
  const isShinhan = text.includes('신한은행') || text.includes('Shinhan');
  if (!isShinhan) {
    return { isDeposit: false, senderName: null, amount: null, balance: null, receivedAt: baseTime };
  }

  // 출금 메시지 제외 ('출금', '이체출금', '자동이체' 포함)
  const isWithdrawal = /출금|이체출금|자동이체/.test(text);
  if (isWithdrawal) {
    return { isDeposit: false, senderName: null, amount: null, balance: null, receivedAt: baseTime };
  }

  // 입금 여부 확인
  const isDeposit = /입금/.test(text);

  // 금액 추출: 숫자,숫자원 패턴
  const amountMatch = text.match(/([0-9,]+)원\s*입금|입금\s*([0-9,]+)원|([0-9,]+)원\s*(입금)/);
  let amount: number | null = null;
  if (amountMatch) {
    const raw = amountMatch[1] || amountMatch[2] || amountMatch[3];
    if (raw) amount = parseAmount(raw);
  }

  // 금액이 없으면 단순히 숫자 패턴 + 원 시도 (첫번째 매칭)
  if (!amount) {
    const simple = text.match(/(\d{1,3}(?:,\d{3})+|\d{4,})원/);
    if (simple) amount = parseAmount(simple[1]);
  }

  // 잔액 추출: '잔액' 뒤 숫자
  const balanceMatch = text.match(/잔액\s*([0-9,]+)/);
  const balance = balanceMatch ? parseAmount(balanceMatch[1]) : null;

  // 입금자명 추출
  // 패턴1: "[신한은행] 홍길동 금액원 입금"
  // 패턴2: "입금 홍길동 금액원"
  let senderName: string | null = null;

  // 신한은행 태그 이후 이름 추출 (한글 2~4자)
  const namePatterns = [
    /\[신한은행\]\s*([가-힣]{2,5})\s+[\d,]+원/,
    /\[Web발신\]\[신한은행\]\s*입금\s*([가-힣]{2,5})\s+[\d,]+원/,
    /입금통보\s+([가-힣]{2,5})\s+[\d,]+원/,
    /입금\s+([가-힣]{2,5})\s+[\d,]+원/,
    /([가-힣]{2,5})\s+[\d,]+원\s*입금/,
    /([가-힣]{2,5})\s+입금/,
  ];

  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      // "은행", "신한" 등 제외
      const candidate = match[1];
      if (!['신한', '국민', '은행', '입금', '출금', '잔액'].includes(candidate)) {
        senderName = candidate;
        break;
      }
    }
  }

  // 날짜/시각 추출
  const dateMatch = text.match(/(\d{2}\/\d{2})\s+(\d{2}:\d{2})/);
  const dateOnlyMatch = text.match(/(\d{2}\/\d{2})/);

  let receivedAtFinal = baseTime;
  if (dateMatch) {
    receivedAtFinal = parseDateFromSMS(dateMatch[1], dateMatch[2]);
  } else if (dateOnlyMatch) {
    receivedAtFinal = parseDateFromSMS(dateOnlyMatch[1]);
  }

  return { isDeposit, senderName, amount, balance, receivedAt: receivedAtFinal };
}
