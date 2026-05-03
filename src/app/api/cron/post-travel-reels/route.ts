import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { sendSlackAlert } from '@/lib/slack-alert';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/post-travel-reels
 *
 * 귀국일(departure_date + duration_days = today) 예약을 찾아
 * 릴스 제작 안내 Slack 알림을 보내고 메시지 로그를 기록합니다.
 *
 * Vercel Cron 설정 예시 (vercel.json):
 *   { "path": "/api/cron/post-travel-reels", "schedule": "0 10 * * *" }
 *
 * 실제 고객 알림(알림톡 등)은 추후 확장 예정.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();

  if (!isSupabaseConfigured) {
    console.log('[post-travel-reels cron] Supabase 미설정 — Mock 실행');
    return NextResponse.json({ ok: true, processed: 0, mock: true });
  }

  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // departure_date + duration_days = today 인 예약 조회
    // duration_days 컬럼이 없을 경우 대비: travel_packages 조인으로 duration 취득
    const { data: bookings, error: fetchErr } = await supabaseAdmin
      .from('bookings')
      .select(`
        id,
        lead_customer_id,
        departure_date,
        travel_packages!package_id (
          destination,
          duration_days
        ),
        customers!lead_customer_id (
          name,
          phone
        )
      `)
      .not('departure_date', 'is', null)
      .eq('status', 'fully_paid');

    if (fetchErr) throw fetchErr;

    type BookingRow = typeof bookings extends (infer T)[] | null ? T : never;
    const returned = (bookings ?? []).filter((b: BookingRow) => {
      const depDate = (b as { departure_date: string | null }).departure_date;
      if (!depDate) return false;
      // duration_days 추출 (조인 결과는 배열일 수 있음)
      const rawPkg = (b as { travel_packages: unknown }).travel_packages;
      const pkg = Array.isArray(rawPkg) ? rawPkg[0] : rawPkg;
      const durationDays = (pkg as { duration_days?: number } | null)?.duration_days ?? 0;
      if (durationDays === 0) return false;

      const dep = new Date(depDate);
      dep.setDate(dep.getDate() + durationDays - 1); // 마지막 여행일
      const returnDate = dep.toISOString().split('T')[0];
      return returnDate === today;
    });

    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
    let slackSent = 0;

    for (const booking of returned) {
      const pkg = Array.isArray(booking.travel_packages)
        ? booking.travel_packages[0]
        : booking.travel_packages;
      const customer = Array.isArray(booking.customers)
        ? booking.customers[0]
        : booking.customers;
      const dest =
        (pkg as { destination?: string } | null)?.destination ?? '목적지 미상';
      const custName =
        (customer as { name?: string } | null)?.name ?? '고객';

      // message_logs 기록 (실제 고객 알림 확장 지점)
      await supabaseAdmin.from('message_logs').insert({
        booking_id: booking.id,
        event_type: 'REELS_PROMPT',
        channel: 'system',
        content: `[릴스 안내] ${custName}님이 ${dest} 여행을 마쳤습니다. 릴스 제작 안내를 발송하세요.`,
        status: 'logged',
      });

      // Slack 알림
      if (slackWebhookUrl) {
        try {
          await fetch(slackWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: `📸 *귀국 릴스 안내 대상* | booking \`${booking.id}\`\n고객: ${custName} | 여행지: ${dest}\n→ 매직링크로 릴스 제작 안내 발송 예정`,
            }),
          });
          slackSent++;
        } catch (slackErr) {
          console.warn('[post-travel-reels] Slack 발송 실패:', slackErr);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      processed: returned.length,
      slackSent,
      date: today,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '처리 실패';
    console.error('[post-travel-reels cron] error:', err);
    await sendSlackAlert(`[post-travel-reels] 크론 오류: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
