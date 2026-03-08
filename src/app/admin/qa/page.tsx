'use client';

import { useState, useEffect } from 'react';

interface Inquiry {
  id: string;
  question: string;
  inquiry_type: string;
  customer_name?: string;
  customer_email?: string;
  status: string;
  created_at: string;
  ai_responses?: { id: string; response_text: string; approved: boolean }[];
}

export default function QAPage() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [question, setQuestion] = useState('');
  const [inquiryType, setInquiryType] = useState('general_consultation');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null);
  const [showForm, setShowForm] = useState(false);

  // 문의 로드
  const loadInquiries = async () => {
    try {
      const response = await fetch('/api/qa?action=list');
      const data = await response.json();
      setInquiries(data.inquiries || []);
    } catch (err) {
      console.error('문의 로드 실패:', err);
    }
  };

  useEffect(() => {
    loadInquiries();
  }, []);

  // 문의 제출
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) {
      setError('질문을 입력해주세요.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          inquiryType,
          customerName: customerName || '익명',
          customerEmail,
          aiModel: 'gemini',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '문의 제출 실패');
      }

      // 성공
      setQuestion('');
      setCustomerName('');
      setCustomerEmail('');
      setShowForm(false);
      loadInquiries();

      alert('문의가 등록되었습니다!');
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류 발생');
    } finally {
      setIsLoading(false);
    }
  };

  const inquiryTypeLabel: Record<string, string> = {
    general_consultation: '일반 상담',
    product_recommendation: '상품 추천',
    price_comparison: '가격 비교',
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">FAQ & 상담</h1>
          <p className="text-gray-600">여행 상품 추천, 가격 비교, 전문가 상담을 받으세요</p>
        </div>

        {/* 문의 폼 */}
        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="mb-8 bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 transition"
          >
            + 새로운 문의하기
          </button>
        ) : (
          <div className="bg-white p-6 rounded-lg shadow mb-8">
            <h2 className="text-2xl font-semibold mb-6">문의 작성</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  문의 유형 *
                </label>
                <select
                  value={inquiryType}
                  onChange={(e) => setInquiryType(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                >
                  <option value="general_consultation">일반 상담</option>
                  <option value="product_recommendation">상품 추천</option>
                  <option value="price_comparison">가격 비교</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  질문 내용 *
                </label>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="예: 5월에 가족과 함께 3박 4일 여행을 가려고 합니다. 오사카 추천해주세요."
                  rows={5}
                  className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                  disabled={isLoading}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    이름
                  </label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="이름 (선택)"
                    className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    이메일
                  </label>
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="이메일 (선택)"
                    className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    disabled={isLoading}
                  />
                </div>
              </div>

              {error && <div className="p-3 bg-red-100 text-red-700 rounded">{error}</div>}

              <div className="flex gap-4">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 bg-blue-600 text-white py-3 rounded-md hover:bg-blue-700 disabled:bg-gray-400 transition"
                >
                  {isLoading ? '전송 중...' : '문의 제출'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 bg-gray-300 text-gray-900 py-3 rounded-md hover:bg-gray-400 transition"
                >
                  취소
                </button>
              </div>
            </form>
          </div>
        )}

        {/* 문의 목록 */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-2xl font-semibold">문의 목록</h2>
          </div>

          {inquiries.length === 0 ? (
            <div className="p-6 text-center text-gray-500">문의가 없습니다.</div>
          ) : (
            <div className="divide-y">
              {inquiries.map((inquiry) => (
                <div
                  key={inquiry.id}
                  className="p-6 hover:bg-gray-50 cursor-pointer transition"
                  onClick={() => setSelectedInquiry(inquiry)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900">{inquiry.customer_name || '익명'}</span>
                        <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
                          {inquiryTypeLabel[inquiry.inquiry_type] || inquiry.inquiry_type}
                        </span>
                        <span
                          className={`px-2 py-1 text-xs rounded ${
                            inquiry.status === 'answered'
                              ? 'bg-green-100 text-green-800'
                              : inquiry.status === 'closed'
                                ? 'bg-gray-100 text-gray-800'
                                : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {inquiry.status === 'pending'
                            ? '대기중'
                            : inquiry.status === 'answered'
                              ? '답변완료'
                              : '종료'}
                        </span>
                      </div>
                      <p className="text-gray-700 line-clamp-2">{inquiry.question}</p>
                    </div>
                    <span className="text-sm text-gray-500">
                      {new Date(inquiry.created_at).toLocaleDateString('ko-KR')}
                    </span>
                  </div>

                  {inquiry.ai_responses && inquiry.ai_responses.length > 0 && (
                    <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded text-sm">
                      <span className="text-green-700">✓ AI 답변완료</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 상세 보기 모달 */}
        {selectedInquiry && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-2xl font-semibold">{selectedInquiry.customer_name || '익명'}</h3>
                <p className="text-sm text-gray-500">
                  {new Date(selectedInquiry.created_at).toLocaleString('ko-KR')}
                </p>
              </div>

              <div className="p-6 space-y-6">
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">질문</h4>
                  <p className="text-gray-700 whitespace-pre-wrap">{selectedInquiry.question}</p>
                </div>

                {selectedInquiry.ai_responses && selectedInquiry.ai_responses.length > 0 && (
                  <div className="border-t pt-6">
                    <h4 className="font-semibold text-gray-900 mb-2">AI 답변</h4>
                    {selectedInquiry.ai_responses.map((response, idx) => (
                      <div key={idx} className="bg-blue-50 p-4 rounded-lg">
                        <p className="text-gray-700 whitespace-pre-wrap">{response.response_text}</p>
                        <div className="mt-3 flex items-center gap-2">
                          {response.approved ? (
                            <span className="text-sm text-green-700">✓ 승인됨</span>
                          ) : (
                            <span className="text-sm text-yellow-700">대기중</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-gray-200 flex justify-end">
                <button
                  onClick={() => setSelectedInquiry(null)}
                  className="px-6 py-2 bg-gray-300 text-gray-900 rounded-md hover:bg-gray-400 transition"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}