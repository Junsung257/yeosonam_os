import { NextRequest } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { sendSlackAlert } from '@/lib/slack-alert';
import { getSecret } from '@/lib/secret-registry';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/post-travel-reels
 *
 * Finds bookings that returned today and logs a reels prompt.
 * Customer names are intentionally omitted from Slack/system logs.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();

  if (!isSupabaseConfigured) {
    console.log('[post-travel-reels cron] Supabase not configured - mock run');
    return apiResponse({ ok: true, processed: 0, mock: true });
  }

  try {
    const today = new Date().toISOString().split('T')[0];

    const { data: bookings, error: fetchErr } = await supabaseAdmin
      .from('bookings')
      .select(`
        id,
        lead_customer_id,
        departure_date,
        travel_packages!package_id (
          destination,
          duration_days
        )
      `)
      .not('departure_date', 'is', null)
      .eq('status', 'fully_paid');

    if (fetchErr) throw fetchErr;

    type BookingRow = typeof bookings extends (infer T)[] | null ? T : never;
    const returned = (bookings ?? []).filter((b: BookingRow) => {
      const depDate = (b as { departure_date: string | null }).departure_date;
      if (!depDate) return false;

      const rawPkg = (b as { travel_packages: unknown }).travel_packages;
      const pkg = Array.isArray(rawPkg) ? rawPkg[0] : rawPkg;
      const durationDays = (pkg as { duration_days?: number } | null)?.duration_days ?? 0;
      if (durationDays === 0) return false;

      const dep = new Date(depDate);
      dep.setDate(dep.getDate() + durationDays - 1);
      return dep.toISOString().split('T')[0] === today;
    });

    const slackWebhookUrl = getSecret('SLACK_WEBHOOK_URL');
    let slackSent = 0;

    for (const booking of returned) {
      const pkg = Array.isArray(booking.travel_packages)
        ? booking.travel_packages[0]
        : booking.travel_packages;
      const dest =
        (pkg as { destination?: string } | null)?.destination ?? 'unknown destination';
      const customerId = (booking as { lead_customer_id?: string | null }).lead_customer_id;
      const customerRef = customerId ? customerId.slice(0, 8) : 'unknown';

      await supabaseAdmin.from('message_logs').insert({
        booking_id: booking.id,
        event_type: 'REELS_PROMPT',
        channel: 'system',
        content: `[reels prompt] Send reels-start guidance for completed ${dest} trip.`,
        status: 'logged',
      });

      if (slackWebhookUrl) {
        try {
          await fetch(slackWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: `🎬 *Post-travel reels target* | booking \`${booking.id}\`\ncustomer: ${customerRef} | destination: ${dest}\nSend reels-start guidance via magic link.`,
            }),
          });
          slackSent++;
        } catch (slackErr) {
          console.warn('[post-travel-reels] Slack send failed:', sanitizeDbError(slackErr));
        }
      }
    }

    return apiResponse({
      ok: true,
      processed: returned.length,
      slackSent,
      date: today,
    });
  } catch (err) {
    const message = sanitizeDbError(err);
    console.error('[post-travel-reels cron] error:', message);
    await sendSlackAlert(`[post-travel-reels] cron error: ${message}`);
    return apiResponse({ error: message }, { status: 500 });
  }
}
