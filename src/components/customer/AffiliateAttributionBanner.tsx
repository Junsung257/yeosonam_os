'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getReferrer } from '@/lib/tracker';
import { looksLikeReferralCode } from '@/lib/affiliate-ref-code';

const HIDDEN_PREFIXES = [
  '/admin',
  '/m/',
  '/login',
  '/auth/',
  '/api/',
  '/influencer',
  '/with/',
  '/embed/',
  '/legal/',
];

export default function AffiliateAttributionBanner() {
  const pathname = usePathname() || '';
  const [refCode, setRefCode] = useState<string | null>(null);

  useEffect(() => {
    const r = getReferrer();
    if (r && looksLikeReferralCode(r)) setRefCode(r.trim());
  }, []);

  if (!refCode) return null;
  if (HIDDEN_PREFIXES.some(p => pathname.startsWith(p))) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-[100] border-b border-emerald-800/40 bg-gradient-to-r from-emerald-900 to-teal-900 px-3 py-2.5 text-center text-sm text-white shadow-md"
    >
      <span className="font-medium">제휴 전용 혜택이 적용 중입니다.</span>
      <span className="ml-2 opacity-90">(추천 코드: {refCode})</span>
      <Link href="/legal/partner-attribution" className="ml-2 text-xs underline opacity-90 hover:opacity-100">
        안내
      </Link>
    </div>
  );
}
