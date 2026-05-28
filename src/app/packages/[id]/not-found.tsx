import Link from 'next/link';

export default function PackageNotFound() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-sm font-mono">
          NOT_FOUND
        </div>

        <div className="text-5xl">🔍</div>

        <h1 className="text-xl font-bold text-gray-900">
          패키지를 찾을 수 없습니다
        </h1>

        <p className="text-sm text-gray-500">
          요청하신 패키지가 존재하지 않거나 삭제되었습니다.
        </p>

        <div className="flex gap-3 justify-center">
          <Link
            href="/packages"
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            패키지 목록
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
