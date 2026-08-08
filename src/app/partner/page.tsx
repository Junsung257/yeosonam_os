'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface PartnerProfile {
  name: string;
  referral_code: string;
}

const NEXT_TASKS = [
  { label: '계약 및 필수 동의 확인', state: '완료', href: '/partner/settings' },
  { label: '채널과 게시 도메인 등록', state: '미완료', href: '/partner/settings' },
  { label: '첫 상품 저장', state: '미완료', href: '/partner/products' },
  { label: '첫 게시 링크 테스트', state: '미완료', href: '/partner/publish' },
];

export default function PartnerHomePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<PartnerProfile | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    fetch('/api/partner/auth/session', { cache: 'no-store' })
      .then(async response => {
        if (response.status === 401) {
          router.replace('/partner/login');
          return;
        }
        if (!response.ok) {
          setUnavailable(true);
          return;
        }
        const result = await response.json();
        setProfile(result.affiliate);
      })
      .catch(() => setUnavailable(true));
  }, [router]);

  if (unavailable) {
    return <p role="alert" className="rounded-xl bg-red-50 p-4 font-semibold text-red-700">파트너 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>;
  }
  if (!profile) return <div className="h-72 animate-pulse rounded-2xl bg-slate-200" />;

  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-slate-950 p-6 text-white sm:p-8">
        <p className="text-sm font-bold text-blue-300">계정 활성화 1/4 완료</p>
        <h1 className="mt-2 text-3xl font-black">{profile.name}님, 다음 할 일을 이어가세요</h1>
        <p className="mt-3 text-sm text-slate-300">파트너 코드 {profile.referral_code}</p>
      </section>

      <section>
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-blue-700">다음 할 일</p>
            <h2 className="mt-1 text-2xl font-black">첫 게시까지 3단계 남았습니다</h2>
          </div>
          <Link href="/partner/products" className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white">첫 상품 찾기</Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {NEXT_TASKS.map((task, index) => (
            <Link key={task.label} href={task.href} className="flex min-h-20 items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-sm font-black">{index + 1}</span>
              <span className="flex-1 font-bold">{task.label}</span>
              <span className={task.state === '완료' ? 'text-sm font-bold text-emerald-700' : 'text-sm font-bold text-slate-500'}>{task.state}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['유효 클릭', '—'], ['예약', '—'], ['예상 커미션', '—'], ['정산 가능액', '—'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-semibold text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-black">{value}</p>
            <p className="mt-2 text-xs text-slate-400">데이터 연결 대기</p>
          </div>
        ))}
      </section>
    </div>
  );
}
