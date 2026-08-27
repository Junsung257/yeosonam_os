import type { Metadata } from 'next';
import Link from 'next/link';

import GlobalNav from '@/components/customer/GlobalNav';

export const metadata: Metadata = {
  title: '크루즈 여행',
  description: '여소남 크루즈 항차·객실·실시간 요금 확인 안내입니다.',
};

export default function CruisePage() {
  return (
    <div className="min-h-screen bg-white">
      <GlobalNav />
      <main>
        <section className="bg-gradient-to-br from-[#071A3D] to-brand px-5 py-20 text-white md:py-28">
          <div className="mx-auto max-w-[1000px]">
            <p className="text-sm font-bold text-blue-200">CRUISE BY YEOSONAM</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-6xl">항차와 객실부터 확인하는 크루즈</h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-white/80">
              크루즈 요금과 객실은 인원 구성·프로모션·재고에 따라 달라집니다. 원하는 일정과 인원을 남기면 현재 조건을 다시 조회합니다.
            </p>
            <a
              href="https://pf.kakao.com/_xcFxkBG/chat"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 inline-flex min-h-12 items-center rounded-full bg-[#FEE500] px-6 text-sm font-black text-[#3C1E1E]"
            >
              실시간 객실·요금 확인
            </a>
          </div>
        </section>
        <section className="mx-auto max-w-[1000px] px-5 py-14 md:py-20">
          <h2 className="text-2xl font-black text-text-primary md:text-3xl">확인 순서</h2>
          <div className="mt-7 grid gap-4 md:grid-cols-3">
            {[
              ['1', '항차 선택', '출발일·출발항·기항지를 확인합니다.'],
              ['2', '인원·객실 확인', '성인·아동 구성과 원하는 객실 등급을 확인합니다.'],
              ['3', '현재 조건 안내', '실시간 요금·예약금·잔금일·취소조건을 안내합니다.'],
            ].map(([step, title, description]) => (
              <div key={step} className="rounded-[18px] border border-admin-border p-6">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-sm font-black text-white">{step}</span>
                <h3 className="mt-4 text-lg font-black text-text-primary">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-text-secondary">{description}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 rounded-[16px] bg-bg-section p-5 text-sm leading-7 text-text-secondary">
            크루즈 상품 페이지는 독립 데이터 모듈로 준비 중입니다. 준비 전까지는 확정되지 않은 요금이나 객실을 상품처럼 표시하지 않습니다.
          </p>
          <Link href="/packages" className="mt-6 inline-flex min-h-11 items-center text-sm font-bold text-brand">패키지 상품 보기 →</Link>
        </section>
      </main>
    </div>
  );
}
