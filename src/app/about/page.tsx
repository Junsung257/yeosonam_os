import type { Metadata } from 'next';
import Link from 'next/link';
import { serializeJsonLdForScript } from '@/lib/json-ld';

export const revalidate = 86400;

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
  .replace(/\/+$/, '');
const SOCIAL_IMAGE_URL = `${BASE_URL}/og-image.png`;

export const metadata: Metadata = {
  title: '소개 — 여행을 잇는 플랫폼',
  alternates: { canonical: `${BASE_URL}/about` },
  description:
    '여소남은 랜드사·여행사·고객을 연결하고, 공개 검증을 마친 여행상품 정보를 비교할 수 있게 돕는 B2B2C 여행 플랫폼입니다.',
  openGraph: {
    title: '여소남 소개 — 여행을 잇는 플랫폼',
    description:
      '랜드사 → 여소남 → 여행사/고객을 잇는 B2B2C 여행 SaaS 플랫폼입니다.',
    url: `${BASE_URL}/about`,
    siteName: '여소남',
    locale: 'ko_KR',
    type: 'website',
    images: [{ url: SOCIAL_IMAGE_URL, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '여소남 소개',
    description: '랜드사와 여행사를 연결하는 B2B2C 여행 플랫폼',
    images: [SOCIAL_IMAGE_URL],
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
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'help@yeosonam.com',
    },
    knowsAbout: ['패키지여행', '해외여행', '단체여행', '여행 SaaS', 'B2B2C 여행 플랫폼'],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLdForScript(jsonLd) }}
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
                등록된 원문을 상품별 사실·가격·공개 검수 단계로 나누어 관리합니다.
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-6">
              <div className="text-3xl mb-3" aria-hidden="true">🔗</div>
              <h3 className="text-lg font-bold text-slate-900">여행사 연동</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                여행사가 승인된 상품 조건을 한 곳에서 확인할 수 있도록 연결합니다.
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-6">
              <div className="text-3xl mb-3" aria-hidden="true">👤</div>
              <h3 className="text-lg font-bold text-slate-900">고객 상품 상담</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                고객은 공개 검증을 마친 정보를 비교하고 최신 좌석·요금 확인을 요청할 수 있습니다.
              </p>
            </div>
          </div>
        </section>

        {/* 여행업 등록 정보 */}
        <section className="border-t border-slate-100 bg-slate-50/50">
          <div className="mx-auto max-w-3xl px-4 py-16 md:py-20">
            <h2 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900">
              공개 운영 정보
            </h2>
            <dl className="mt-8 space-y-4 text-sm">
              <div className="flex flex-col sm:flex-row sm:gap-4">
                <dt className="font-bold text-slate-900 sm:w-40 shrink-0">상호명</dt>
                <dd className="text-slate-600">여소남</dd>
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
              법인·사업자·여행업 등록 및 보험 정보는 증빙과 공개 문구의 확인이 끝난 항목만 표시합니다.
              확인 전에는 임시 번호나 등록 완료 표현을 사용하지 않습니다.
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
              <span>상품 원문과 근거를 보존하고 고객 공개용 정보와 내부 운영 정보를 분리</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 text-lg shrink-0" aria-hidden="true">✍️</span>
              <span>일정·가격·포함 항목의 검증 상태를 상품별로 관리</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 text-lg shrink-0" aria-hidden="true">📊</span>
              <span>최근성과 품질 검수를 통과한 여행가이드를 공개</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 text-lg shrink-0" aria-hidden="true">🤖</span>
              <span>AI 기술을 활용한 여행 정보 큐레이션 및 맞춤형 여행 플래닝 서비스 제공</span>
            </li>
          </ul>
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
              href="/terms"
              className="text-sm font-medium text-slate-600 hover:text-slate-900 underline underline-offset-2 transition"
            >
              이용약관
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
