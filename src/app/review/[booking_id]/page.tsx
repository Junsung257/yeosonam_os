import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { notFound } from 'next/navigation';
import ReviewForm from './ReviewForm';

export const dynamic = 'force-dynamic';

async function getBookingInfo(bookingId: string) {
  if (!isSupabaseConfigured) return null;

  const { data } = await supabaseAdmin
    .from('bookings')
    .select('id, product_id, lead_customer_id, status, travel_packages(title, destination)')
    .eq('id', bookingId)
    .limit(1);

  if (!data?.[0]) return null;

  // 이미 제출된 후기?
  const { data: existing } = await supabaseAdmin
    .from('post_trip_reviews')
    .select('id')
    .eq('booking_id', bookingId)
    .limit(1);

  return {
    booking: data[0] as any,
    hasReview: (existing?.length ?? 0) > 0,
  };
}

export default async function ReviewPage({ params }: { params: Promise<{ booking_id: string }> }) {
  const { booking_id } = await params;
  const info = await getBookingInfo(booking_id);
  if (!info) notFound();

  const pkg = info.booking.travel_packages;

  if (info.hasReview) {
    return (
      <main className="min-h-screen bg-[#faf6f0] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl p-8 text-center shadow-sm">
          <div className="text-5xl mb-3">✅</div>
          <h1 className="text-[20px] font-bold text-slate-800">이미 후기를 작성하셨어요</h1>
          <p className="mt-2 text-[13px] text-slate-500">
            소중한 후기 감사합니다. 여소남 운영팀이 곧 승인 후 다른 고객님께 도움이 되도록 노출할게요.
          </p>
          <a href="/" className="mt-5 inline-block text-[13px] text-[#3182F6] hover:underline">
            여소남 홈으로 →
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#faf6f0]">
      <div className="mx-auto max-w-2xl px-4 py-8 md:py-12">
        <h1 className="text-[24px] md:text-[28px] font-extrabold text-slate-900">
          여행은 어떠셨나요?
        </h1>
        <p className="mt-2 text-[13px] text-slate-500">
          다른 여행자분들께 큰 도움이 됩니다. 솔직한 후기 부탁드려요.
        </p>

        {pkg && (
          <div className="mt-5 p-4 bg-white border border-slate-200 rounded-xl flex items-center gap-4">
            <div>
              <p className="text-[11px] text-slate-400">{pkg.destination}</p>
              <h2 className="text-[14px] font-bold text-slate-800 line-clamp-2">{pkg.title}</h2>
            </div>
          </div>
        )}

        <ReviewForm bookingId={booking_id} />
      </div>
    </main>
  );
}
