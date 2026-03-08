import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-20">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            🌍 여소남 OS
          </h1>
          <p className="text-xl text-gray-700 mb-8">
            여행사 문서 자동 처리 및 AI 콘텐츠 생성 시스템
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <Link href="/admin/upload">
              <div className="bg-white p-8 rounded-lg shadow-lg hover:shadow-xl transition cursor-pointer">
                <div className="text-4xl mb-4">📤</div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">문서 업로드</h2>
                <p className="text-gray-600">HWP/PDF/JPG 자동 파싱</p>
              </div>
            </Link>

            <Link href="/admin">
              <div className="bg-white p-8 rounded-lg shadow-lg hover:shadow-xl transition cursor-pointer">
                <div className="text-4xl mb-4">📋</div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">관리자</h2>
                <p className="text-gray-600">문서 승인 및 마진 관리</p>
              </div>
            </Link>

            <Link href="/admin/generate">
              <div className="bg-white p-8 rounded-lg shadow-lg hover:shadow-xl transition cursor-pointer">
                <div className="text-4xl mb-4">✨</div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">AI 생성</h2>
                <p className="text-gray-600">콘텐츠 자동 생성</p>
              </div>
            </Link>
          </div>

          <div className="bg-white p-8 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-gray-900 mb-4">기능 안내</h3>
            <ul className="text-left text-gray-700 space-y-2">
              <li>✅ HWP/PDF/JPG 문서 자동 분석</li>
              <li>✅ AI를 활용한 여행 상품 설명 생성</li>
              <li>✅ 자동 마진율 계산</li>
              <li>✅ 제휴사 API 통합</li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
