'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getRecentViews, getSimilarPackages } from '@/lib/user-actions';

interface RecentPkg {
  id: string;
  title: string;
  destination: string;
  price: number;
}

interface Props {
  customerId?: string | null;
  sessionId?: string | null;
  /** 특정 패키지 상세 페이지에서 호출 시 유사 상품 표시 */
  currentPackageId?: string;
}

export default function RecentViews({ customerId, sessionId, currentPackageId }: Props) {
  const [packages, setPackages] = useState<RecentPkg[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<'recent' | 'similar'>('recent');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      if (currentPackageId) {
        // 상세 페이지: 패키지 조회 트래킹 (마운트 시 1회)
        const { trackUserAction } = await import('@/lib/user-actions');
        trackUserAction({
          customerId,
          sessionId: sessionId || crypto.randomUUID(),
          actionType: 'package_view',
          targetId: currentPackageId,
        }).catch(() => {});

        // 유사 상품 조회
        const similar = await getSimilarPackages(currentPackageId, { limit: 6 });
        if (!cancelled) {
          setPackages(similar);
          setType('similar');
        }
      } else {
        // 일반: 최근 본 상품
        const ids = await getRecentViews({ customerId, sessionId, limit: 6 });
        if (ids.length > 0 && !cancelled) {
          // ID → 패키지 데이터
          const { supabaseAdmin } = await import('@/lib/supabase');
          const { data } = await supabaseAdmin
            .from('travel_packages')
            .select('id, title, destination, price')
            .in('id', ids)
            .in('status', ['active', 'approved']);
          // IDs 순서 유지
          const idOrder = new Map(ids.map((id, i) => [id, i]));
          const sorted = ((data ?? []) as RecentPkg[]).sort(
            (a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999),
          );
          setPackages(sorted);
        }
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [customerId, sessionId, currentPackageId]);

  if (loading) return null;
  if (packages.length === 0) return null;

  return (
    <section className="px-4 mt-6">
      <h2 className="text-[16px] font-bold text-text-primary mb-3">
        {type === 'similar' ? '이 상품과 비슷한 여행' : '최근 본 상품'}
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4 snap-x snap-mandatory">
        {packages.map((pkg) => (
          <Link
            key={pkg.id}
            href={`/packages/${pkg.id}`}
            className="flex-shrink-0 w-[160px] snap-start rounded-xl border border-gray-200 bg-white p-3 hover:border-brand/40 hover:shadow-sm transition-all card-touch"
          >
            <p className="text-[11px] font-semibold text-text-body mb-1 line-clamp-1">
              {pkg.destination}
            </p>
            <p className="text-[13px] font-bold text-text-primary leading-snug line-clamp-2 mb-2 min-h-[2.5em]">
              {pkg.title}
            </p>
            <p className="text-[14px] font-extrabold text-brand tabular-nums">
              ₩{pkg.price?.toLocaleString() ?? '가격 문의'}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
