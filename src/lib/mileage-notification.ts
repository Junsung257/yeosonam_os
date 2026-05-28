/**
 * 마일리지 알림 서비스
 *
 * 적립/사용/소멸/이벤트 시 알림톡을 자동 발송합니다.
 * Solapi(Kakao) + Mock 이중화 구조.
 */
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import {
  sendMileageEarnedAlimtalk,
  sendMileageUsedAlimtalk,
  sendMileageExpiringSoonAlimtalk,
  sendMileageExpiredAlimtalk,
  sendMileageEventAlimtalk,
  sendWelcomeMileageAlimtalk,
} from '@/lib/kakao';

// ── 고객 전화번호 조회 헬퍼 ──────────────────────────────────────────────────

async function getCustomerPhone(customerId: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabaseAdmin
    .from('customers')
    .select('phone, name')
    .eq('id', customerId)
    .single();
  return data?.phone || null;
}

async function getCustomerName(customerId: string): Promise<string | undefined> {
  if (!isSupabaseConfigured) return undefined;
  const { data } = await supabaseAdmin
    .from('customers')
    .select('name')
    .eq('id', customerId)
    .single();
  return data?.name || undefined;
}

// ── 적립 알림 ─────────────────────────────────────────────────────────────────

export async function notifyMileageEarned(params: {
  customerId: string;
  earnedAmount: number;
  balance: number;
  bookingRef?: string;
}) {
  const phone = await getCustomerPhone(params.customerId);
  const name = await getCustomerName(params.customerId);
  if (!phone) {
    console.log('[MileageNotify] 전화번호 없음 — 건너뜀', params.customerId);
    return { skipped: true, reason: 'no_phone' };
  }
  return sendMileageEarnedAlimtalk({
    phone,
    name,
    earnedAmount: params.earnedAmount,
    balance: params.balance,
    bookingRef: params.bookingRef,
  });
}

// ── 사용 알림 ─────────────────────────────────────────────────────────────────

export async function notifyMileageUsed(params: {
  customerId: string;
  usedAmount: number;
  balance: number;
  bookingRef?: string;
}) {
  const phone = await getCustomerPhone(params.customerId);
  const name = await getCustomerName(params.customerId);
  if (!phone) {
    console.log('[MileageNotify] 전화번호 없음 — 건너뜀', params.customerId);
    return { skipped: true, reason: 'no_phone' };
  }
  return sendMileageUsedAlimtalk({
    phone,
    name,
    usedAmount: params.usedAmount,
    balance: params.balance,
    bookingRef: params.bookingRef,
  });
}

// ── 소멸 예정 알림 ───────────────────────────────────────────────────────────

export async function notifyMileageExpiringSoon(params: {
  customerId: string;
  expiringAmount: number;
  expireDate: string;
  daysLeft: number;
}) {
  const phone = await getCustomerPhone(params.customerId);
  const name = await getCustomerName(params.customerId);
  if (!phone) {
    console.log('[MileageNotify] 전화번호 없음 — 건너뜀', params.customerId);
    return { skipped: true, reason: 'no_phone' };
  }
  return sendMileageExpiringSoonAlimtalk({
    phone,
    name,
    expiringAmount: params.expiringAmount,
    expireDate: params.expireDate,
    daysLeft: params.daysLeft,
  });
}

// ── 소멸 완료 알림 ───────────────────────────────────────────────────────────

export async function notifyMileageExpired(params: {
  customerId: string;
  expiredAmount: number;
}) {
  const phone = await getCustomerPhone(params.customerId);
  const name = await getCustomerName(params.customerId);
  if (!phone) {
    console.log('[MileageNotify] 전화번호 없음 — 건너뜀', params.customerId);
    return { skipped: true, reason: 'no_phone' };
  }
  return sendMileageExpiredAlimtalk({
    phone,
    name,
    expiredAmount: params.expiredAmount,
  });
}

// ── 이벤트 알림 ───────────────────────────────────────────────────────────────

export async function notifyMileageEvent(params: {
  customerId: string;
  eventTitle: string;
  eventDescription: string;
  eventUrl?: string;
}) {
  const phone = await getCustomerPhone(params.customerId);
  const name = await getCustomerName(params.customerId);
  if (!phone) {
    console.log('[MileageNotify] 전화번호 없음 — 건너뜀', params.customerId);
    return { skipped: true, reason: 'no_phone' };
  }
  return sendMileageEventAlimtalk({
    phone,
    name,
    eventTitle: params.eventTitle,
    eventDescription: params.eventDescription,
    eventUrl: params.eventUrl,
  });
}

// ── 웰컴 마일리지 알림 ───────────────────────────────────────────────────────

export async function notifyWelcomeMileage(params: {
  customerId: string;
  mileageAmount: number;
}) {
  const phone = await getCustomerPhone(params.customerId);
  const name = await getCustomerName(params.customerId);
  if (!phone) {
    console.log('[MileageNotify] 전화번호 없음 — 건너뜀', params.customerId);
    return { skipped: true, reason: 'no_phone' };
  }
  return sendWelcomeMileageAlimtalk({
    phone,
    name,
    mileageAmount: params.mileageAmount,
  });
}

// ── 소멸 예정 고객 일괄 알림 ────────────────────────────────────────────────

/**
 * 소멸 예정(D-30, D-7) 고객을 조회하여 알림을 발송합니다.
 * (Cron Job에서 호출)
 */
export async function processExpiringMileageNotifications(): Promise<{
  d30: number;
  d7: number;
  errors: number;
}> {
  if (!isSupabaseConfigured) return { d30: 0, d7: 0, errors: 0 };

  let d30 = 0;
  let d7 = 0;
  let errors = 0;

  // 소멸 예정 기준: mileage_transactions 중 expires_at이 D-30, D-7인 것
  const now = new Date();
  const targetD30 = new Date(now.getTime() + 30 * 86400000);
  const targetD7 = new Date(now.getTime() + 7 * 86400000);

  // D-30: 만료일이 30일 후인 미소멸 건
  const { data: d30Targets } = await supabaseAdmin
    .from('mileage_transactions')
    .select('user_id, amount, expires_at')
    .eq('type', 'EARNED')
    .is('expired_at', null)
    .gte('expires_at', targetD30.toISOString().split('T')[0])
    .lt('expires_at', new Date(targetD30.getTime() + 86400000).toISOString().split('T')[0]);

  if (d30Targets) {
    const grouped = new Map<string, number>();
    for (const t of d30Targets as Array<{ user_id: string; amount: number; expires_at: string }>) {
      grouped.set(t.user_id, (grouped.get(t.user_id) || 0) + t.amount);
    }
    for (const [customerId, totalAmount] of grouped) {
      try {
        await notifyMileageExpiringSoon({
          customerId,
          expiringAmount: totalAmount,
          expireDate: targetD30.toISOString().split('T')[0],
          daysLeft: 30,
        });
        d30++;
      } catch {
        errors++;
      }
    }
  }

  // D-7: 만료일이 7일 후인 미소멸 건
  const { data: d7Targets } = await supabaseAdmin
    .from('mileage_transactions')
    .select('user_id, amount, expires_at')
    .eq('type', 'EARNED')
    .is('expired_at', null)
    .gte('expires_at', targetD7.toISOString().split('T')[0])
    .lt('expires_at', new Date(targetD7.getTime() + 86400000).toISOString().split('T')[0]);

  if (d7Targets) {
    const grouped = new Map<string, number>();
    for (const t of d7Targets as Array<{ user_id: string; amount: number; expires_at: string }>) {
      grouped.set(t.user_id, (grouped.get(t.user_id) || 0) + t.amount);
    }
    for (const [customerId, totalAmount] of grouped) {
      try {
        await notifyMileageExpiringSoon({
          customerId,
          expiringAmount: totalAmount,
          expireDate: targetD7.toISOString().split('T')[0],
          daysLeft: 7,
        });
        d7++;
      } catch {
        errors++;
      }
    }
  }

  return { d30, d7, errors };
}
