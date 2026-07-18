'use client';

import Link from 'next/link';
import { ArrowLeft, ExternalLink, MessageCircle, Search, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getKakaoChannelChatUrl } from '@/lib/kakaoChannel';

export default function MyPage() {
  const router = useRouter();
  const kakaoChatUrl = getKakaoChannelChatUrl();

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="이전 페이지로 돌아가기"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="text-base font-bold text-slate-950">내 예약</h1>
        <span className="h-11 w-11" aria-hidden="true" />
      </header>

      <div className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-8 pb-24 sm:py-12">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-brand">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-950">
            안내 메시지의 전용 링크로 확인해주세요
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            예약 정보와 여행 서류는 개인정보 보호를 위해 예약 완료 후 보내드린 카카오 알림톡 또는 문자 메시지의 전용 링크에서만 확인할 수 있습니다.
          </p>

          <div className="mt-6 rounded-2xl bg-slate-50 px-4 py-4">
            <p className="text-sm font-bold text-slate-900">전용 링크를 찾을 수 없나요?</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              상담 채널에서 예약자 이름과 연락처를 남겨주시면 본인 확인 후 안전하게 안내해드립니다.
            </p>
          </div>

          <a
            href={kakaoChatUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#FEE500] px-5 py-3 text-sm font-bold text-[#3C1E1E] transition-transform active:scale-[0.99]"
          >
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
            카카오로 예약 확인 문의
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </section>

        <section className="rounded-3xl border border-blue-100 bg-blue-50/70 p-5 sm:p-6">
          <h2 className="text-base font-bold text-slate-950">새로운 여행을 찾고 계신가요?</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            공개된 여행 상품을 둘러보고 원하는 일정으로 상담을 시작할 수 있습니다.
          </p>
          <Link
            href="/packages"
            className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            여행 상품 둘러보기
          </Link>
        </section>
      </div>
    </main>
  );
}
