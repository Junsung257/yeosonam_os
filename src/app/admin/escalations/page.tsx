'use client';

import { useState, useEffect, useCallback } from 'react';

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

/** 담당자 연결 파이프라인에 해당하는 유형 */
const ESCALATION_PIPELINE_TYPES = 'escalation,critic_blocked,escalation_cta';
const CTA_ONLY_TYPE = 'escalation_cta';

function inquiryTypeLabel(t: string): string {
  switch (t) {
    case 'escalation_cta':
      return '전화·카톡 연결';
    case 'critic_blocked':
      return '검증 차단';
    case 'escalation':
      return '담당자 필요';
    default:
      return t;
  }
}

export default function EscalationsPage() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'pipeline' | 'cta_only'>('pipeline');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const types = filter === 'cta_only' ? CTA_ONLY_TYPE : ESCALATION_PIPELINE_TYPES;
      const q = new URLSearchParams({ status: 'pending', inquiryTypes: types });
      const res = await fetch(`/api/qa?${q}`);
      const data = await res.json();
      setInquiries(data.inquiries ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[16px] font-bold text-slate-800">담당자 연결 문의</h1>
          <p className="text-[13px] text-slate-500 mt-1">
            AI 에스컬레이션·검증 차단·고객이 전화/카톡 버튼을 누른 건만 표시합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as 'pipeline' | 'cta_only');
            }}
            className="text-[13px] border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-slate-800"
          >
            <option value="pipeline">전체 (에스컬레이션 파이프라인)</option>
            <option value="cta_only">전화·카톡 버튼만</option>
          </select>
          <button
            type="button"
            onClick={() => load()}
            className="text-[13px] bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50"
          >
            새로고침
          </button>
        </div>
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
                      {inquiryTypeLabel(inq.inquiry_type)}
                    </span>
                    <span className="text-[11px] text-slate-400">{formatDate(inq.created_at)}</span>
                  </div>
                  <p className="text-slate-800 text-[14px] leading-relaxed whitespace-pre-wrap break-words">
                    {inq.question}
                  </p>
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
