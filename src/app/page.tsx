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

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-10">
            <Link href="/packages">
              <div className="bg-white p-5 rounded-xl shadow hover:shadow-lg transition cursor-pointer text-center">
                <div className="text-3xl mb-2">🗺️</div>
                <h2 className="text-base font-semibold text-gray-900">상품 목록</h2>
                <p className="text-xs text-gray-500 mt-1">여행 상품 조회</p>
              </div>
            </Link>

            <Link href="/admin/qa">
              <div className="bg-white p-5 rounded-xl shadow hover:shadow-lg transition cursor-pointer text-center">
                <div className="text-3xl mb-2">💬</div>
                <h2 className="text-base font-semibold text-gray-900">AI 상담</h2>
                <p className="text-xs text-gray-500 mt-1">실시간 AI 추천</p>
              </div>
            </Link>

            <Link href="/admin/bookings">
              <div className="bg-white p-5 rounded-xl shadow hover:shadow-lg transition cursor-pointer text-center">
                <div className="text-3xl mb-2">📋</div>
                <h2 className="text-base font-semibold text-gray-900">예약 관리</h2>
                <p className="text-xs text-gray-500 mt-1">예약·입금 확인</p>
              </div>
            </Link>

            <Link href="/admin/customers">
              <div className="bg-white p-5 rounded-xl shadow hover:shadow-lg transition cursor-pointer text-center">
                <div className="text-3xl mb-2">👤</div>
                <h2 className="text-base font-semibold text-gray-900">고객 관리</h2>
                <p className="text-xs text-gray-500 mt-1">CRM · 마일리지</p>
              </div>
            </Link>

            <Link href="/admin">
              <div className="bg-white p-5 rounded-xl shadow hover:shadow-lg transition cursor-pointer text-center">
                <div className="text-3xl mb-2">⚙️</div>
                <h2 className="text-base font-semibold text-gray-900">관리자</h2>
                <p className="text-xs text-gray-500 mt-1">상품 승인</p>
              </div>
            </Link>

            <Link href="/admin/upload">
              <div className="bg-white p-5 rounded-xl shadow hover:shadow-lg transition cursor-pointer text-center">
                <div className="text-3xl mb-2">📤</div>
                <h2 className="text-base font-semibold text-gray-900">문서 업로드</h2>
                <p className="text-xs text-gray-500 mt-1">HWP/PDF/JPG</p>
              </div>
            </Link>
          </div>

          <div className="bg-white p-8 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-gray-900 mb-4">주요 기능</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
              <div>
                <h4 className="font-semibold text-gray-900 mb-3">🏢 관리자 기능</h4>
                <ul className="text-gray-700 space-y-2">
                  <li>✅ HWP/PDF/JPG 문서 자동 파싱</li>
                  <li>✅ 여행 상품 정보 자동 추출</li>
                  <li>✅ 상품 승인 및 마진율 관리</li>
                  <li>✅ AI 콘텐츠 자동 생성</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-gray-900 mb-3">🤖 AI 분석 기능</h4>
                <ul className="text-gray-700 space-y-2">
                  <li>✅ 고객 질문 기반 패키지 추천</li>
                  <li>✅ 여러 패키지 비교 분석</li>
                  <li>✅ 여행 전문가 상담</li>
                  <li>✅ 자동 마진율 계산 및 가격 제시</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
