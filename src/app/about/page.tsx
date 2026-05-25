import type { Metadata } from 'next';
import Link from 'next/link';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';

export const metadata: Metadata = {
  title: '여소남 소개 — 여행을 잇는 플랫폼 | 여소남',
  description:
    '여소남은 랜드사와 여행사를 연결하고, 고객에게 검증된 패키지여행을 제공하는 B2B2C 여행 플랫폼입니다. 여행업 등록 정보, 연혁, 비전을 소개합니다.',
  openGraph: {
    title: '여소남 소개 — 여행을 잇는 플랫폼',
    description:
      '랜드사 → 여소남 → 여행사/고객을 잇는 B2B2C 여행 SaaS 플랫폼입니다.',
    url: `${BASE_URL}/about`,
    siteName: '여소남',
    locale: 'ko_KR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: '여소남 소개',
    description: '랜드사와 여행사를 연결하는 B2B2C 여행 플랫폼',
  },
  alternates: {
    canonical: `${BASE_URL}/about`,
  },
};

export default function AboutPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: '여소남',
    url: BASE_URL,
    logo: `${BASE_URL}/logo.png`,
    description:
      '랜드사 → 여소남 → 여행사/고객을 잇는 B2B2C 여행 SaaS 플랫폼입니다.',
    foundingDate: '2024',
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'help@yeosonam.com',
    },
    sameAs: [
      'https://blog.naver.com/yeosonam',
      'https://www.instagram.com/yeosonam_official/',
    ],
    knowsAbout: ['패키지여행', '해외여행', '단체여행', '여행 SaaS', 'B2B2C 여행 플랫폼'],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="min-h-screen bg-white">
        {/* 히어로 */}
        <section className="border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white">
          <div className="mx-auto max-w-3xl px-4 py-20 md:py-28 text-center">
            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-slate-900">
              여행을 잇는 플랫폼, <span className="text-brand">여소남</span>
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-slate-600 max-w-xl mx-auto">
              랜드사가 등록한 상품을 여행사와 고객이 쉽게 찾고 예약할 수 있도록,
              기술로 여행 유통의 효율을 높입니다.
            </p>
          </div>
        </section>

        {/* 미션 */}
        <section className="mx-auto max-w-3xl px-4 py-16 md:py-20">
          <h2 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900">
            왜 여소남인가
          </h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-6">
              <div className="text-3xl mb-3" aria-hidden="true">🏢</div>
              <h3 className="text-lg font-bold text-slate-900">랜드사 상품 등록</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                전국의 랜드사가 자사 상품을 여소남에 등록하면, 복수의 여행사에 동시 노출됩니다.
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-6">
              <div className="text-3xl mb-3" aria-hidden="true">🔗</div>
              <h3 className="text-lg font-bold text-slate-900">여행사 연동</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                여행사는 여소남을 통해 다양한 랜드사 상품을 한 곳에서 비교·판매할 수 있습니다.
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-6">
              <div className="text-3xl mb-3" aria-hidden="true">👤</div>
              <h3 className="text-lg font-bold text-slate-900">고객 직접 예약</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                고객도 여소남에서 검증된 패키지여행을 직접 비교하고 예약할 수 있습니다.
              </p>
            </div>
          </div>
        </section>

        {/* 여행업 등록 정보 */}
        <section className="border-t border-slate-100 bg-slate-50/50">
          <div className="mx-auto max-w-3xl px-4 py-16 md:py-20">
            <h2 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900">
              여행업 등록 정보
            </h2>
            <dl className="mt-8 space-y-4 text-sm">
              <div className="flex flex-col sm:flex-row sm:gap-4">
                <dt className="font-bold text-slate-900 sm:w-40 shrink-0">상호명</dt>
                <dd className="text-slate-600">여소남</dd>
              </div>
              <div className="flex flex-col sm:flex-row sm:gap-4">
                <dt className="font-bold text-slate-900 sm:w-40 shrink-0">대표자</dt>
                <dd className="text-slate-600">김민수</dd>
              </div>
              <div className="flex flex-col sm:flex-row sm:gap-4">
                <dt className="font-bold text-slate-900 sm:w-40 shrink-0">사업자등록번호</dt>
                <dd className="text-slate-600">000-00-00000</dd>
              </div>
              <div className="flex flex-col sm:flex-row sm:gap-4">
                <dt className="font-bold text-slate-900 sm:w-40 shrink-0">여행업 등록번호</dt>
                <dd className="text-slate-600">제2024-000000호</dd>
              </div>
              <div className="flex flex-col sm:flex-row sm:gap-4">
                <dt className="font-bold text-slate-900 sm:w-40 shrink-0">영업소재지</dt>
                <dd className="text-slate-600">서울특별시</dd>
              </div>
              <div className="flex flex-col sm:flex-row sm:gap-4">
                <dt className="font-bold text-slate-900 sm:w-40 shrink-0">문의 이메일</dt>
                <dd className="text-slate-600">
                  <a href="mailto:help@yeosonam.com" className="text-brand hover:underline">
                    help@yeosonam.com
                  </a>
                </dd>
              </div>
            </dl>
            <p className="mt-6 text-xs leading-relaxed text-slate-400">
              여소남은 통신판매중개자로서 상품의 당사자가 아니며, 상품 정보 및 거래에 대해 책임을 지지 않습니다.
              구체적인 여행업 등록 사항은 추후 공개 예정입니다.
            </p>
          </div>
        </section>

        {/* 전문성 */}
        <section className="mx-auto max-w-3xl px-4 py-16 md:py-20">
          <h2 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900">
            여행 전문성
          </h2>
          <ul className="mt-8 space-y-4 text-sm text-slate-600 leading-relaxed">
            <li className="flex items-start gap-3">
              <span className="mt-0.5 text-lg shrink-0" aria-hidden="true">🌏</span>
              <span>국내외 다양한 랜드사와의 협업을 통해 현지 정보를 기반으로 한 여행 콘텐츠 제작</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 text-lg shrink-0" aria-hidden="true">✍️</span>
              <span>여행 상품 운영팀(OP)이 상품 일정·가격·포함 항목을 직접 확인하고 블로그 콘텐츠로 제공</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 text-lg shrink-0" aria-hidden="true">📊</span>
              <span>실시간 여행 트렌드 분석과 검색 데이터 기반의 SEO 최적화 콘텐츠 운영</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 text-lg shrink-0" aria-hidden="true">🤖</span>
              <span>AI 기술을 활용한 여행 정보 큐레이션 및 맞춤형 여행 플래닝 서비스 제공</span>
            </li>
          </ul>
        </section>

        {/* 연혁 */}
        <section className="border-t border-slate-100 bg-slate-50/50">
          <div className="mx-auto max-w-3xl px-4 py-16 md:py-20">
            <h2 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900">연혁</h2>
            <dl className="mt-8 space-y-6">
              {[
                { year: '2024', items: ['여소남 플랫폼 론칭', 'B2B2C 여행 SaaS 서비스 시작'] },
                { year: '2025', items: ['AI 기반 블로그 콘텐츠 자동화 시스템 구축', '멀티 테넌트 예약 플랫폼 고도화', '제휴·정산 시스템 안정화'] },
                { year: '2026', items: ['검색 기반 SEO 최적화 콘텐츠 확장', '자유여행 AI 플래너 서비스 출시', '지속적인 여행 정보 품질 개선'] },
              ].map((period) => (
                <div key={period.year} className="flex gap-6">
                  <dt className="w-16 shrink-0 text-lg font-black text-brand">{period.year}</dt>
                  <dd className="space-y-2">
                    {period.items.map((item) => (
                      <p key={item} className="text-sm text-slate-600">{item}</p>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* 정책 링크 */}
        <section className="mx-auto max-w-3xl px-4 py-16">
          <div className="flex flex-wrap gap-4">
            <Link
              href="/privacy"
              className="text-sm font-medium text-slate-600 hover:text-slate-900 underline underline-offset-2 transition"
            >
              개인정보처리방침
            </Link>
            <Link
              href="/disclaimer"
              className="text-sm font-medium text-slate-600 hover:text-slate-900 underline underline-offset-2 transition"
            >
              면책공고
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
