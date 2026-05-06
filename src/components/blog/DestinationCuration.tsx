import Link from 'next/link';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';

/**
 * 정보성 블로그 하단 상품 큐레이션
 *
 * 전략 (85% 정보 + 15% 상품):
 *  - 가격 분산 — 가성비 / 중가 / 럭셔리 1개씩 노출
 *  - 소프트 CTA 언어 ("관심 있으시면 둘러보세요")
 *  - 광고 아닌 "큐레이션" 톤 — Google Helpful Content 친화
 *
 * 자동 매칭:
 *  - 같은 destination 의 활성 상품 3개 (가격 오름차순)
 *  - 출발일 살아있는 것만 (데드 상품 필터)
 */

interface CuratedProduct {
  id: string;
  title: string;
  destination: string;
  duration: number | null;
  nights?: number | null;
  price: number | null;
  category?: string | null;
  hero_image_url?: string | null;
  airline?: string | null;
  departure_airport?: string | null;
}

interface Props {
  destination: string;
  products: CuratedProduct[];
}

function priceTierLabel(price: number | null, minPrice: number, maxPrice: number): string {
  if (!price) return '큐레이션';
  const spread = maxPrice - minPrice;
  if (spread < 100000) return '추천';
  const ratio = (price - minPrice) / spread;
  if (ratio < 0.34) return '가성비';
  if (ratio < 0.67) return '중가';
  return '프리미엄';
}

export default function DestinationCuration({ destination, products }: Props) {
  if (!products || products.length === 0) return null;

  const prices = products.map(p => p.price || 0).filter(p => p > 0);
  const minP = Math.min(...prices, 0);
  const maxP = Math.max(...prices, 0);

  return (
    <section className="my-10 p-5 md:p-6 bg-gradient-to-br from-slate-50 to-brand-light/40 border border-slate-200 rounded-2xl">
      <header className="mb-5">
        <p className="text-[11px] font-semibold text-brand tracking-wider uppercase mb-1">
          여소남이 추천하는
        </p>
        <h3 className="text-[18px] md:text-[20px] font-bold text-slate-800">
          🧳 {destination} 여행 큐레이션
        </h3>
        <p className="text-[12px] md:text-[13px] text-slate-500 mt-1.5 leading-relaxed">
          이 글이 도움되셨다면, 운영팀이 검증한 {destination} 상품도 둘러보세요.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {products.slice(0, 3).map(p => {
          const priceKr = p.price ? `${Math.round(p.price / 10000).toLocaleString()}만원~` : null;
          const dur = p.duration ? `${(p.nights ?? p.duration - 1)}박${p.duration}일` : null;
          const tier = priceTierLabel(p.price, minP, maxP);

          return (
            <Link
              key={p.id}
              href={`/packages/${p.id}`}
              className="group relative flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden hover:border-brand/40 hover:shadow-md transition"
            >
              {/* 이미지 */}
              <div className="relative aspect-[4/3] bg-slate-100 overflow-hidden">
                <SafeCoverImg
                  src={p.hero_image_url}
                  alt={`${p.destination} ${p.title}`}
                  className="absolute inset-0 h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                  loading="lazy"
                  fallback={
                    <div className="absolute inset-0 flex items-center justify-center text-slate-300 text-4xl">
                      🌍
                    </div>
                  }
                />
                <span className="absolute top-2 left-2 px-2 py-0.5 text-[10px] font-bold rounded-full bg-white/90 text-slate-700">
                  {tier}
                </span>
              </div>

              {/* 텍스트 */}
              <div className="flex-1 flex flex-col p-3">
                <h4 className="text-[13px] font-bold text-slate-800 leading-snug line-clamp-2 min-h-[2.8em]">
                  {p.title}
                </h4>
                <div className="flex gap-1.5 mt-1.5 flex-wrap text-[10px] text-slate-500">
                  {dur && <span>{dur}</span>}
                  {p.airline && <span>· {p.airline}</span>}
                  {p.departure_airport && <span>· {p.departure_airport}</span>}
                </div>
                <div className="mt-auto pt-3 flex items-end justify-between">
                  {priceKr && (
                    <span className="text-[16px] font-extrabold text-orange-600 tabular-nums">
                      {priceKr}
                    </span>
                  )}
                  <span className="text-[11px] text-brand font-semibold group-hover:underline">
                    자세히 →
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <p className="mt-4 text-center text-[11px] text-slate-400">
        💬 이 글이 도움되셨다면 <a href="https://pf.kakao.com/_yeosonam" target="_blank" rel="noopener" className="text-brand hover:underline font-semibold">카톡으로 문의</a>도 환영합니다.
      </p>
    </section>
  );
}
