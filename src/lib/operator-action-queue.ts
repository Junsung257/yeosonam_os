export type OperatorAction =
  | '연락하기'
  | '견적 작성'
  | '견적 발송'
  | '예약 확정'
  | '입금 매칭'
  | '후속 연락'
  | '종료';

export interface OperatorQueueInput {
  source: 'lead' | 'qa' | 'rfq';
  createdAt: string;
  phone?: string | null;
  bookingId?: string | null;
  bookingStatus?: string | null;
  paymentStatus?: string | null;
  taskType?: string | null;
  taskStatus?: string | null;
  now?: Date;
}

export interface OperatorQueueDecision {
  rank: number;
  label: string;
  action: OperatorAction;
  href: string | null;
  waitingMinutes: number;
}

function bookingHref(id?: string | null): string | null {
  return id ? `/admin/bookings/${encodeURIComponent(id)}` : null;
}

function contactHref(phone?: string | null): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 9 ? `tel:${digits}` : null;
}

export function decideOperatorQueueAction(input: OperatorQueueInput): OperatorQueueDecision {
  const now = input.now ?? new Date();
  const createdAt = new Date(input.createdAt);
  const waitingMinutes = Number.isFinite(createdAt.getTime())
    ? Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 60_000))
    : 0;
  const taskType = input.taskType ?? '';
  const bookingStatus = input.bookingStatus ?? '';
  const paymentStatus = input.paymentStatus ?? '';
  const taskStatus = input.taskStatus ?? '';

  if (['resolved', 'auto_resolved', 'superseded'].includes(taskStatus)) {
    return { rank: 8, label: '처리 완료', action: '종료', href: bookingHref(input.bookingId), waitingMinutes };
  }

  if (/(quote_draft|quote_required|quote_prepare)/i.test(taskType)) {
    return { rank: 3, label: '견적 발송 필요', action: '견적 작성', href: bookingHref(input.bookingId), waitingMinutes };
  }
  if (/(quote_send|quote_ready)/i.test(taskType)) {
    return { rank: 3, label: '견적 발송 필요', action: '견적 발송', href: bookingHref(input.bookingId), waitingMinutes };
  }
  if (/(customer_reply|customer_waiting)/i.test(taskType)) {
    return { rank: 4, label: '고객 회신 대기', action: '후속 연락', href: contactHref(input.phone), waitingMinutes };
  }
  if (/seat_check/i.test(taskType)) {
    return waitingMinutes >= 10
      ? { rank: 2, label: '10분 이상 미응답', action: '연락하기', href: contactHref(input.phone), waitingMinutes }
      : { rank: 1, label: '신규 상담', action: '연락하기', href: contactHref(input.phone), waitingMinutes };
  }
  if (/confirm/i.test(taskType) && !/(payment|deposit)/i.test(taskType)) {
    return { rank: 5, label: '예약 확정 필요', action: '예약 확정', href: bookingHref(input.bookingId), waitingMinutes };
  }
  if (
    /(payment|deposit|unmatched)/i.test(taskType)
    || (bookingStatus === 'confirmed' && !['완납', 'paid'].includes(paymentStatus))
  ) {
    return { rank: 6, label: '입금 확인 필요', action: '입금 매칭', href: bookingHref(input.bookingId), waitingMinutes };
  }
  if (['cancelled', 'completed', 'resolved', 'closed', 'done'].includes(bookingStatus)) {
    return { rank: 8, label: '처리 완료', action: '종료', href: bookingHref(input.bookingId), waitingMinutes };
  }
  if (waitingMinutes >= 10) {
    return { rank: 2, label: '10분 이상 미응답', action: '연락하기', href: contactHref(input.phone), waitingMinutes };
  }
  if (input.source === 'lead' || input.source === 'qa' || input.source === 'rfq') {
    return { rank: 1, label: '신규 상담', action: '연락하기', href: contactHref(input.phone), waitingMinutes };
  }
  return { rank: 7, label: '후속 연락 필요', action: '후속 연락', href: contactHref(input.phone), waitingMinutes };
}
