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
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return handleExpireMileage();
}

export async function GET() {
  return handleExpireMileage();
}

async function handleExpireMileage() {
  try {
    const { isSupabaseConfigured, supabaseAdmin } = await import('@/lib/supabase');
    const { processExpiringMileageNotifications } = await import('@/lib/mileage-notification');

    if (!isSupabaseConfigured) {
      return NextResponse.json({ ok: false, reason: 'supabase 미설정' });
    }

    // 1. 소멸 처리
    const { data: expireResult } = await supabaseAdmin.rpc('expire_customer_mileage');
    const expiredCount = expireResult ?? 0;

    // 2. 소멸 예정 알림 발송
    const notificationResult = await processExpiringMileageNotifications();

    // 3. 소멸 완료 알림 (소멸된 고객 대상)
    // 이미 expire_customer_mileage RPC에서 expired_at = NOW()로 세팅했으므로
    // 오늘 소멸된 건을 조회
    const { data: expiredCustomers } = await supabaseAdmin
      .from('mileage_transactions')
      .select('user_id, amount')
      .eq('type', 'EXPIRED')
      .gte('expired_at', new Date().toISOString().split('T')[0]);

    let notifiedExpired = 0;
    if (expiredCustomers) {
      const { notifyMileageExpired } = await import('@/lib/mileage-notification');
      const grouped = new Map<string, number>();
      for (const tx of expiredCustomers as Array<{ user_id: string; amount: number }>) {
        grouped.set(tx.user_id, (grouped.get(tx.user_id) || 0) + tx.amount);
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

    return NextResponse.json({
      ok: true,
      expiredCount,
      notifiedExpired,
      d30Notified: notificationResult.d30,
      d7Notified: notificationResult.d7,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[ExpireMileage] Cron 오류:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
