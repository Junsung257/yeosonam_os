import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '제휴·추천 링크 안내',
  robots: { index: true, follow: true },
};

export default function PartnerAttributionLegalPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-gray-800">
      <p className="text-sm text-gray-500 mb-4">
        <Link href="/" className="text-blue-700 hover:underline">← 홈</Link>
      </p>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">제휴·추천 링크 안내</h1>
      <div className="prose prose-sm max-w-none space-y-4 text-[15px] leading-relaxed">
        <p>
          여소남은 파트너(인플루언서·제휴 채널)님이 안내하신 고객을 구분하기 위해,
          <strong> 고객 브라우저에 1차 도메인(여소남) 쿠키</strong>로 추천 정보를 저장할 수 있습니다.
          (예: 전용 랜딩 <code className="rounded bg-gray-100 px-1">/with/추천코드</code> 방문 또는 <code className="rounded bg-gray-100 px-1">?ref=추천코드</code> 링크)
        </p>
        <p>
          이 쿠키는 <strong>최대 30일</strong> 동안 유지되며, 그 기간 안에 같은 브라우저에서 진행된 예약에 대해
          사전에 공지된 <strong>커미션 규칙</strong>이 적용될 수 있습니다.
        </p>
        <p>
          <strong>유의사항:</strong> 다른 기기·브라우저로 이동하거나 쿠키를 삭제한 경우, 추천 경로가 끊길 수 있습니다.
          최종 적용 여부는 예약 시점의 시스템 기록을 따릅니다.
        </p>
        <p className="text-sm text-gray-600 border-t border-gray-200 pt-4">
          개인정보 보호법 개정(2026년 9월) 등 관련 법령이 바뀌는 경우, 동의 절차·쿠키 정책을 조정할 수 있습니다.
          문의는 여소남 운영 채널로 연락 주세요.
        </p>
      </div>
    </main>
  );
}
