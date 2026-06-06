import type { Metadata } from 'next';
import Link from 'next/link';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
  .replace(/\/+$/, '');
const PAGE_URL = `${BASE_URL}/privacy`;
const SOCIAL_IMAGE_URL = `${BASE_URL}/og-image.png`;

export const metadata: Metadata = {
  title: '개인정보처리방침',
  description: '여소남 서비스 이용 과정에서 수집하는 개인정보 항목, 이용 목적, 보관 기간, 문의 방법을 안내합니다.',
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: '개인정보처리방침',
    description: '여소남 서비스 이용 과정에서 수집하는 개인정보 항목, 이용 목적, 보관 기간, 문의 방법을 안내합니다.',
    url: PAGE_URL,
    siteName: '여소남',
    locale: 'ko_KR',
    type: 'article',
    images: [{ url: SOCIAL_IMAGE_URL, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '개인정보처리방침',
    description: '여소남 서비스 이용 과정에서 수집하는 개인정보 항목, 이용 목적, 보관 기간, 문의 방법을 안내합니다.',
    images: [SOCIAL_IMAGE_URL],
  },
  robots: { index: true, follow: true },
};

const sections = [
  {
    title: '1. 수집하는 정보',
    body: [
      '여소남은 상담, 예약, 제휴 신청, 결제 확인 과정에서 이름, 연락처, 이메일, 예약 정보, 결제 확인에 필요한 최소한의 거래 정보를 수집할 수 있습니다.',
      '여권 보조 서비스처럼 민감한 정보가 포함될 수 있는 기능은 별도 화면에서 목적과 보관 범위를 다시 안내합니다.',
    ],
  },
  {
    title: '2. 이용 목적',
    body: [
      '수집한 정보는 여행 상담 응대, 예약 진행, 고객 문의 처리, 결제 검증, 서비스 운영 품질 개선, 법령상 의무 이행을 위해 사용합니다.',
      '광고성 활용은 사전 동의 범위 안에서만 진행하며, 필수 정보는 동의 철회와 별개로 법령상 보관 의무가 있는 기간에 한해 유지될 수 있습니다.',
    ],
  },
  {
    title: '3. 보관 기간',
    body: [
      '상담 및 예약 관련 정보는 거래 관계 종료 후 관련 법령 또는 분쟁 대응에 필요한 기간 동안 보관할 수 있습니다.',
      '마케팅 수신 동의 정보는 사용자가 철회할 때까지 또는 내부 운영 기준에 따라 정기 점검 후 파기합니다.',
    ],
  },
  {
    title: '4. 제3자 제공 및 처리 위탁',
    body: [
      '예약 이행에 필요한 경우 항공사, 호텔, 랜드사, 현지 공급사, 결제사, 메시지 발송사 등 서비스 수행에 필요한 범위에서만 정보를 전달할 수 있습니다.',
      '제3자 제공 또는 위탁이 필요한 경우 제공 목적과 항목, 보관 기간을 업무 범위에 맞게 제한합니다.',
    ],
  },
  {
    title: '5. 이용자 권리',
    body: [
      '이용자는 자신의 개인정보 열람, 정정, 삭제, 처리 정지, 동의 철회를 요청할 수 있습니다.',
      '요청이 접수되면 본인 확인 후 법령상 제한이 없는 범위에서 지체 없이 처리합니다.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-gray-800">
      <p className="mb-4 text-sm text-gray-500">
        <Link href="/" className="text-blue-700 hover:underline">여소남 홈</Link>
      </p>
      <h1 className="mb-3 text-3xl font-bold text-gray-900">개인정보처리방침</h1>
      <p className="mb-8 text-sm text-gray-500">최종 업데이트: 2026-06-06</p>
      <div className="prose prose-sm max-w-none space-y-6 text-[15px] leading-relaxed">
        <p>
          여소남은 여행 상담, 예약, 정산, 제휴 운영 과정에서 필요한 최소한의 개인정보만 수집하고, 목적 범위를 넘는 이용을 하지 않습니다.
          아래 내용은 현재 서비스 운영 기준의 요약본이며, 실제 처리 과정은 기능별 안내와 관련 법령을 함께 따릅니다.
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
          <h2>6. 문의</h2>
          <p>
            개인정보 처리와 관련한 요청 또는 문의는 여소남 운영 채널 또는 상담 접수 경로를 통해 전달해 주세요. 접수된 요청은 본인 확인 후 처리됩니다.
          </p>
          <p>
            서비스 이용 조건은 <Link href="/terms" className="text-blue-700 hover:underline">이용약관</Link>에서 함께 확인할 수 있습니다.
          </p>
        </section>
      </div>
    </main>
  );
}
