import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import Stars from './Stars';

/**
 * 상품 상세 / 블로그 하단에 붙이는 리뷰 섹션
 * - AggregateRating 요약 + 개별 리뷰 최대 5개
 * - status='approved' 만 표시
 * - Schema.org Review 자동 포함
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
  created_at: string;
  customers: { name: string | null } | null;
}

export default async function ReviewsSection({ packageId, limit = 5 }: Props) {
  if (!isSupabaseConfigured) return null;

  const { data: pkg } = await supabaseAdmin
    .from('travel_packages')
    .select('avg_rating, review_count, title')
    .eq('id', packageId)
    .limit(1);

  const stats = pkg?.[0] as { avg_rating: number | null; review_count: number; title: string } | undefined;
  if (!stats?.avg_rating || stats.review_count === 0) return null;

  const { data: reviews } = await supabaseAdmin
    .from('post_trip_reviews')
    .select('id, overall_rating, value_for_money, itinerary_quality, guide_quality, accommodation_quality, food_quality, title, review_text, pros, helpful_count, created_at, customers(name)')
    .eq('package_id', packageId)
    .eq('status', 'approved')
    .order('helpful_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  const rows = (reviews as unknown as ReviewRow[]) || [];
  if (rows.length === 0) return null;

  const avg = Number(stats.avg_rating);

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

      <header className="mb-5">
        <h2 className="text-[18px] md:text-[22px] font-bold text-slate-900">
          ⭐ 고객 후기
        </h2>
        <div className="mt-2 flex items-center gap-3">
          <Stars rating={avg} size="lg" showNumber count={stats.review_count} />
        </div>
      </header>

      <div className="space-y-3">
        {rows.map(r => {
          const name = r.customers?.name?.charAt(0) ? `${r.customers.name.charAt(0)}**` : '고객';
          return (
            <article key={r.id} className="p-4 bg-white border border-slate-200 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <Stars rating={r.overall_rating} size="sm" />
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
