'use client';
import BookingGuideTemplate from '@/components/admin/BookingGuideTemplate';

export default function BookingGuidePage() {
  return (
    <div className="min-h-screen bg-gray-100 py-10">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6 px-4">
          <h1 className="text-xl font-bold text-slate-800">📋 예약 안내문 (공통)</h1>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
          >
            인쇄 / PDF 저장
          </button>
        </div>
        <BookingGuideTemplate />
      </div>
    </div>
  );
}
