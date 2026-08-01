import type { Metadata } from 'next';
import Link from 'next/link';
import GroupLandingClient from './GroupLandingClient';
import TrackedKakaoLink from '@/components/customer/TrackedKakaoLink';

export const revalidate = 86400;

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
  .replace(/\/+$/, '');

export const metadata: Metadata = {
  title: '부산·경남 단체여행 전문 | 김해공항 바로 출발',
  alternates: { canonical: `${BASE_URL}/group` },
  description:
    '기업 워크샵·협회 연수·치목 골프를 위한 김해공항 출발 단체여행 조건을 정리하고 담당자에게 견적을 요청하세요.',
  openGraph: {
    title: '부산·경남 단체여행 전문',
    description:
      '기업 워크샵·협회 연수·치목 골프·패밀리여행을 위한 김해공항 출발 견적 요청.',
    url: `${BASE_URL}/group`,
    type: 'website',
    images: [{ url: `${BASE_URL}/og/group.png`, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '부산·경남 단체여행 전문',
    description: '기업 워크숍, 연수, 골프, 친목 단체여행 견적을 빠르게 받아보세요.',
    images: [`${BASE_URL}/og/group.png`],
  },
};

// ─── 단체 유형 4카드 ──────────────────────────────────────────
const GROUP_TYPES = [
  {
    icon: '🏢',
    title: '기업 워크샵 · 포상여행',
    sub: '임직원 단합 / 인센티브 / 창립기념',
    pax: '추천 인원: 20명~',
    budget: '예산 구간: 1인 60~150만원',
    value: '기업 워크샵',
  },
  {
    icon: '🎓',
    title: '협회 · 기관 · 해외 연수',
    sub: '해외 벤치마킹 / 공무 연수 / 학회 투어',
    pax: '추천 인원: 15명~',
    budget: '예산 구간: 1인 70~180만원',
    value: '협회 연수',
  },
  {
    icon: '⛳',
    title: '치목 · 골프 · 동문회',
    sub: '오랜 친목 / 골프 패키지 / 동창회',
    pax: '추천 인원: 10명~',
    budget: '예산 구간: 1인 50~120만원',
    value: '치목 골프',
  },
  {
    icon: '👨‍👩‍👧',
    title: '패밀리 · 가족 · 소규모',
    sub: '어르신 배려 동행 / 3대 나들이 / 가족여행',
    pax: '추천 인원: 10명~',
    budget: '예산 구간: 1인 60~130만원',
    value: '패밀리 가족',
  },
] as const;

// ─── 진행 프로세스 4단계 ──────────────────────────────────────
const PROCESS_STEPS = [
  {
    step: 'STEP 1',
    title: '견적 요청',
    desc: '단체 성격 · 인원 · 예산 · 희망지역 입력',
    after: '→ 접수 내용을 담당자에게 전달',
  },
  {
    step: 'STEP 2',
    title: '담당자 배정',
    desc: '담당자 확인 후 상담 연결',
    after: '→ 전용 진행 링크 전달',
  },
  {
    step: 'STEP 3',
    title: '일정 · 견적 제안',
    desc: '2~3가지 일정안 + 견적안 제시',
    after: '→ 피드백 받아 수정',
  },
  {
    step: 'STEP 4',
    title: '확정 · 출발',
    desc: '계약 완료 후 출발 전 전용 일정표 공유',
    after: '→ 출발부터 귀국까지 관리',
  },
] as const;

export default function GroupLandingPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      {/* ─── 섹션 A. Hero ──────────────────────────────────── */}
      <section className="relative bg-gradient-to-br from-brand to-brand-dark text-white">
        <div className="max-w-4xl mx-auto px-4 py-20 md:py-28">
          <span className="inline-block bg-white/15 backdrop-blur-sm text-white text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
            ✈️ 김해공항 출발 전용
          </span>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-5">
            부산·경남 단체여행,
            <br />
            여소남이 설계합니다
          </h1>
          <p className="text-lg md:text-xl text-white/80 leading-relaxed mb-10">
            기업 워크샵 · 협회 연수 · 치목 골프 · 패밀리여행
            <br />
            10인~100인 이상, 예산·일정·분위기 맞춤 설계
          </p>

          {/* KPI 3개 */}
          <div className="grid grid-cols-3 gap-3 md:gap-6 mb-10">
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 md:p-5 text-center">
              <div className="text-2xl md:text-3xl font-bold">10인+</div>
              <div className="text-xs md:text-sm text-white/70 mt-1">단체 상담 기준</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 md:p-5 text-center">
              <div className="text-2xl md:text-3xl font-bold">담당자</div>
              <div className="text-xs md:text-sm text-white/70 mt-1">수동 견적 검토</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 md:p-5 text-center">
              <div className="text-2xl md:text-3xl font-bold">김해</div>
              <div className="text-xs md:text-sm text-white/70 mt-1">출발 우선 상담</div>
            </div>
          </div>

          {/* CTA 2개 */}
          <div className="flex flex-col md:flex-row gap-3">
            <a
              href="#group-inquiry-form"
              className="flex-1 bg-white text-brand font-bold py-4 px-6 rounded-2xl text-center hover:bg-white/90 transition"
            >
              견적 요청하기
            </a>
            <TrackedKakaoLink
              source="group_hero"
              destination="group"
              className="flex-1 bg-yellow-400 text-slate-900 font-bold py-4 px-6 rounded-2xl text-center hover:bg-yellow-300 transition"
            >
              💬 카카오톡 상담
            </TrackedKakaoLink>
          </div>
        </div>
      </section>

      {/* ─── 섹션 B. Why (여소남이 다른 이유) ────────────────── */}
      <section className="bg-white py-16 md:py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">
            여소남이 다른 이유
          </h2>
          <div className="grid md:grid-cols-3 gap-5">
            <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
              <div className="text-3xl mb-3">🛫</div>
              <h3 className="font-bold text-lg mb-2">김해공항 직접 출발</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                부산·경남 단체 고객은 이동 부담 없이 김해공항에서 바로 출발합니다.
                인천까지 이동 시간·비용 제로.
              </p>
            </div>
            <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
              <div className="text-3xl mb-3">📊</div>
              <h3 className="font-bold text-lg mb-2">실시간 진행 확인</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                견적 요청부터 출발까지 전용 링크에서 진행 상황을 직접 확인하세요.
                전화 없이, 언제든지.
              </p>
            </div>
            <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
              <div className="text-3xl mb-3">⚡</div>
              <h3 className="font-bold text-lg mb-2">담당자 견적 검토</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                접수 내용을 확인한 뒤 담당자가 상담과 견적 준비를 이어갑니다.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 섹션 C. 단체 유형 4카드 ─────────────────────────── */}
      <section className="bg-gray-50 py-16 md:py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-3">
            어떤 단체이신가요?
          </h2>
          <p className="text-center text-slate-600 mb-10 text-sm md:text-base">
            단체 성격에 맞는 전용 설계로 진행합니다
          </p>
          <div className="grid md:grid-cols-2 gap-5">
            {GROUP_TYPES.map((g) => (
              <a
                key={g.value}
                href={`#group-inquiry-form?preset=${encodeURIComponent(g.value)}`}
                className="group bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md hover:border-brand/30 transition"
              >
                <div className="text-4xl mb-3">{g.icon}</div>
                <h3 className="font-bold text-lg mb-1 group-hover:text-brand transition">
                  {g.title}
                </h3>
                <p className="text-sm text-slate-600 mb-3">{g.sub}</p>
                <div className="text-xs text-slate-500 space-y-0.5">
                  <div>{g.pax}</div>
                  <div>{g.budget}</div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 섹션 D. 진행 프로세스 4단계 ─────────────────────── */}
      <section className="bg-white py-16 md:py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">
            진행 프로세스
          </h2>
          <div className="grid md:grid-cols-4 gap-5">
            {PROCESS_STEPS.map((p, i) => (
              <div key={p.step} className="relative">
                <div className="bg-gradient-to-br from-brand/5 to-brand-dark/5 rounded-2xl p-5 border border-brand/10 h-full">
                  <div className="text-xs font-bold text-brand mb-2">{p.step}</div>
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

      {/* ─── 섹션 E. 견적 요청 폼 (클라이언트 컴포넌트) ──────── */}
      <GroupLandingClient />

      {/* ─── 섹션 F. 하단 CTA ───────────────────────────────── */}
      <section className="bg-gradient-to-br from-brand to-brand-dark text-white py-16 md:py-20 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            지금 바로 상담하세요
          </h2>
          <p className="text-white/80 mb-8 text-sm md:text-base">
            김해공항 출발 단체여행 조건을 남기면 담당자가 확인 후 연락드립니다
          </p>
          <div className="flex flex-col md:flex-row gap-3 max-w-lg mx-auto">
            <a
              href="#group-inquiry-form"
              className="flex-1 bg-white text-brand font-bold py-4 px-6 rounded-2xl text-center hover:bg-white/90 transition"
            >
              견적 요청하기
            </a>
            <TrackedKakaoLink
              source="group_bottom"
              destination="group"
              className="flex-1 bg-yellow-400 text-slate-900 font-bold py-4 px-6 rounded-2xl text-center hover:bg-yellow-300 transition"
            >
              💬 카카오톡 상담
            </TrackedKakaoLink>
          </div>
          <div className="mt-8 pt-8 border-t border-white/20 text-sm text-white/60">
            <Link href="/" className="hover:text-white transition">
              ← 여소남 홈으로
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
