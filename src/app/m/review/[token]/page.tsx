/**
 * 리뷰·후기 제출 페이지 — `/m/review/[token]`.
 *
 * 동작:
 *   1. magic-session 검증 + scope='review:submit'
 *   2. 별점(1-5) + 텍스트 + 사진 최대 5장 업로드
 *   3. 사진은 customer-uploads 버킷 (private)
 *   4. 결과는 magic_action_tokens.metadata.review 에 저장 (별점·텍스트·파일 path 리스트)
 *
 * reusable 토큰 가능 — 같은 사람이 사진 추가/수정. 토큰 자체는 30일 reusable 권장.
 */

import { cookies } from 'next/headers';
import { MAGIC_SESSION_COOKIE, verifyMagicSessionToken } from '@/lib/magic-session';
import { supabaseAdmin } from '@/lib/supabase';
import JarvisSidekick from '@/components/jarvis/JarvisSidekick';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: '여행 후기 작성',
  robots: { index: false, follow: false },
};

type PageParams = { params: Promise<{ token: string }> };

interface ReviewMeta {
  rating?: number;
  text?: string;
  photos?: { path: string; size: number; contentType: string }[];
  submitted_at?: string;
}

interface BookingRow {
  destination?: string | null;
  departure_date?: string | null;
  customers?: { name?: string | null } | null;
}

export default async function ReviewPage({ params }: PageParams) {
  const { token: tokenIdFromUrl } = await params;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(MAGIC_SESSION_COOKIE)?.value;
  const session = verifyMagicSessionToken(sessionCookie);

  if (!session.ok) return <Err msg="안내 메시지의 링크를 다시 눌러 주세요." />;
  if (session.payload.aid !== tokenIdFromUrl) return <Err msg="다른 안내 링크로 접근하셨어요." />;
  if (!session.payload.scope.includes('review:submit')) return <Err msg="이 링크로는 후기를 작성할 수 없어요." />;
  if (session.payload.act !== 'review_request') return <Err msg="이 링크는 후기용이 아니에요." />;

  const { data } = await supabaseAdmin
    .from('magic_action_tokens')
    .select('metadata, used_at, booking_id')
    .eq('id', tokenIdFromUrl)
    .limit(1);
  const row = data?.[0] as { metadata: Record<string, unknown> | null; used_at: string | null; booking_id: string | null } | undefined;
  if (!row) return <Err msg="안내 정보를 찾을 수 없어요." />;

  const review = (row.metadata?.review ?? {}) as ReviewMeta;

  // booking 컨텍스트 (사이드킥용)
  let booking: BookingRow | null = null;
  if (row.booking_id) {
    const { data: bData } = await supabaseAdmin
      .from('bookings')
      .select('destination, departure_date, customers:lead_customer_id(name)')
      .eq('id', row.booking_id)
      .limit(1);
    booking = (bData?.[0] as BookingRow | undefined) ?? null;
  }

  return (
    <main className="min-h-screen bg-gray-50 pb-12">
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="text-xs text-gray-500 mb-1">여소남</div>
        <h1 className="text-xl font-bold text-gray-900">여행 후기를 남겨 주세요</h1>
        <p className="text-xs text-gray-500 mt-1">
          소중한 경험을 다른 여행자와 나누실 수 있어요. 사진과 함께 공유하실 수 있습니다.
        </p>
      </header>

      <form
        method="POST"
        action={`/api/m/review/${encodeURIComponent(tokenIdFromUrl)}`}
        encType="multipart/form-data"
        className="mt-2 bg-white px-4 py-5 space-y-5"
      >
        {/* 별점 */}
        <div>
          <label className="block text-xs text-gray-600 mb-2">별점</label>
          <div className="flex gap-2" role="radiogroup" aria-label="별점">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="flex-1 relative">
                <input
                  type="radio"
                  name="rating"
                  value={n}
                  defaultChecked={review.rating === n}
                  required
                  className="peer sr-only"
                />
                <span className="block text-center bg-gray-100 hover:bg-gray-200 peer-checked:bg-amber-100 peer-checked:ring-2 peer-checked:ring-amber-500 rounded-xl py-3 cursor-pointer text-lg">
                  {'★'.repeat(n)}{'☆'.repeat(5 - n)}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* 후기 텍스트 */}
        <div>
          <label htmlFor="text" className="block text-xs text-gray-600 mb-1.5">
            후기 내용
          </label>
          <textarea
            id="text"
            name="text"
            rows={5}
            defaultValue={review.text ?? ''}
            placeholder="좋았던 점, 아쉬웠던 점, 다른 분께 추천하고 싶은 포인트 등 자유롭게 적어 주세요."
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            maxLength={1500}
          />
        </div>

        {/* 사진 업로드 */}
        <div>
          <label htmlFor="photos" className="block text-xs text-gray-600 mb-1.5">
            사진 (선택, 최대 5장 · 장당 10MB)
          </label>
          <input
            id="photos"
            name="photos"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            className="block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-gray-900 file:text-white file:font-semibold hover:file:bg-gray-800"
          />
          {review.photos && review.photos.length > 0 && (
            <p className="text-[11px] text-gray-500 mt-1.5">
              이미 {review.photos.length}장 첨부됨 (추가 업로드 시 누적)
            </p>
          )}
        </div>

        <button
          type="submit"
          className="w-full bg-gray-900 text-white rounded-2xl py-4 font-semibold text-base hover:bg-gray-800"
        >
          후기 제출하기
        </button>

        <p className="text-[11px] text-gray-500 leading-relaxed">
          제출하신 후기와 사진은 여소남 마케팅 콘텐츠 및 다른 여행자 안내 자료에 활용될 수 있어요.
          민감한 개인 정보가 사진에 포함되지 않도록 확인 후 업로드해 주세요.
        </p>
      </form>

      {review.submitted_at && (
        <div className="mx-4 mt-4 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          ✓ 이미 후기를 남겨주셨어요 ({new Date(review.submitted_at).toLocaleString('ko-KR')}). 추가 사진을 올리시면 함께 보관됩니다.
        </div>
      )}

      {/* 사이드킥 */}
      <JarvisSidekick
        context={{
          bookingNo: null,
          bookingDestination: booking?.destination ?? null,
          bookingDepartureDate: booking?.departure_date ?? null,
          customerName: booking?.customers?.name ?? null,
          actionLabel: '후기 작성 도움',
          actionType: 'review_request',
        }}
        quickReplies={['어떤 내용을 적으면 좋을까요?', '사진 어떻게 선택할까요?']}
      />
    </main>
  );
}

function Err({ msg }: { msg: string }) {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 p-6 text-center">
        <div className="text-sm text-gray-500 mb-2">여소남</div>
        <h1 className="text-xl font-bold text-gray-900 mb-3">접근할 수 없어요</h1>
        <p className="text-sm text-gray-600 leading-relaxed">{msg}</p>
      </div>
    </main>
  );
}
