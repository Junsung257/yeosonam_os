'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { normalizeCustomerVisibleCopy } from '@/lib/customer-copy-quality';

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

function getComparisonBadges(pkg: RecentPkg): string[] {
  const source = `${pkg.title} ${pkg.destination}`;
  const badges: string[] = [];
  const route = source.match(/\(([^)]+)\)/)?.[1];
  if (route) badges.push(route.replace(/\s+/g, ''));
  const duration = source.match(/(\d+박\s*\d+일|\d+일)/)?.[1];
  if (duration) badges.push(duration.replace(/\s+/g, ''));
  if (/직항|에어부산|이스타|티웨이|진에어|대한항공|아시아나/.test(source)) badges.push('항공 포함');
  return Array.from(new Set(badges)).slice(0, 3);
}

function normalizeRecentPackages(value: unknown): RecentPkg[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): RecentPkg | null => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Partial<RecentPkg>;
      if (typeof row.id !== 'string' || !row.id) return null;
      return {
        id: row.id,
        title: normalizeCustomerVisibleCopy(row.title || ''),
        destination: normalizeCustomerVisibleCopy(row.destination || ''),
        price: typeof row.price === 'number' && Number.isFinite(row.price) ? row.price : null,
      };
    })
    .filter((item): item is RecentPkg => Boolean(item));
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
          setPackages(normalizeRecentPackages(data.packages));
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
          setPackages(normalizeRecentPackages(data.packages));
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
    <section className="mt-8 mb-4">
      <div className="mb-3 flex items-end justify-between gap-3 px-4">
        <div>
          <h2 className="text-[17px] font-extrabold text-slate-950">{heading}</h2>
          {type === 'similar' && (
            <p className="mt-1 text-xs text-slate-500">코스와 기간을 비교해 더 맞는 일정을 고르세요.</p>
          )}
        </div>
        <span className="shrink-0 text-[11px] font-semibold text-slate-400">총 {packages.length}개</span>
      </div>
      <div className="flex gap-3 overflow-x-auto px-4 pb-3 scrollbar-hide snap-x snap-mandatory scroll-px-4">
        {packages.map((pkg) => (
          <Link
            key={pkg.id}
            href={`/packages/${encodeURIComponent(pkg.id)}`}
            aria-label={`${pkg.title} 자세히 비교하기`}
            className="flex min-h-[176px] w-[82vw] max-w-[320px] flex-shrink-0 snap-start flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all card-touch hover:border-slate-300 hover:shadow-md"
          >
            <p className="text-[11px] font-bold text-slate-500 mb-1 line-clamp-1">
              {pkg.destination}
            </p>
            <p className="text-[15px] font-extrabold text-slate-950 leading-snug line-clamp-2 mb-3 min-h-[2.65em]">
              {pkg.title}
            </p>
            {type === 'similar' && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {getComparisonBadges(pkg).map((badge) => (
                  <span key={badge} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                    {badge}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-auto flex items-end justify-between gap-3">
              <p className="text-[18px] font-black text-slate-950 tabular-nums">
                {formatPrice(pkg.price)}
              </p>
              <p className="shrink-0 text-[12px] font-bold text-brand">비교하기 →</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
