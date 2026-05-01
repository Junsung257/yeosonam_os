import type { Metadata } from 'next';
import Link from 'next/link';
import GroupLandingClient from './GroupLandingClient';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

export const metadata: Metadata = {
  title: '부산·경남 단체여행 전문 | 김해공항 바로 출발',
  description:
    '기업 워크샵·협회 연수·치목 골프, 김해공항 출발 단체여행 견적을 실시간으로 확인하세요. 여소남은 부산·경남 단체 고객 전용 AI 중개 플랫폼입니다.',
  openGraph: {
    title: '부산·경남 단체여행 전문 | 여소남',
    description:
      '기업 워크샵·협회 연수·치목 골프·패밀리여행, 김해공항 출발 단체여행 견적을 실시간으로.',
    url: `${BASE_URL}/group`,
    type: 'website',
  },
  alternates: {
    canonical: `${BASE_URL}/group`,
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
    after: '→ 접수 즉시 담당자에게 내부 전파',
  },
  {
    step: 'STEP 2',
    title: '담당자 배정',
    desc: '당일 내 전담 담당자 연결',
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

// ─── 섹션 E: 실시간 접수 현황 (1차 목업, RLS 확인 후 실데이터 전환 예정) ───
const MOCK_FEED = [
  { dest: '다낭', pax: 22, type: '기업 워크샵', ago: '방금 전', status: 'reviewing' as const },
  { dest: '세부', pax: 15, type: '치목 모임', ago: '1시간 전', status: 'confirmed' as const },
  { dest: '장가계', pax: 31, type: '협회 연수', ago: '3시간 전', status: 'confirmed' as const },
  { dest: '세부', pax: 18, type: '포상여행', ago: '어제', status: 'confirmed' as const },
  { dest: '방콕', pax: 12, type: '동창회', ago: '어제', status: 'confirmed' as const },
  { dest: '오사카', pax: 25, type: '기업 워크샵', ago: '2일 전', status: 'confirmed' as const },
  { dest: '괌', pax: 14, type: '가족여행', ago: '2일 전', status: 'confirmed' as const },
  { dest: '발리', pax: 20, type: '기업 연수', ago: '3일 전', status: 'confirmed' as const },
] as const;

const KAKAO_CHAT_URL = 'https://pf.kakao.com/_xcFxkBG/chat';

export default function GroupLandingPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      {/* ─── 섹션 A. Hero ──────────────────────────────────── */}
      <section className="relative bg-gradient-to-br from-[#3182F6] to-[#1B64DA] text-white">
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
              <div className="text-2xl md:text-3xl font-bold">120+</div>
              <div className="text-xs md:text-sm text-white/70 mt-1">누적 단체 진행</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 md:p-5 text-center">
              <div className="text-2xl md:text-3xl font-bold">당일</div>
              <div className="text-xs md:text-sm text-white/70 mt-1">견적 응답</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 md:p-5 text-center">
              <div className="text-2xl md:text-3xl font-bold">김해</div>
              <div className="text-xs md:text-sm text-white/70 mt-1">전용 출발</div>
            </div>
          </div>

          {/* CTA 2개 */}
          <div className="flex flex-col md:flex-row gap-3">
            <a
              href="#group-inquiry-form"
              className="flex-1 bg-white text-[#3182F6] font-bold py-4 px-6 rounded-2xl text-center hover:bg-white/90 transition"
            >
              견적 요청하기
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
              <h3 className="font-bold text-lg mb-2">당일 견적 회신</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                접수 즉시 담당자 배정. 복잡한 요청도 당일 내 1차 제안.
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
                className="group bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md hover:border-[#3182F6]/30 transition"
              >
                <div className="text-4xl mb-3">{g.icon}</div>
                <h3 className="font-bold text-lg mb-1 group-hover:text-[#3182F6] transition">
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
                <div className="bg-gradient-to-br from-[#3182F6]/5 to-[#1B64DA]/5 rounded-2xl p-5 border border-[#3182F6]/10 h-full">
                  <div className="text-xs font-bold text-[#3182F6] mb-2">{p.step}</div>
                  <h3 className="font-bold text-base mb-2">{p.title}</h3>
                  <p className="text-xs text-slate-600 leading-relaxed mb-3">{p.desc}</p>
                  <p className="text-xs text-slate-500">{p.after}</p>
                </div>
                {i < PROCESS_STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-3 text-[#3182F6]/30 text-xl">
                    →
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 섹션 E. 실시간 접수 현황 (목업) ─────────────────── */}
      <section className="bg-gray-50 py-16 md:py-20 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <h2 className="text-2xl md:text-3xl font-bold text-center">
              최근 접수 현황
            </h2>
          </div>
          <p className="text-center text-slate-600 mb-8 text-sm">
            지금 이 순간에도 부산·경남 단체 고객이 여소남과 진행 중입니다
          </p>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-slate-500">
              <div className="col-span-3">목적지</div>
              <div className="col-span-2 text-right">인원</div>
              <div className="col-span-3">성격</div>
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

      {/* ─── 섹션 F. 견적 요청 폼 (클라이언트 컴포넌트) ──────── */}
      <GroupLandingClient />

      {/* ─── 섹션 G. 하단 CTA ───────────────────────────────── */}
      <section className="bg-gradient-to-br from-[#3182F6] to-[#1B64DA] text-white py-16 md:py-20 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            지금 바로 상담하세요
          </h2>
          <p className="text-white/80 mb-8 text-sm md:text-base">
            김해공항 출발 단체여행, 당일 견적 회신을 약속합니다
          </p>
          <div className="flex flex-col md:flex-row gap-3 max-w-lg mx-auto">
            <a
              href="#group-inquiry-form"
              className="flex-1 bg-white text-[#3182F6] font-bold py-4 px-6 rounded-2xl text-center hover:bg-white/90 transition"
            >
              견적 요청하기
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
          </div>
        </div>
      </section>
    </main>
  );
}
