import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import ReviewForm from './ReviewForm';

export const dynamic = 'force-dynamic';

async function getBookingInfo(bookingId: string) {
  if (!isSupabaseConfigured) return null;

  interface BookingWithPackage {
    id: string;
    product_id: string | null;
    lead_customer_id: string | null;
    status: string | null;
    travel_packages: { title: string | null; destination: string | null } | null;
  }

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
    booking: data[0] as unknown as BookingWithPackage,
    hasReview: (existing?.length ?? 0) > 0,
  };
}

export async function generateMetadata({ params }: { params: Promise<{ booking_id: string }> }): Promise<Metadata> {
  const { booking_id } = await params;
  if (!isSupabaseConfigured) {
    return { title: '후기 작성 | 여소남' };
  }

  const { data } = await supabaseAdmin
    .from('bookings')
    .select('travel_packages(title)')
    .eq('id', booking_id)
    .limit(1);

  const pkg = data?.[0]?.travel_packages as { title?: string } | null;
  const title = pkg?.title ? `${pkg.title} 후기 | 여소남` : '후기 작성 | 여소남';

  return {
    title,
    description: '여소남 여행 후기를 작성해주세요. 다른 여행자분들께 큰 도움이 됩니다.',
    openGraph: {
      title,
      description: '여소남 여행 후기를 작성해주세요.',
    },
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
          <Link href="/" className="mt-5 inline-block text-[13px] text-brand hover:underline">
            여소남 홈으로 →
          </Link>
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
