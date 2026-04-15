import { supabaseAdmin } from '@/lib/supabase';
import { sendAffiliateBookingCelebration } from '@/lib/kakao';

const CONFIRMED_STATUSES = ['confirmed', 'completed', 'fully_paid', 'deposit_paid'];

export async function notifyAffiliateOnBooking(booking: {
  id: string;
  affiliate_id?: string | null;
  status?: string;
  total_price?: number;
  influencer_commission?: number;
  package_title?: string;
  self_referral_flag?: boolean;
}): Promise<void> {
  if (!booking.affiliate_id) return;
  if (booking.self_referral_flag) return;
  if (!booking.status || !CONFIRMED_STATUSES.includes(booking.status)) return;

  const { data: aff } = await supabaseAdmin
    .from('affiliates')
    .select('name, phone')
    .eq('id', booking.affiliate_id)
    .maybeSingle();

  if (!aff?.phone) return;

  const { data: existing } = await supabaseAdmin
    .from('message_logs')
    .select('id')
    .eq('booking_id', booking.id)
    .eq('log_type', 'affiliate_celebration')
    .maybeSingle();
  if (existing) return;

  try {
    await sendAffiliateBookingCelebration({
      phone: aff.phone,
      affiliateName: aff.name || '파트너',
      packageTitle: booking.package_title || '여행 상품',
      totalPrice: booking.total_price || 0,
      commission: booking.influencer_commission || 0,
    });
    await supabaseAdmin.from('message_logs').insert({
      booking_id: booking.id,
      log_type: 'affiliate_celebration',
      event_type: 'AFFILIATE_BOOKING_CELEBRATION' as any,
      title: `어필리에이터 축하 알림 - ${aff.name}`,
      content: `매출 ${(booking.total_price || 0).toLocaleString()}원 / 수수료 ${(booking.influencer_commission || 0).toLocaleString()}원`,
      is_mock: !process.env.KAKAO_TEMPLATE_AFFILIATE_CELEBRATION,
      created_by: 'system',
    } as any).then(() => {}).catch(() => {});
  } catch (err) {
    console.error('[축하 알림 실패]', err);
  }
}
