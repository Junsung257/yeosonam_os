import type { Metadata } from 'next';
import Link from 'next/link';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
  .replace(/\/+$/, '');
const PAGE_URL = `${BASE_URL}/terms`;
const SOCIAL_IMAGE_URL = `${BASE_URL}/og-image.png`;

export const metadata: Metadata = {
  title: '서비스 이용약관',
  description: '여소남 서비스 이용 시 적용되는 기본 약관, 예약 진행 원칙, 환불 및 책임 범위를 안내합니다.',
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: '서비스 이용약관',
    description: '여소남 서비스 이용 시 적용되는 기본 약관, 예약 진행 원칙, 환불 및 책임 범위를 안내합니다.',
    url: PAGE_URL,
    siteName: '여소남',
    locale: 'ko_KR',
    type: 'article',
    images: [{ url: SOCIAL_IMAGE_URL, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '서비스 이용약관',
    description: '여소남 서비스 이용 시 적용되는 기본 약관, 예약 진행 원칙, 환불 및 책임 범위를 안내합니다.',
    images: [SOCIAL_IMAGE_URL],
  },
  robots: { index: true, follow: true },
};

const sections = [
  {
    title: '1. 서비스 범위',
    body: [
      '여소남은 여행 상품 탐색, 상담, 예약 연계, 결제 확인, 제휴 추적, 운영 지원 도구를 제공하는 플랫폼입니다.',
      '개별 상품의 세부 조건은 각 상품 페이지, 예약 단계, 공급사 약관, 항공 및 숙박 규정에 따라 추가로 적용될 수 있습니다.',
    ],
  },
  {
    title: '2. 예약과 결제',
    body: [
      '예약 가능 여부와 최종 금액은 공급사 재고, 발권 상태, 현지 운영 조건에 따라 변동될 수 있습니다.',
      '사용자는 결제 전 일정, 포함/불포함, 취소 규정, 여권 및 비자 요건을 직접 확인해야 하며, 여소남은 확인에 필요한 정보를 제공하기 위해 노력합니다.',
    ],
  },
  {
    title: '3. 취소와 변경',
    body: [
      '취소 및 변경 수수료는 상품별 약관, 항공권 발권 여부, 출발일까지 남은 기간, 현지 공급사 규정에 따라 달라질 수 있습니다.',
      '표준 규정이 아닌 개별 상품 특약이 있는 경우 해당 상품 약관이 우선 적용됩니다.',
    ],
  },
  {
    title: '4. 책임 범위',
    body: [
      '천재지변, 항공사 사정, 현지 규제, 공급사 운영 중단 등 플랫폼이 직접 통제할 수 없는 사유로 인한 일정 변경이 발생할 수 있습니다.',
      '여소남은 확인 가능한 최신 정보를 전달하고 대체안 협의를 지원하지만, 모든 외부 변수를 보증하지는 않습니다.',
    ],
  },
  {
    title: '5. 금지 행위',
    body: [
      '허위 예약, 타인 정보 도용, 결제 악용, 자동화 남용, 제휴 추적 조작, 운영 방해 행위는 제한될 수 있습니다.',
      '정책 위반이 확인되면 서비스 이용 제한, 예약 취소, 관련 기록 보존 조치가 이루어질 수 있습니다.',
    ],
  },
];

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-gray-800">
      <p className="mb-4 text-sm text-gray-500">
        <Link href="/" className="text-blue-700 hover:underline">여소남 홈</Link>
      </p>
      <h1 className="mb-3 text-3xl font-bold text-gray-900">서비스 이용약관</h1>
      <p className="mb-8 text-sm text-gray-500">최종 업데이트: 2026-06-06</p>
      <div className="prose prose-sm max-w-none space-y-6 text-[15px] leading-relaxed">
        <p>
          이 문서는 여소남 플랫폼 이용 시 기본적으로 적용되는 운영 원칙을 요약한 페이지입니다.
          실제 예약과 취소는 상품 상세 약관, 결제 단계 고지, 공급사 정책이 함께 적용될 수 있습니다.
        </p>
        {sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
        <section>
          <h2>6. 추가 안내</h2>
          <p>
            상품별 세부 취소 규정과 유의사항은 상품 상세 페이지 및 예약 진행 화면에서 반드시 다시 확인해 주세요.
          </p>
          <p>
            개인정보 처리 기준은 <Link href="/privacy" className="text-blue-700 hover:underline">개인정보처리방침</Link>에서 확인할 수 있습니다.
          </p>
        </section>
      </div>
    </main>
  );
}
