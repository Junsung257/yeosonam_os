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
  '/affiliate',
  '/partner',
  '/partner-apply',
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
      <span className="font-medium">파트너 추천 링크로 접속했습니다.</span>
      <span className="ml-2 opacity-90">(추천 코드: {refCode})</span>
      <span className="ml-2 opacity-90">예약 시 추천 파트너에게 수수료가 지급될 수 있습니다.</span>
      <Link href="/legal/partner-attribution" className="ml-2 text-xs underline opacity-90 hover:opacity-100">
        안내
      </Link>
    </div>
  );
}
