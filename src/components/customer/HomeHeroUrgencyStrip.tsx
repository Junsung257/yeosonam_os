import Link from 'next/link';

export type HomeUrgencyTeaser = {
  id: string;
  title: string;
  destination?: string;
  minPrice: number;
};

/** 홈 히어로 카드 하단 — RSC로 두어 검색 클러스터 클라이언트 번들에서 분리 */
export function HomeHeroUrgencyStrip({ items }: { items: HomeUrgencyTeaser[] }) {
  if (items.length === 0) return null;

  return (
    <div className="mt-5 pt-4 border-t border-admin-border space-y-3">
      <p className="text-[13px] font-bold text-text-primary flex items-center gap-1.5">
        <span aria-hidden>🔥</span>
        이번 주 마감·특가 TOP {items.length}
      </p>
      <ul className="space-y-2">
        {items.map(item => (
          <li key={item.id}>
            <Link
              href={`/packages/${item.id}`}
              className="flex items-start gap-3 rounded-xl border border-[#E8ECF2] bg-[#FAFBFF] px-3 py-3 hover:border-brand/40 transition-colors card-touch"
            >
              <div className="min-w-0 flex-1">
                <p className="text-body font-bold text-text-primary leading-snug line-clamp-2">{item.title}</p>
                {item.destination ? (
                  <p className="text-[11px] text-text-secondary mt-0.5">{item.destination}</p>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[13px] font-extrabold text-brand tabular-nums">
                  {item.minPrice.toLocaleString()}원~
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
