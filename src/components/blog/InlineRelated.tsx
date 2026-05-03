import Link from 'next/link';

export interface RelatedProductLite {
  id: string;
  title: string;
  destination: string | null;
  price: number | null;
  duration: number | string | null;
  nights: number | null;
  airline: string | null;
  departure_airport?: string | null;
}

export interface RelatedPostLite {
  slug: string;
  seo_title: string | null;
  destination?: string | null;
}

interface Props {
  destination?: string | null;
  relatedProducts?: RelatedProductLite[];
  relatedPosts?: RelatedPostLite[];
}

function formatDur(duration: number | string | null | undefined, nights: number | null | undefined): string {
  if (!duration && !nights) return '';
  const d = typeof duration === 'string' ? parseInt(duration, 10) : duration;
  const dNum = typeof d === 'number' && !Number.isNaN(d) ? d : null;
  if (nights && dNum) return `${nights}박${dNum}일`;
  if (dNum) return `${dNum}일`;
  if (typeof duration === 'string' && duration.trim()) return duration.trim();
  return '';
}

function cleanTitle(s: string | null | undefined): string {
  return (s || '').replace(/\s*\|\s*여소남(\s*\d{4})?\s*$/g, '').trim();
}

/**
 * 본문 중간에 주입되는 인라인 관련 콘텐츠 카드.
 * 기존 글 DB를 수정하지 않고 렌더 타임에 H2 사이로 끼워 넣는 방식으로 동작한다.
 * "허브 & 스포크" 내부 링크 전략 + 체류시간/탐색 깊이 증대 목적.
 */
export default function InlineRelated({ destination, relatedProducts = [], relatedPosts = [] }: Props) {
  const products = relatedProducts.slice(0, 3);
  const posts = relatedPosts.slice(0, 2);

  if (products.length === 0 && posts.length === 0) return null;

  return (
    <aside
      className="not-prose my-12 rounded-2xl border border-[#DBEAFE] bg-gradient-to-br from-[#EBF3FE]/50 to-[#F0F7FF]/30 p-5 md:p-6"
      aria-label="함께 보면 좋은 여행"
    >
      <div className="mb-4 flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#3182F6] text-xs font-bold text-white"
        >
          +
        </span>
        <h2 className="text-sm font-bold text-[#191F28]">
          {destination ? `${destination} 더 살펴보기` : '함께 보면 좋아요'}
        </h2>
      </div>

      {products.length > 0 && (
        <div className={posts.length > 0 ? 'mb-5' : ''}>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            같은 목적지 다른 패키지
          </p>
          <ul className="grid gap-2">
            {products.map((p) => {
              const dur = formatDur(p.duration, p.nights);
              const dep = p.departure_airport?.replace(/\(.*?\)/g, '').trim();
              const meta = [p.destination, dur, dep, p.airline].filter(Boolean).join(' · ');
              return (
                <li key={p.id}>
                  <Link
                    href={`/packages/${p.id}`}
                    className="group flex items-center justify-between gap-3 rounded-xl border border-white bg-white/90 p-3 backdrop-blur transition hover:border-[#DBEAFE] hover:shadow-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 text-sm font-semibold text-gray-900 group-hover:text-[#3182F6]">
                        {p.title}
                      </p>
                      {meta && <p className="mt-1 line-clamp-1 text-xs text-gray-500">{meta}</p>}
                    </div>
                    {p.price ? (
                      <span className="shrink-0 text-sm font-bold text-[#3182F6]">
                        {(p.price / 10000).toFixed(0)}만원~
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-gray-400" aria-hidden="true">
                        →
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {posts.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            함께 읽으면 좋은 글
          </p>
          <ul className="space-y-1.5">
            {posts.map((p) => {
              const t = cleanTitle(p.seo_title);
              if (!t) return null;
              return (
                <li key={p.slug}>
                  <Link
                    href={`/blog/${p.slug}`}
                    className="group inline-flex items-start gap-1.5 text-[13.5px] text-gray-700 hover:text-[#3182F6]"
                  >
                    <span aria-hidden="true" className="mt-0.5 text-[#3182F6]/60 group-hover:text-[#3182F6]">
                      →
                    </span>
                    <span className="line-clamp-1 group-hover:underline">{t}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </aside>
  );
}
