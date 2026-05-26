import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '페이지를 찾을 수 없습니다',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yellow-50 text-yellow-700 text-sm font-mono">
          E1002
        </div>

        <div className="text-6xl">🔍</div>

        <h1 className="text-2xl font-bold text-gray-900">
          페이지를 찾을 수 없습니다
        </h1>

        <p className="text-sm text-gray-500">
          주소를 확인하거나 아래 링크를 이용해주세요
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/blog"
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            블로그 보기
          </Link>
          <Link
            href="/packages"
            className="px-6 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
          >
            여행 상품 보기
          </Link>
          <Link
            href="/"
            className="px-6 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
          >
            홈으로
          </Link>
        </div>
      </div>
    </div>
  );
}
