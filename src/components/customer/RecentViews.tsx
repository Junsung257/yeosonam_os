'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

interface RecentPkg {
  id: string;
  title: string;
  destination: string;
  price: number | null;
}

interface Props {
  customerId?: string | null;
  sessionId?: string | null;
  currentPackageId?: string;
}

function getBrowserSessionId(): string {
  const key = 'ysn_session_id';
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function formatPrice(price: number | null): string {
  return typeof price === 'number' && Number.isFinite(price)
    ? `${price.toLocaleString('ko-KR')}원`
    : '가격 문의';
}

export default function RecentViews({ customerId, sessionId, currentPackageId }: Props) {
  const [packages, setPackages] = useState<RecentPkg[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<'recent' | 'similar'>('recent');

  const effectiveCustomerId = customerId ?? null;
  const providedSessionId = sessionId ?? null;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const effectiveSessionId = providedSessionId || getBrowserSessionId();

      if (currentPackageId) {
        void fetch('/api/user-actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: effectiveCustomerId,
            sessionId: effectiveSessionId,
            actionType: 'package_view',
            targetId: currentPackageId,
          }),
          keepalive: true,
        }).catch(() => {});

        const params = new URLSearchParams({
          mode: 'similar',
          packageId: currentPackageId,
          limit: '6',
        });
        const res = await fetch(`/api/user-actions?${params.toString()}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({ packages: [] }));
        if (!cancelled) {
          setPackages(Array.isArray(data.packages) ? data.packages : []);
          setType('similar');
        }
      } else {
        const params = new URLSearchParams({
          mode: 'recent',
          sessionId: effectiveSessionId,
          limit: '6',
        });
        if (effectiveCustomerId) params.set('customerId', effectiveCustomerId);
        const res = await fetch(`/api/user-actions?${params.toString()}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({ packages: [] }));
        if (!cancelled) {
          setPackages(Array.isArray(data.packages) ? data.packages : []);
          setType('recent');
        }
      }

      if (!cancelled) setLoading(false);
    }

    load().catch(() => {
      if (!cancelled) {
        setPackages([]);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [currentPackageId, effectiveCustomerId, providedSessionId]);

  const heading = useMemo(
    () => (type === 'similar' ? '이 상품과 비슷한 여행' : '최근 본 상품'),
    [type],
  );

  if (loading || packages.length === 0) return null;

  return (
    <section className="px-4 mt-6">
      <h2 className="text-[16px] font-bold text-text-primary mb-3">{heading}</h2>
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
              {formatPrice(pkg.price)}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
