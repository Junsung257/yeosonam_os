'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PartnerLoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch('/api/partner/auth/session', { cache: 'no-store' })
      .then(response => {
        if (response.ok) router.replace('/partner');
      })
      .finally(() => setChecking(false));
  }, [router]);

  return (
    <section className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">안전한 파트너 로그인</span>
      <h1 className="mt-4 text-2xl font-black">승인 초대 링크로 로그인해 주세요</h1>
      <p className="mt-3 leading-7 text-slate-600">
        고정 PIN 로그인은 종료되었습니다. 승인 또는 자격증명 재발급 안내에 포함된 일회용 링크에서 본인 확인을 완료하면 자동으로 로그인됩니다.
      </p>
      {checking && <p className="mt-4 text-sm font-semibold text-blue-700">기존 로그인 상태를 확인하고 있습니다...</p>}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link href="/partner-apply" className="min-h-12 rounded-xl bg-blue-600 px-4 py-3 text-center font-bold text-white hover:bg-blue-700">
          파트너 신청
        </Link>
        <Link href="/partner/help" className="min-h-12 rounded-xl border border-slate-300 px-4 py-3 text-center font-bold text-slate-700 hover:bg-slate-50">
          초대 재발급 안내
        </Link>
      </div>
    </section>
  );
}

