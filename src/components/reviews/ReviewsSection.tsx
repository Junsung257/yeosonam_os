import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import Stars from './Stars';

/**
 * 상품 상세 페이지 고객 후기 섹션
 *
 * 확장 전략 (source_type):
 *   admin_seeded      — 어드민이 카카오/이메일 피드백에서 수동 입력 (현재 단계)
 *   verified_booking  — 예약 완료 고객이 직접 작성 (고객 계정 생성 후 활성화)
 *   platform_import   — 외부 플랫폼 임포트 (미래)
 *
 * 리뷰 0개: 빈 상태 UI 표시 (섹션 숨김 X)
 * 리뷰 있음: 별점 집계 + 리뷰 카드 + Schema.org 마크업
 */

interface Props {
  packageId: string;
  limit?: number;
}

interface ReviewRow {
  id: string;
  overall_rating: number;
  value_for_money: number | null;
  itinerary_quality: number | null;
  guide_quality: number | null;
  accommodation_quality: number | null;
  food_quality: number | null;
  title: string | null;
  review_text: string | null;
  pros: string[] | null;
  helpful_count: number;
  source_type: string;
  created_at: string;
  customers: { name: string | null } | null;
}

function SourceBadge({ sourceType }: { sourceType: string }) {
  if (sourceType === 'verified_booking') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] rounded font-medium border border-emerald-100">
        ✓ 예약 확인
      </span>
    );
  }
  if (sourceType === 'admin_seeded') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[10px] rounded font-medium border border-blue-100">
        💬 카카오 후기
      </span>
    );
  }
  return null;
}

function EmptyReviewsState() {
  return (
    <section className="my-10">
      <header className="mb-5">
        <h2 className="text-[18px] md:text-[22px] font-bold text-slate-900">
          ⭐ 고객 후기
        </h2>
      </header>
      <div className="bg-slate-50 border border-slate-200 border-dashed rounded-2xl p-8 text-center">
        <div className="flex justify-center gap-0.5 mb-3">
          {[1,2,3,4,5].map(i => (
            <svg key={i} className="w-7 h-7 text-slate-200" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
          ))}
        </div>
        <p className="text-slate-700 font-semibold text-[15px] mb-1.5">첫 번째 후기를 기다리고 있어요</p>
        <p className="text-slate-400 text-[13px] leading-relaxed">
          이 여행을 다녀오신 분들의 솔직한 후기가<br />다음 여행자에게 큰 도움이 됩니다
        </p>
      </div>
    </section>
  );
}

export default async function ReviewsSection({ packageId, limit = 5 }: Props) {
  if (!isSupabaseConfigured) return null;

  const { data: pkg } = await supabaseAdmin
    .from('travel_packages')
    .select('avg_rating, review_count, title')
    .eq('id', packageId)
    .limit(1);

  const stats = pkg?.[0] as { avg_rating: number | null; review_count: number; title: string } | undefined;

  // 리뷰 없으면 빈 상태 UI
  if (!stats?.avg_rating || stats.review_count === 0) {
    return <EmptyReviewsState />;
  }

  const { data: reviews } = await supabaseAdmin
    .from('post_trip_reviews')
    .select('id, overall_rating, value_for_money, itinerary_quality, guide_quality, accommodation_quality, food_quality, title, review_text, pros, helpful_count, source_type, created_at, customers(name)')
    .eq('package_id', packageId)
    .eq('status', 'approved')
    .order('helpful_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  const rows = (reviews as unknown as ReviewRow[]) || [];
  if (rows.length === 0) return <EmptyReviewsState />;

  const avg = Number(stats.avg_rating);

  // 세부 카테고리 평균
  const withRatings = rows.filter(r => r.value_for_money || r.itinerary_quality || r.guide_quality || r.accommodation_quality || r.food_quality);
  const catAvg = (key: keyof ReviewRow) => {
    const vals = withRatings.map(r => r[key]).filter((v): v is number => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const categoryRatings = [
    { label: '가성비', value: catAvg('value_for_money') },
    { label: '일정', value: catAvg('itinerary_quality') },
    { label: '가이드', value: catAvg('guide_quality') },
    { label: '숙박', value: catAvg('accommodation_quality') },
    { label: '식사', value: catAvg('food_quality') },
  ].filter(c => c.value !== null) as { label: string; value: number }[];

  return (
    <section className="my-10">
      {/* Schema.org AggregateRating + Review */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: stats.title,
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: avg.toFixed(2),
              reviewCount: stats.review_count,
              bestRating: 5,
              worstRating: 1,
            },
            review: rows.slice(0, 5).map(r => ({
              '@type': 'Review',
              reviewRating: { '@type': 'Rating', ratingValue: r.overall_rating, bestRating: 5 },
              author: { '@type': 'Person', name: r.customers?.name?.charAt(0) ? `${r.customers.name.charAt(0)}**` : '고객' },
              datePublished: r.created_at,
              ...(r.review_text ? { reviewBody: r.review_text } : {}),
              ...(r.title ? { name: r.title } : {}),
            })),
          }),
        }}
      />

      {/* 헤더 — 별점 집계 */}
      <header className="mb-5">
        <h2 className="text-[18px] md:text-[22px] font-bold text-slate-900">
          ⭐ 고객 후기
        </h2>
        <div className="mt-3 flex items-start gap-4">
          <div className="text-center">
            <div className="text-4xl font-black text-slate-900">{avg.toFixed(1)}</div>
            <Stars rating={avg} size="sm" />
            <div className="text-[11px] text-slate-400 mt-1">{stats.review_count}개 후기</div>
          </div>
          {categoryRatings.length > 0 && (
            <div className="flex-1 space-y-1.5 pt-1">
              {categoryRatings.map(c => (
                <div key={c.label} className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500 w-10 shrink-0">{c.label}</span>
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand rounded-full transition-all"
                      style={{ width: `${(c.value / 5) * 100}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-bold text-slate-700 tabular-nums w-6 text-right">{c.value.toFixed(1)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* 리뷰 카드 목록 */}
      <div className="space-y-3">
        {rows.map(r => {
          const name = r.customers?.name?.charAt(0) ? `${r.customers.name.charAt(0)}**` : '고객';
          return (
            <article key={r.id} className="p-4 bg-white border border-slate-200 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Stars rating={r.overall_rating} size="sm" />
                  <SourceBadge sourceType={r.source_type} />
                </div>
                <span className="text-[11px] text-slate-400">
                  {new Date(r.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' })}
                </span>
              </div>
              {r.title && (
                <h3 className="text-[14px] font-bold text-slate-800 mb-1.5">{r.title}</h3>
              )}
              {r.review_text && (
                <p className="text-[13px] text-slate-600 leading-relaxed whitespace-pre-wrap">
                  {r.review_text}
                </p>
              )}
              {r.pros && r.pros.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {r.pros.slice(0, 4).map((p, i) => (
                    <li key={i} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[11px] rounded">
                      👍 {p}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                <span>{name} 고객님</span>
                {r.helpful_count > 0 && <span>💚 도움됨 {r.helpful_count}</span>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
