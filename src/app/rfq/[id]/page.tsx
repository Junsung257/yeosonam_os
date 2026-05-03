'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import DOMPurify from 'dompurify';

// ── 타입 정의 ────────────────────────────────────────────────────────────────
interface GroupRfq {
  id: string;
  rfq_code: string;
  status: string;
  destination: string;
  adult_count: number;
  child_count: number;
  budget_per_person: number;
  hotel_grade: string;
  meal_plan: string;
  gold_unlock_at: string | null;
  silver_unlock_at: string | null;
  bronze_unlock_at: string | null;
  bid_deadline: string | null;
  selected_proposal_id: string | null;
  created_at: string;
  customer_name?: string;
}

interface ChecklistItem {
  included: boolean;
  amount?: number;
  memo?: string;
}

interface RfqProposal {
  id: string;
  rfq_id: string;
  rank: number | null;
  proposal_title: string;
  total_selling_price: number;
  real_total_price: number;
  hidden_cost_estimate: number;
  checklist: Record<string, ChecklistItem>;
  ai_review: {
    score: number;
    issues: string[];
    key_insights?: string[];
  };
  status: string;
}

interface AnalyzeReport {
  report_html: string;
  key_insights: string[];
}

// ── 상수 ─────────────────────────────────────────────────────────────────────
const STATUS_STEPS = [
  { key: 'draft', label: '공고등록' },
  { key: 'published', label: '공고등록' },
  { key: 'bidding', label: '입찰진행' },
  { key: 'analyzing', label: 'AI분석중' },
  { key: 'awaiting_selection', label: '제안선택' },
  { key: 'contracted', label: '계약완료' },
];

const STEP_ORDER = ['draft', 'published', 'bidding', 'analyzing', 'awaiting_selection', 'contracted'];

const RANK_LABELS: Record<number, string> = { 1: '1위', 2: '2위', 3: '3위' };
const RANK_COLORS: Record<number, string> = {
  1: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  2: 'bg-gray-100 text-gray-700 border-gray-300',
  3: 'bg-orange-100 text-orange-700 border-orange-300',
};
const AGENCY_LABELS: Record<number, string> = { 1: 'A사', 2: 'B사', 3: 'C사' };

const fmt = (n: number) => n.toLocaleString('ko-KR');

// ── 상태 타임라인 ─────────────────────────────────────────────────────────────
function StatusTimeline({ status }: { status: string }) {
  const currentIdx = STEP_ORDER.indexOf(status);

  return (
    <div className="flex items-center gap-0 w-full overflow-x-auto">
      {STATUS_STEPS.map((step, idx) => {
        const stepIdx = STEP_ORDER.indexOf(step.key);
        const isCompleted = stepIdx < currentIdx;
        const isActive = stepIdx === currentIdx;
        const isPending = stepIdx > currentIdx;

        return (
          <div key={step.key} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                  isCompleted
                    ? 'bg-green-500 border-green-500 text-white'
                    : isActive
                    ? 'bg-[#3182F6] border-[#3182F6] text-white'
                    : 'bg-white border-gray-300 text-gray-400'
                }`}
              >
                {isCompleted ? '✓' : idx + 1}
              </div>
              <span
                className={`text-xs mt-1 whitespace-nowrap ${
                  isActive ? 'text-[#3182F6] font-semibold' : isPending ? 'text-gray-400' : 'text-green-600'
                }`}
              >
                {step.label}
              </span>
            </div>
            {idx < STATUS_STEPS.length - 1 && (
              <div
                className={`h-0.5 flex-1 mx-1 ${
                  stepIdx < currentIdx ? 'bg-green-400' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 체크리스트 도트 ───────────────────────────────────────────────────────────
const CHECKLIST_LABELS: Record<string, string> = {
  guide_fee: '가이드비',
  driver_tip: '기사팁',
  fuel_surcharge: '유류할증',
};

function ChecklistDots({ checklist }: { checklist: Record<string, ChecklistItem> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(CHECKLIST_LABELS).map(([key, label]) => {
        const item = checklist?.[key];
        const included = item?.included ?? false;
        return (
          <span
            key={key}
            className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${
              included ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full inline-block ${included ? 'bg-green-500' : 'bg-red-500'}`} />
            {label}
          </span>
        );
      })}
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function RfqDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [rfq, setRfq] = useState<GroupRfq | null>(null);
  const [proposals, setProposals] = useState<RfqProposal[]>([]);
  const [bidCount, setBidCount] = useState<number>(0);
  const [report, setReport] = useState<AnalyzeReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selecting, setSelecting] = useState<string | null>(null);

  useEffect(() => {
    fetchAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/id-trigger-only intentional
  }, [id]);

  async function fetchAll() {
    setLoading(true);
    try {
      const [rfqRes, bidRes] = await Promise.all([
        fetch(`/api/rfq/${id}`),
        fetch(`/api/rfq/${id}/bid`),
      ]);
      if (!rfqRes.ok) throw new Error('RFQ를 불러올 수 없습니다');
      const rfqData = await rfqRes.json();
      setRfq(rfqData);

      if (bidRes.ok) {
        const bidData = await bidRes.json();
        setBidCount(Array.isArray(bidData) ? bidData.length : 0);
      }

      if (rfqData.status === 'awaiting_selection' || rfqData.status === 'contracted') {
        const [propRes, analyzeRes] = await Promise.all([
          fetch(`/api/rfq/${id}/proposals`),
          fetch(`/api/rfq/${id}/analyze`),
        ]);
        if (propRes.ok) {
          const propData = await propRes.json();
          setProposals(Array.isArray(propData) ? propData : (propData.proposals ?? []));
        }
        if (analyzeRes.ok) {
          const analyzeData = await analyzeRes.json();
          setReport(analyzeData);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  }

  async function selectProposal(proposalId: string) {
    setSelecting(proposalId);
    try {
      const res = await fetch(`/api/rfq/${id}/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal_id: proposalId }),
      });
      if (!res.ok) throw new Error('선택 실패');
      await fetchAll();
    } catch {
      alert('제안 선택 중 오류가 발생했습니다.');
    } finally {
      setSelecting(null);
    }
  }

  // ── 로딩 / 에러 ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">불러오는 중...</div>
      </div>
    );
  }
  if (error || !rfq) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-red-500 text-sm">{error || 'RFQ를 찾을 수 없습니다'}</div>
      </div>
    );
  }

  const isContracted = rfq.status === 'contracted';
  const showProposals = rfq.status === 'awaiting_selection' || isContracted;

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* 헤더 */}
        <div>
          <Link href="/" className="text-sm text-[#3182F6] hover:underline">← 홈으로</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">단체여행 견적 현황</h1>
          <p className="text-sm text-gray-500 mt-1">RFQ 코드: {rfq.rfq_code}</p>
        </div>

        {/* 상태 타임라인 */}
        <div className="bg-white border shadow-sm rounded-xl p-5">
          <StatusTimeline status={rfq.status} />
        </div>

        {/* 기본 정보 */}
        <div className="bg-white border shadow-sm rounded-xl p-5">
          <h2 className="font-semibold text-gray-900 mb-4">여행 요건</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            {[
              ['목적지', rfq.destination],
              ['인원', `성인 ${rfq.adult_count}명 / 아동 ${rfq.child_count}명`],
              ['예산 (1인)', `₩${fmt(rfq.budget_per_person)}`],
              ['호텔등급', rfq.hotel_grade || '—'],
              ['식사', rfq.meal_plan || '—'],
              ['입찰 마감', rfq.bid_deadline ? rfq.bid_deadline.slice(0, 16) : '—'],
            ].map(([label, value]) => (
              <div key={label}>
                <span className="text-gray-500">{label}: </span>
                <span className="font-medium text-gray-800">{value}</span>
              </div>
            ))}
          </div>

          {/* 입찰중 상태 */}
          {(rfq.status === 'published' || rfq.status === 'bidding') && (
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
              현재 <strong>{bidCount}개</strong>의 랜드사가 입찰에 참여하고 있습니다.
            </div>
          )}
          {/* 분석중 */}
          {rfq.status === 'analyzing' && (
            <div className="mt-4 bg-purple-50 border border-purple-200 rounded-lg px-4 py-3 text-sm text-purple-700">
              🔍 AI가 제안서를 분석 중입니다. 잠시 후 결과를 확인하실 수 있습니다.
            </div>
          )}
        </div>

        {/* 계약 완료 배너 */}
        {isContracted && (
          <div className="bg-green-50 border border-green-300 rounded-xl p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-green-800">🎉 계약이 완료되었습니다!</h3>
                <p className="text-sm text-green-600 mt-1">선택하신 여행사와 계약이 확정되었습니다.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Link
                href={`/rfq/${id}/contract`}
                className="flex-1 text-center bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                📄 계약서 보기
              </Link>
              <Link
                href={`/rfq/${id}/chat`}
                className="flex-1 text-center border border-green-300 text-green-700 hover:bg-green-50 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                💬 채팅하기
              </Link>
            </div>
          </div>
        )}

        {/* 제안서 비교 */}
        {showProposals && proposals.length > 0 && (
          <div className="space-y-4">
            <h2 className="font-bold text-gray-900 text-lg">제안서 비교 (TOP {proposals.length})</h2>
            {proposals.slice(0, 3).map((p) => {
              const rank = p.rank ?? 0;
              const isSelected = rfq.selected_proposal_id === p.id;
              const diff = p.real_total_price - p.total_selling_price;

              return (
                <div
                  key={p.id}
                  className={`bg-white border shadow-sm rounded-xl p-5 ${
                    isSelected ? 'border-green-400 ring-2 ring-green-200' : ''
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                          RANK_COLORS[rank] || 'bg-gray-100 text-gray-600 border-gray-300'
                        }`}
                      >
                        {RANK_LABELS[rank] || `${rank}위`}
                      </span>
                      <span className="font-semibold text-gray-900">
                        {AGENCY_LABELS[rank] || 'N사'}
                      </span>
                      {isSelected && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">선택됨</span>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-gray-900">
                        ₩{fmt(p.total_selling_price)}
                      </div>
                      <div className="text-xs text-gray-500">판매가</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                    <div>
                      <span className="text-gray-500">실질 총액: </span>
                      <span className="font-medium">₩{fmt(p.real_total_price)}</span>
                      {diff > 0 && (
                        <span className="text-red-500 text-xs ml-1">(+₩{fmt(diff)})</span>
                      )}
                    </div>
                    <div>
                      <span className="text-gray-500">AI 점수: </span>
                      <span className="font-bold text-[#3182F6]">{p.ai_review?.score ?? '—'}/100</span>
                    </div>
                  </div>

                  <div className="mb-4">
                    <p className="text-xs text-gray-500 mb-1.5">원가 포함 항목</p>
                    <ChecklistDots checklist={p.checklist || {}} />
                  </div>

                  {!isContracted && (
                    <button
                      onClick={() => selectProposal(p.id)}
                      disabled={selecting === p.id || isContracted}
                      className="w-full bg-[#3182F6] hover:bg-[#1B64DA] disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
                    >
                      {selecting === p.id ? '처리 중...' : '이 제안 선택하기'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* AI 팩트폭격 리포트 */}
        {report && (
          <div className="bg-white border shadow-sm rounded-xl p-5">
            <h2 className="font-bold text-gray-900 mb-4">🤖 AI 팩트폭격 리포트</h2>

            {report.key_insights && report.key_insights.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">핵심 인사이트</h3>
                <ul className="space-y-1">
                  {report.key_insights.map((insight, i) => (
                    <li key={i} className="text-sm text-gray-700 flex gap-2">
                      <span className="text-[#3182F6] flex-shrink-0">•</span>
                      {insight}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {report.report_html && (
              <div
                className="prose prose-sm max-w-none text-gray-700"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(report.report_html) }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
