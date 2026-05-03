'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import DOMPurify from 'dompurify';

export default function ContractPage() {
  const params  = useParams();
  const rfqId   = params.id as string;

  const [html,    setHtml]    = useState('');
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [printed, setPrinted] = useState(false);

  useEffect(() => {
    fetch(`/api/rfq/${rfqId}/contract`)
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.error ?? '조회 실패'); });
        return r.json();
      })
      .then(d => setHtml(d.contract_html ?? ''))
      .catch(e => setError(e instanceof Error ? e.message : '오류가 발생했습니다'))
      .finally(() => setLoading(false));
  }, [rfqId]);

  function handlePrint() {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    setPrinted(true);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">계약서를 불러오는 중...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
        <p className="text-red-500 text-sm">{error}</p>
        <Link href={`/rfq/${rfqId}`} className="text-[#3182F6] text-sm hover:underline">
          ← 견적 현황으로
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 상단 툴바 */}
      <div className="bg-white border-b sticky top-0 z-10 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/rfq/${rfqId}`} className="text-gray-400 hover:text-gray-600 text-sm">←</Link>
            <div>
              <h1 className="font-semibold text-gray-900">단체여행 표준 계약서</h1>
              <p className="text-xs text-gray-500">RFQ #{rfqId.slice(0, 8)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {printed && (
              <span className="text-xs text-green-600 bg-green-50 px-3 py-1 rounded-full border border-green-200">
                출력 완료
              </span>
            )}
            <button
              onClick={handlePrint}
              className="bg-[#3182F6] hover:bg-[#1B64DA] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
            >
              🖨️ 출력 / PDF
            </button>
          </div>
        </div>
      </div>

      {/* 안내 배너 */}
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs text-amber-700">
            📋 이 계약서는 AI 품질보증 기반으로 자동 생성되었습니다.
            결제 완료 후 에스크로로 보관되며, 여행 완료 시 랜드사에 원가가 정산됩니다.
          </p>
        </div>
      </div>

      {/* 계약서 본문 */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div
          className="bg-white shadow-sm rounded-xl overflow-hidden"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
        />
      </div>

      {/* 하단 서명 안내 */}
      <div className="max-w-4xl mx-auto px-4 pb-12">
        <div className="bg-[#EBF3FE] border border-[#DBEAFE] rounded-xl p-5 text-center">
          <h3 className="font-semibold text-[#191F28] mb-2">계약 동의 및 결제</h3>
          <p className="text-sm text-[#3182F6] mb-4">
            위 계약 내용에 동의하고 에스크로 결제를 진행하시면 계약이 확정됩니다.
          </p>
          <div className="flex gap-3 justify-center">
            <Link
              href={`/rfq/${rfqId}`}
              className="border border-gray-300 text-gray-600 hover:bg-gray-50 px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
            >
              돌아가기
            </Link>
            <button
              className="bg-green-600 hover:bg-green-700 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition-colors"
              onClick={() => alert('에스크로 결제 시스템에 연결됩니다. (프로덕션 연동 필요)')}
            >
              💳 에스크로 결제하기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
