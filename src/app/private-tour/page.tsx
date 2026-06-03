import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import PrivateTourLandingClient from './PrivateTourLandingClient';

export const dynamic = 'force-static';
export const revalidate = 86400;

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
  .replace(/\/+$/, '');

export const metadata: Metadata = {
  title: '단독맞춤여행 | 2명부터 가능한 우리끼리 여행',
  alternates: { canonical: `${BASE_URL}/private-tour` },
  description:
    '가족여행·계모임·동창회·기업 워크샵, 김해공항 출발 단독 프라이빗 투어. 2명부터 전담 가이드·전용 차량 배정, 24시간 내 무료 견적 회신.',
  openGraph: {
    title: '우리끼리, 더 자유롭게 | 단독맞춤여행',
    description:
      '타인과 섞이지 않는 완전한 프라이빗 여행. 가족·친구·회사·동호회 어떤 모임이든 단독 설계.',
    url: `${BASE_URL}/private-tour`,
    type: 'website',
    images: [{ url: `${BASE_URL}/og/private-tour.png`, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '오롯이, 우리끼리 | 단독맞춤여행',
    description: '2명부터 가능한 프라이빗 맞춤여행. 일정·차량·가이드까지 여소남이 설계합니다.',
    images: [`${BASE_URL}/og/private-tour.png`],
  },
};

// ─── 단독 세그먼트 6카드 ─────────────────────────────────
const GROUP_TYPES = [
  {
    icon: '👨‍👩‍👧‍👦',
    title: '가족여행',
    sub: '부모님 효도 · 유아 동반 · 3대 나들이',
    desc: '어린이부터 어르신까지 모두 편안한 동선·일정',
    pax: '2~10명',
    theme: '리조트 · 온천 · 자연',
  },
  {
    icon: '🥂',
    title: '친구·모임',
    sub: '계모임 · 동창회 · 친목 모임',
    desc: '오랜 친구와의 추억 여행, 분위기·컨셉 맞춤 설계',
    pax: '4~20명',
    theme: '맛집 · 액티비티 · 감성숙소',
  },
  {
    icon: '💼',
    title: '회사 단체',
    sub: '워크샵 · 포상여행 · 연수',
    desc: '업무+힐링 균형, 세미나·레크리에이션 포함 가능',
    pax: '5~100명',
    theme: '세미나+관광 · 골프 · 액티비티',
  },
  {
    icon: '⚽',
    title: '동호회·동문',
    sub: '골프모임 · 등산회 · 대학 동문',
    desc: '취미 중심 특화 일정, 최소 인원으로 출발 확정',
    pax: '4~60명',
    theme: '골프 · 트레킹 · 스포츠',
  },
  {
    icon: '🎉',
    title: '특별한 날',
    sub: '허니문 · 환갑/칠순 · 은퇴 기념',
    desc: '평생 추억될 순간, 럭셔리·감성 중심 프리미엄 설계',
    pax: '2~15명',
    theme: '럭셔리리조트 · 프라이빗 다이닝 · 포토',
  },
  {
    icon: '🧘',
    title: '혼자 여행',
    sub: '솔로 여행 · 나홀로 힐링',
    desc: '자유로운 일정, 현지 가이드 동반 가능한 1인 전용',
    pax: '1~2명',
    theme: '자유일정 · 힐링 · 체험',
  },
] as const;

// ─── 진행 프로세스 4단계 ────────────────────────────────
const PROCESS_STEPS = [
  {
    step: 'STEP 1',
    title: '맞춤 견적 요청',
    desc: '모임 유형·인원·목적지·예산 입력 (3분)',
    after: '→ AI 분석 후 내부 전파',
  },
  {
    step: 'STEP 2',
    title: '전담 매니저 배정',
    desc: '접수 당일 전담 매니저 1:1 연결',
    after: '→ 전용 진행 링크 전달',
  },
  {
    step: 'STEP 3',
    title: '일정·견적 제안',
    desc: '2~3가지 일정안 + 견적안 제시',
    after: '→ 피드백 반영하여 수정',
  },
  {
    step: 'STEP 4',
    title: '확정·출발',
    desc: '계약 완료 후 전용 일정표 공유',
    after: '→ 출발부터 귀국까지 전담 케어',
  },
] as const;

// ─── Why 섹션 데이터 ──────────────────────────────────
const WHY_ITEMS = [
  {
    icon: '🛫',
    title: '김해공항 전용 출발',
    desc: '부산·경남 어디든 1시간. 인천까지 갈 필요 없이 바로 출발합니다.',
  },
  {
    icon: '👤',
    title: '전담 가이드 + 전용 차량',
    desc: '우리 일행만을 위한 가이드와 차량. 타인과 섞이지 않는 완전한 프라이빗.',
  },
  {
    icon: '⚡',
    title: '24시간 내 견적 회신',
    desc: '접수 즉시 담당자 배정. 복잡한 요청도 당일 내 1차 제안을 약속합니다.',
  },
  {
    icon: '🔍',
    title: '실시간 진행 확인',
    desc: '견적→확정→출발까지 전용 링크에서 언제든지 직접 확인하세요.',
  },
] as const;

// ─── 실시간 접수 현황 목업 ─────────────────────────────
const MOCK_FEED = [
  { dest: '다낭', pax: 4, type: '가족여행', ago: '방금 전', status: 'reviewing' as const },
  { dest: '세부', pax: 6, type: '친구모임', ago: '1시간 전', status: 'confirmed' as const },
  { dest: '오사카', pax: 2, type: '허니문', ago: '2시간 전', status: 'confirmed' as const },
  { dest: '괌', pax: 8, type: '가족여행', ago: '어제', status: 'confirmed' as const },
  { dest: '방콕', pax: 12, type: '계모임', ago: '어제', status: 'confirmed' as const },
  { dest: '장가계', pax: 15, type: '동창회', ago: '2일 전', status: 'confirmed' as const },
  { dest: '발리', pax: 3, type: '솔로여행', ago: '2일 전', status: 'confirmed' as const },
  { dest: '나트랑', pax: 10, type: '기업 워크샵', ago: '3일 전', status: 'confirmed' as const },
] as const;

const KAKAO_CHAT_URL = 'https://pf.kakao.com/_xcFxkBG/chat';

export default function PrivateTourPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      {/* JSON-LD 구조화된 데이터 */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: '여소남 단독맞춤여행',
            description:
              '가족여행·계모임·동창회·기업 워크샵, 김해공항 출발 단독 프라이빗 투어. 2명부터 전담 가이드·전용 차량 배정, 24시간 내 무료 견적 회신.',
            url: `${BASE_URL}/private-tour`,
            provider: {
              '@type': 'TravelAgency',
              name: '여소남',
              url: BASE_URL,
            },
            offers: {
              '@type': 'Offer',
              price: '0',
              priceCurrency: 'KRW',
              description: '무료 맞춤 견적',
            },
          }),
        }}
      />
      {/* ─── 섹션 A. Hero ──────────────────────────────── */}
      <section className="relative bg-gradient-to-br from-brand to-brand-dark text-white overflow-hidden">
        {/* 배경 장식 */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: 'radial-gradient(circle at 25% 50%, white 1px, transparent 1px), radial-gradient(circle at 75% 50%, white 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }} />
        <div className="relative max-w-5xl mx-auto px-4 py-20 md:py-28">
          {/* 뱃지 */}
          <div className="flex flex-wrap gap-2 mb-6">
            <span className="inline-block bg-white/15 backdrop-blur-sm text-white text-xs font-semibold px-3 py-1.5 rounded-full">
              ✈️ 김해공항 출발 전용
            </span>
            <span className="inline-block bg-white/15 backdrop-blur-sm text-white text-xs font-semibold px-3 py-1.5 rounded-full">
              👥 2명부터 출발 가능
            </span>
          </div>

          <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-5">
            우리끼리, 더 자유롭게
            <br />
            <span className="text-yellow-300">단독 프라이빗 여행</span>
          </h1>
          <p className="text-lg md:text-xl text-white/80 leading-relaxed mb-8">
            가족여행 · 계모임 · 동창회 · 기업 워크샵
            <br />
            2명부터 가능한 완전한 프라이빗 여행
          </p>

          {/* KPI 4개 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 text-center">
              <div className="text-2xl font-bold">2명</div>
              <div className="text-xs text-white/70 mt-1">최소 출발</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 text-center">
              <div className="text-2xl font-bold">24시간</div>
              <div className="text-xs text-white/70 mt-1">견적 회신</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 text-center">
              <div className="text-2xl font-bold">120+</div>
              <div className="text-xs text-white/70 mt-1">누적 진행</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 text-center">
              <div className="text-2xl font-bold">전담</div>
              <div className="text-xs text-white/70 mt-1">1:1 매니저</div>
            </div>
          </div>

          {/* CTA 2개 */}
          <div className="flex flex-col md:flex-row gap-3 max-w-lg">
            <a
              href="#private-tour-form"
              className="flex-1 bg-white text-brand font-bold py-4 px-6 rounded-2xl text-center hover:bg-white/90 transition"
            >
              무료 맞춤 견적 의뢰하기
            </a>
            <a
              href={KAKAO_CHAT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 bg-yellow-400 text-slate-900 font-bold py-4 px-6 rounded-2xl text-center hover:bg-yellow-300 transition"
            >
              💬 카카오톡 상담
            </a>
          </div>
        </div>
      </section>

      {/* ─── 섹션 B. Why (여소남이 다른 이유) ──────────── */}
      <section className="bg-white py-16 md:py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-3">
            왜 여소남 단독맞춤여행일까요?
          </h2>
          <p className="text-center text-slate-600 mb-12 text-sm md:text-base">
            프라이빗 여행의 모든 것, 여소남이 설계합니다
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {WHY_ITEMS.map((item) => (
              <div
                key={item.title}
                className="bg-gray-50 rounded-2xl p-6 border border-gray-100 hover:shadow-md hover:border-brand/20 transition"
              >
                <div className="text-3xl mb-3">{item.icon}</div>
                <h3 className="font-bold text-lg mb-2">{item.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 섹션 C. 세그먼트 6카드 ─────────────────────── */}
      <section className="bg-gray-50 py-16 md:py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-3">
            어떤 모임이신가요?
          </h2>
          <p className="text-center text-slate-600 mb-10 text-sm md:text-base">
            모임 유형에 맞게 일정·동선·혜택을 다르게 설계합니다
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {GROUP_TYPES.map((g) => (
              <Link
                key={g.title}
                href={`/private-tour?preset=${encodeURIComponent(g.title)}#private-tour-form`}
                className="group bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-md hover:border-brand/30 transition"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="text-3xl">{g.icon}</div>
                  <span className="text-xs text-brand font-semibold bg-brand/5 px-2 py-1 rounded-full">
                    {g.pax}
                  </span>
                </div>
                <h3 className="font-bold text-lg mb-1 group-hover:text-brand transition">
                  {g.title}
                </h3>
                <p className="text-sm text-slate-500 mb-2">{g.sub}</p>
                <p className="text-xs text-slate-600 leading-relaxed mb-3">{g.desc}</p>
                <div className="text-xs text-slate-400">
                  추천: {g.theme}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 섹션 D. 진행 프로세스 4단계 ─────────────────── */}
      <section className="bg-white py-16 md:py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-3">
            진행 프로세스
          </h2>
          <p className="text-center text-slate-600 mb-12 text-sm">
            간단한 견적 요청으로 시작하세요
          </p>
          <div className="grid md:grid-cols-4 gap-5">
            {PROCESS_STEPS.map((p, i) => (
              <div key={p.step} className="relative">
                <div className="bg-gradient-to-br from-brand/5 to-brand-dark/5 rounded-2xl p-5 border border-brand/10 h-full">
                  <div className="w-8 h-8 bg-brand rounded-full flex items-center justify-center text-white text-sm font-bold mb-3">
                    {i + 1}
                  </div>
                  <div className="text-xs font-bold text-brand mb-1">{p.step}</div>
                  <h3 className="font-bold text-base mb-2">{p.title}</h3>
                  <p className="text-xs text-slate-600 leading-relaxed mb-3">{p.desc}</p>
                  <p className="text-xs text-slate-500">{p.after}</p>
                </div>
                {i < PROCESS_STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-3 text-brand/30 text-xl">
                    →
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 섹션 E. 실시간 접수 현황 ───────────────────── */}
      <section className="bg-gray-50 py-16 md:py-20 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <h2 className="text-2xl md:text-3xl font-bold text-center">
              최근 접수 현황
            </h2>
          </div>
          <p className="text-center text-slate-600 mb-8 text-sm">
            지금 이 순간에도 우리만의 여행을 준비 중입니다
          </p>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-slate-500">
              <div className="col-span-3">목적지</div>
              <div className="col-span-2 text-right">인원</div>
              <div className="col-span-3">유형</div>
              <div className="col-span-2">접수</div>
              <div className="col-span-2 text-right">상태</div>
            </div>
            {MOCK_FEED.map((f, i) => (
              <div
                key={i}
                className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-50 last:border-b-0 text-sm"
              >
                <div className="col-span-3 font-semibold">{f.dest}</div>
                <div className="col-span-2 text-right text-slate-600">{f.pax}명</div>
                <div className="col-span-3 text-slate-600 text-xs md:text-sm">{f.type}</div>
                <div className="col-span-2 text-slate-500 text-xs">{f.ago}</div>
                <div className="col-span-2 text-right text-xs">
                  {f.status === 'reviewing' ? (
                    <span className="text-amber-600">💡 검토 중</span>
                  ) : (
                    <span className="text-emerald-600">✓ 확정 완료</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-slate-400 mt-4">
            ※ 개인정보 보호를 위해 단체명·연락처는 표시하지 않습니다.
          </p>
        </div>
      </section>

      {/* ─── 섹션 F. 다단계 견적 폼 (클라이언트 컴포넌트) ── */}
      <Suspense fallback={<div className="py-16 text-center text-slate-400">로딩 중...</div>}>
        <PrivateTourLandingClient />
      </Suspense>

      {/* ─── 섹션 G. 하단 CTA ──────────────────────────── */}
      <section className="bg-gradient-to-br from-brand to-brand-dark text-white py-16 md:py-20 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            지금 무료 견적을 받아보세요
          </h2>
          <p className="text-white/80 mb-8 text-sm md:text-base">
            3분 입력, 24시간 내 첫 제안. 부담 없이 문의하세요.
          </p>
          <div className="flex flex-col md:flex-row gap-3 max-w-lg mx-auto">
            <a
              href="#private-tour-form"
              className="flex-1 bg-white text-brand font-bold py-4 px-6 rounded-2xl text-center hover:bg-white/90 transition"
            >
              무료 맞춤 견적 의뢰하기
            </a>
            <a
              href={KAKAO_CHAT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 bg-yellow-400 text-slate-900 font-bold py-4 px-6 rounded-2xl text-center hover:bg-yellow-300 transition"
            >
              💬 카카오톡 상담
            </a>
          </div>
          <div className="mt-8 pt-8 border-t border-white/20 text-sm text-white/60">
            <Link href="/" className="hover:text-white transition">
              ← 여소남 홈으로
            </Link>
            <span className="mx-3">·</span>
            <span>단독맞춤여행 | Yeosonam Private Tour</span>
          </div>
        </div>
      </section>
    </main>
  );
}
