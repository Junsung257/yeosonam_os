import { supabaseAdmin, isSupabaseConfigured, getVoucherByBooking } from '@/lib/supabase';
import { verifyGuidebookToken } from '@/lib/guidebook-token';
import GuideTimeline from './GuideTimeline';
import { renderVoucherHtml } from '@/lib/voucher-generator';

interface DayPlan {
  day: number;
  date: string;
  title: string;
  move: string;
  highlight: string;
  hotels: Array<{
    type: 'recommended' | 'alternative';
    name: string;
    pricePerNight: number;
    location?: string;
    reason: string;
    affiliateLink?: string;
  }>;
  activities: Array<{
    title: string;
    price: number;
    reason: string;
    affiliateLink?: string;
  }>;
}

function fallbackDayPlansFromVoucher(voucher: any): DayPlan[] {
  const itinerary = voucher?.parsed_data?.itinerary;
  if (!Array.isArray(itinerary)) return [];
  return itinerary.map((item: any, idx: number) => ({
    day: Number(item.day ?? idx + 1),
    date: item.date ?? '',
    title: item.title ?? '자유일정',
    move: item.description ?? '현지 이동',
    highlight: '가이드북 자동 생성 일정',
    hotels: item.hotel
      ? [{
          type: 'recommended' as const,
          name: item.hotel,
          pricePerNight: 0,
          reason: '확정서 기반 숙소 정보',
        }]
      : [],
    activities: [],
  }));
}

export default async function MobileGuidePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const payload = verifyGuidebookToken(token);

  if (!payload || !isSupabaseConfigured || !supabaseAdmin) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-5 text-center">
          <p className="text-sm font-semibold text-slate-900">만료되었거나 잘못된 가이드북입니다.</p>
          <p className="mt-1 text-xs text-slate-500">고객센터로 재발급을 요청해주세요.</p>
        </div>
      </div>
    );
  }

  const voucher = await getVoucherByBooking(payload.bookingId);
  const voucherHtml = voucher ? renderVoucherHtml(voucher.parsed_data) : null;

  let dayPlans: DayPlan[] = [];
  if (payload.sessionId) {
    const { data } = await supabaseAdmin
      .from('free_travel_sessions')
      .select('plan_json')
      .eq('id', payload.sessionId)
      .limit(1)
      .maybeSingle();
    const fromSession = data?.plan_json as { dayPlans?: DayPlan[] } | null;
    dayPlans = fromSession?.dayPlans ?? [];
  }

  if (dayPlans.length === 0 && voucher) {
    dayPlans = fallbackDayPlansFromVoucher(voucher);
  }

  return (
    <GuideTimeline
      dayPlans={dayPlans}
      voucher={voucher ? { title: '예약 바우처', html: voucherHtml } : null}
    />
  );
}
