'use client';

import { useState, useEffect } from 'react';

interface Inquiry {
  id: string;
  question: string;
  inquiry_type: string;
  status: string;
  created_at: string;
  related_packages?: string[];
  customer_name?: string;
  customer_email?: string;
}

export default function EscalationsPage() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  async function load() {
    setIsLoading(true);
    try {
      const res = await fetch('/api/qa?status=pending');
      const data = await res.json();
      setInquiries(data.inquiries ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function resolve(id: string) {
    await fetch('/api/qa', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inquiryId: id, status: 'resolved' }),
    });
    load();
  }

  const formatDate = (s: string) => new Date(s).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-bold text-slate-800">담당자 연결 문의</h1>
          <p className="text-[13px] text-slate-500 mt-1">AI가 처리하지 못한 문의 -- 직접 답변이 필요합니다</p>
        </div>
        <button
          onClick={load}
          className="text-[13px] bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50"
        >
          새로고침
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-20 text-slate-500 text-[14px]">불러오는 중...</div>
      ) : inquiries.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-lg border border-slate-200">
          <p className="text-slate-500 text-[14px] font-medium">처리 대기 중인 문의가 없습니다</p>
          <p className="text-slate-400 text-[13px] mt-1">모든 문의가 AI에 의해 처리되었습니다</p>
        </div>
      ) : (
        <div className="space-y-2">
          {inquiries.map(inq => (
            <div key={inq.id} className="bg-white rounded-lg border border-slate-200 border-l-4 border-l-amber-400 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                      {inq.inquiry_type === 'escalation' ? '담당자 필요' : inq.inquiry_type}
                    </span>
                    <span className="text-[11px] text-slate-400">{formatDate(inq.created_at)}</span>
                  </div>
                  <p className="text-slate-800 text-[14px] leading-relaxed">{inq.question}</p>
                  {inq.customer_name && (
                    <p className="text-[13px] text-slate-500 mt-2">
                      고객: {inq.customer_name} {inq.customer_email && `(${inq.customer_email})`}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => resolve(inq.id)}
                  className="shrink-0 bg-[#001f3f] text-white text-[13px] px-4 py-2 rounded-lg hover:bg-blue-900 transition"
                >
                  처리 완료
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
