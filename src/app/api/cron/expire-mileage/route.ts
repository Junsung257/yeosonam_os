/**
 * 마일리지 소멸 Cron
 *
 * POST /api/cron/expire-mileage
 *
 * Vercel Cron Jobs: 매일 자정 실행
 * 1. PostgreSQL RPC expire_customer_mileage() 호출
 * 2. 소멸된 고객에게 알림톡 발송
 * 3. 소멸 예정(D-30, D-7) 고객에게 알림톡 발송
 */
import { NextRequest, NextResponse } from 'next/server';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { expireMileage } from '@/lib/mileage-expiration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function runExpireMileage(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  if (!isSupabaseConfigured) {
    return { ok: false, reason: 'supabase 미설정' };
  }

  // 1. 소멸 처리 (통일된 expire_mileage_batch RPC 사용)
  const expireResult = await expireMileage(200);

  // 2. 소멸 예정 알림 발송
  const { processExpiringMileageNotifications } = await import('@/lib/mileage-notification');
  const notificationResult = await processExpiringMileageNotifications();

  // 3. 소멸 완료 알림 (소멸된 고객 대상)
  const { notifyMileageExpired } = await import('@/lib/mileage-notification');
  const todayStr = new Date().toISOString().split('T')[0];
  const { data: expiredCustomers } = await supabaseAdmin
    .from('mileage_transactions')
    .select('user_id, amount')
    .eq('type', 'CLAWBACK')
    .gte('created_at', todayStr);

  let notifiedExpired = 0;
  if (expiredCustomers) {
    const grouped = new Map<string, number>();
    for (const tx of expiredCustomers as Array<{ user_id: string; amount: number }>) {
      grouped.set(tx.user_id, (grouped.get(tx.user_id) || 0) + Math.abs(tx.amount));
    }
    for (const [customerId, totalAmount] of grouped) {
      try {
        await notifyMileageExpired({ customerId, expiredAmount: totalAmount });
        notifiedExpired++;
      } catch {
        // 개별 실패 무시
      }
    }
  }

  return {
    ok: true,
    processedCount: expireResult.processed_count,
    totalExpiredAmount: expireResult.total_expired_amount,
    notifiedExpired,
    d30Notified: notificationResult.d30,
    d7Notified: notificationResult.d7,
  };
}

export const POST = withCronLogging('expire-mileage', runExpireMileage);
export const GET = withCronLogging('expire-mileage', runExpireMileage);
