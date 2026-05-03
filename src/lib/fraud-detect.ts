/**
 * Phase 3-H: 사기 탐지 규칙 엔진
 *
 * detectFraudSignals(attempt, recentAttempts) → FraudSignal[]
 *
 * 규칙:
 * 1. 동일 IP에서 1시간 내 3건+ 예약 시도 → multi_card_same_ip
 * 2. 새벽 1-5시 500만원+ 결제 → unusual_hour_high_amount
 * 3. 10분 내 동일 금액 2회+ 시도 → rapid_retry
 * 4. 가입 24시간 내 300만원+ 첫 결제 → new_account_high_value
 */

export interface FraudSignal {
  type: 'multi_card_same_ip' | 'unusual_hour_high_amount' | 'rapid_retry' | 'new_account_high_value';
  severity: 'low' | 'medium' | 'high';
  description: string;
}

export interface BookingAttempt {
  ip: string;
  amount: number;
  createdAt: string;       // ISO 8601
  customerId: string;
  isNewCustomer: boolean;  // 가입 24시간 이내 여부
}

/** 규칙 1: 동일 IP에서 1시간 내 3건+ */
function checkMultiCardSameIp(
  attempt: BookingAttempt,
  recentAttempts: BookingAttempt[],
): FraudSignal | null {
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const attemptTime = new Date(attempt.createdAt).getTime();

  const sameIpInLastHour = recentAttempts.filter(a => {
    if (a.ip !== attempt.ip) return false;
    const diff = attemptTime - new Date(a.createdAt).getTime();
    return diff >= 0 && diff <= ONE_HOUR_MS;
  });

  // 현재 시도 포함 3건 이상 = recentAttempts에서 2건 이상 같은 IP
  if (sameIpInLastHour.length >= 2) {
    return {
      type: 'multi_card_same_ip',
      severity: 'high',
      description: `동일 IP(${attempt.ip})에서 1시간 내 ${sameIpInLastHour.length + 1}건 예약 시도 감지`,
    };
  }
  return null;
}

/** 규칙 2: 새벽 1~5시 500만원 이상 결제 */
function checkUnusualHourHighAmount(attempt: BookingAttempt): FraudSignal | null {
  const HIGH_AMOUNT_KRW = 5_000_000;
  const dt = new Date(attempt.createdAt);
  // KST = UTC+9
  const kstHour = (dt.getUTCHours() + 9) % 24;

  if (kstHour >= 1 && kstHour < 5 && attempt.amount >= HIGH_AMOUNT_KRW) {
    return {
      type: 'unusual_hour_high_amount',
      severity: 'medium',
      description: `새벽 ${kstHour}시 고액(${(attempt.amount / 10000).toFixed(0)}만원) 결제 시도`,
    };
  }
  return null;
}

/** 규칙 3: 10분 내 동일 금액 2회+ 시도 */
function checkRapidRetry(
  attempt: BookingAttempt,
  recentAttempts: BookingAttempt[],
): FraudSignal | null {
  const TEN_MIN_MS = 10 * 60 * 1000;
  const attemptTime = new Date(attempt.createdAt).getTime();

  const sameAmountRecent = recentAttempts.filter(a => {
    if (a.amount !== attempt.amount) return false;
    if (a.customerId !== attempt.customerId) return false;
    const diff = attemptTime - new Date(a.createdAt).getTime();
    return diff >= 0 && diff <= TEN_MIN_MS;
  });

  if (sameAmountRecent.length >= 1) {
    return {
      type: 'rapid_retry',
      severity: 'medium',
      description: `10분 내 동일 금액(${(attempt.amount / 10000).toFixed(0)}만원) ${sameAmountRecent.length + 1}회 시도`,
    };
  }
  return null;
}

/** 규칙 4: 신규 계정 24시간 내 300만원+ 첫 결제 */
function checkNewAccountHighValue(attempt: BookingAttempt): FraudSignal | null {
  const HIGH_VALUE_KRW = 3_000_000;

  if (attempt.isNewCustomer && attempt.amount >= HIGH_VALUE_KRW) {
    return {
      type: 'new_account_high_value',
      severity: 'high',
      description: `신규 고객(가입 24시간 이내) 고액(${(attempt.amount / 10000).toFixed(0)}만원) 결제 시도`,
    };
  }
  return null;
}

/**
 * 사기 신호 전체 탐지
 * @param attempt 현재 예약 시도
 * @param recentAttempts 최근 예약 시도 목록 (현재 시도 미포함, 최신순)
 * @returns FraudSignal[] — 빈 배열이면 정상
 */
export function detectFraudSignals(
  attempt: BookingAttempt,
  recentAttempts: BookingAttempt[],
): FraudSignal[] {
  const signals: FraudSignal[] = [];

  const r1 = checkMultiCardSameIp(attempt, recentAttempts);
  if (r1) signals.push(r1);

  const r2 = checkUnusualHourHighAmount(attempt);
  if (r2) signals.push(r2);

  const r3 = checkRapidRetry(attempt, recentAttempts);
  if (r3) signals.push(r3);

  const r4 = checkNewAccountHighValue(attempt);
  if (r4) signals.push(r4);

  return signals;
}

/** 신호 목록에서 최고 severity 반환 */
export function maxSeverity(signals: FraudSignal[]): 'low' | 'medium' | 'high' | null {
  if (signals.length === 0) return null;
  if (signals.some(s => s.severity === 'high')) return 'high';
  if (signals.some(s => s.severity === 'medium')) return 'medium';
  return 'low';
}
