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
  transport: string;
  special_requests: string;
  customer_name?: string;
  bid_deadline: string | null;
  created_at: string;
}

interface ChecklistItem {
  included: boolean;
  amount?: number;
  memo?: string;
}

interface RfqBid {
  id: string;
  tenant_id: string;
  tenant_name?: string;
  tier?: string;
  status: string;
  trust_score?: number;
  claim_deadline?: string;
  submit_deadline?: string;
  claimed_at?: string;
  submitted_at?: string;
}

interface RfqProposal {
  id: string;
  rfq_id: string;
  tenant_name?: string;
  rank: number | null;
  proposal_title: string;
  total_cost: number;
  total_selling_price: number;
  real_total_price: number;
  hidden_cost_estimate: number;
  checklist: Record<string, ChecklistItem>;
  ai_review: {
    score: number;
    issues: string[];
    key_insights?: string[];
    fact_check?: string;
  };
  status: string;
}

interface RfqMessage {
  id: string;
  sender_type: string;
  raw_content: string;
  processed_content: string;
  pii_blocked: boolean;
  is_visible_to_customer: boolean;
  created_at: string;
}

type Tab = 'info' | 'bids' | 'proposals' | 'messages';

// ── 상수 ─────────────────────────────────────────────────────────────────────
const TIER_COLORS: Record<string, string> = {
  GOLD: 'bg-yellow-100 text-yellow-800',
  SILVER: 'bg-gray-100 text-gray-700',
  BRONZE: 'bg-orange-100 text-orange-700',
};

const BID_STATUS_LABELS: Record<string, string> = {
  invited: '대기중',
  locked: '참여확정',
  submitted: '제출완료',
  timeout: '타임아웃',
  rejected: '탈락',
};

const STATUS_TRANSITIONS = [
  { action: 'published', label: '공고 등록', status: 'published' },
  { action: 'bidding', label: '입찰 시작', status: 'bidding' },
  { action: 'analyzing', label: 'AI 분석 트리거', status: 'analyzing' },
  { action: 'awaiting_selection', label: '선택 대기', status: 'awaiting_selection' },
];

const fmt = (n: number) => n.toLocaleString('ko-KR');

function fmtDate(s?: string | null) {
  if (!s) return '—';
  return s.slice(0, 16).replace('T', ' ');
}

// ── 타이머 컴포넌트 ──────────────────────────────────────────────────────────
function Countdown({ deadline }: { deadline: string }) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    function update() {
      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining('만료됨');
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${h}시간 ${m}분 ${s}초`);
    }
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [deadline]);

  return <span className="font-mono text-red-600 text-xs">{remaining}</span>;
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function AdminRfqDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [rfq, setRfq] = useState<GroupRfq | null>(null);
  const [bids, setBids] = useState<RfqBid[]>([]);
  const [proposals, setProposals] = useState<RfqProposal[]>([]);
  const [messages, setMessages] = useState<RfqMessage[]>([]);
  const [report, setReport] = useState<{ report_html: string; key_insights: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('info');
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    fetchAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/id-trigger-only intentional
  }, [id]);

  async function fetchAll() {
    setLoading(true);
    setError('');
    try {
      const [rfqRes, bidsRes, propsRes, msgsRes] = await Promise.all([
        fetch(`/api/rfq/${id}`),
        fetch(`/api/rfq/${id}/bid`),
        fetch(`/api/rfq/${id}/proposals`),
        fetch(`/api/rfq/${id}/messages?viewAs=admin`),
      ]);
      if (!rfqRes.ok) throw new Error('RFQ 데이터를 불러올 수 없습니다');
      const rfqData = await rfqRes.json();
      setRfq(rfqData.rfq ?? rfqData);
      if (bidsRes.ok) {
        const bidsData = await bidsRes.json();
        setBids(Array.isArray(bidsData) ? bidsData : (bidsData.bids ?? []));
      }
      if (propsRes.ok) {
        const propsData = await propsRes.json();
        setProposals(Array.isArray(propsData) ? propsData : (propsData.proposals ?? []));
      }
      if (msgsRes.ok) {
        const msgsData = await msgsRes.json();
        setMessages(Array.isArray(msgsData) ? msgsData : (msgsData.messages ?? []));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  }

  async function transition(status: string) {
    setTransitioning(status);
    try {
      const res = await fetch(`/api/rfq/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'transition', status }),
      });
      if (!res.ok) throw new Error('상태 변경 실패');
      await fetchAll();
    } catch {
      alert('상태 변경 중 오류가 발생했습니다.');
    } finally {
      setTransitioning(null);
    }
  }

  async function runAnalysis() {
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/rfq/${id}/analyze`, { method: 'POST' });
      if (!res.ok) throw new Error('분석 실패');
      const data = await res.json();
      setReport(data);
    } catch {
      alert('AI 분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzing(false);
    }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'info', label: '요건정보' },
    { key: 'bids', label: `입찰현황 (${bids.length})` },
    { key: 'proposals', label: `제안서 비교 (${proposals.length})` },
    { key: 'messages', label: `메시지 (${messages.length})` },
  ];

  if (loading) {
    return <div className="p-8 text-gray-400 text-sm">불러오는 중...</div>;
  }
  if (error || !rfq) {
    return <div className="p-8 text-red-500 text-sm">{error || 'RFQ를 찾을 수 없습니다'}</div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <Link href="/admin/rfqs" className="text-sm text-indigo-600 hover:underline">
            ← RFQ 목록
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">
            {rfq.rfq_code}
          </h1>
          <p className="text-sm text-gray-500">{rfq.destination} · {rfq.customer_name || '고객'}</p>
        </div>
        <span className="text-sm bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-full font-semibold">
          {rfq.status}
        </span>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white shadow-sm text-indigo-700 font-semibold'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab 1: 요건정보 ─────────────────────────────────────────────────── */}
      {activeTab === 'info' && (
        <div className="space-y-4">
          <div className="bg-white border shadow-sm rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 mb-4">RFQ 요건</h2>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              {[
                ['RFQ 코드', rfq.rfq_code],
                ['고객명', rfq.customer_name || '—'],
                ['목적지', rfq.destination],
                ['인원', `성인 ${rfq.adult_count}명 / 아동 ${rfq.child_count}명`],
                ['예산 (1인)', `₩${fmt(rfq.budget_per_person)}`],
                ['호텔등급', rfq.hotel_grade || '—'],
                ['식사', rfq.meal_plan || '—'],
                ['교통', rfq.transport || '—'],
                ['입찰 마감', fmtDate(rfq.bid_deadline)],
                ['등록일', fmtDate(rfq.created_at)],
              ].map(([label, value]) => (
                <div key={label}>
                  <span className="text-gray-500">{label}: </span>
                  <span className="font-medium text-gray-800">{value}</span>
                </div>
              ))}
              {rfq.special_requests && (
                <div className="col-span-2">
                  <span className="text-gray-500">특별요청: </span>
                  <span className="font-medium text-gray-800">{rfq.special_requests}</span>
                </div>
              )}
            </div>
          </div>

          {/* 상태 전환 (테스트) */}
          <div className="bg-white border shadow-sm rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 mb-3">
              상태 전환
              <span className="ml-2 text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded">테스트용</span>
            </h2>
            <div className="flex gap-2 flex-wrap">
              {STATUS_TRANSITIONS.map((t) => (
                <button
                  key={t.action}
                  onClick={() => transition(t.status)}
                  disabled={transitioning === t.status}
                  className="text-sm border border-indigo-300 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 px-4 py-2 rounded-lg transition-colors"
                >
                  테스트: {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab 2: 입찰현황 ─────────────────────────────────────────────────── */}
      {activeTab === 'bids' && (
        <div className="bg-white border shadow-sm rounded-xl overflow-hidden">
          {bids.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">입찰 내역이 없습니다</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['랜드사명', '티어', '입찰시각', '제출마감', '제출여부', '신뢰도', '상태'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bids.map((bid) => (
                  <tr key={bid.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {bid.tenant_name || bid.tenant_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">
                      {bid.tier && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${TIER_COLORS[bid.tier] || 'bg-gray-100 text-gray-600'}`}>
                          {bid.tier}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(bid.claimed_at)}</td>
                    <td className="px-4 py-3 text-xs">
                      {bid.status === 'locked' && bid.submit_deadline ? (
                        <Countdown deadline={bid.submit_deadline} />
                      ) : (
                        <span className="text-gray-500">{fmtDate(bid.submit_deadline)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={bid.submitted_at ? 'text-green-600' : 'text-gray-400'}>
                        {bid.submitted_at ? '제출완료' : '미제출'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {bid.trust_score != null ? `${bid.trust_score}점` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                        {BID_STATUS_LABELS[bid.status] || bid.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Tab 3: 제안서 비교 ───────────────────────────────────────────────── */}
      {activeTab === 'proposals' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={runAnalysis}
              disabled={analyzing}
              className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
            >
              {analyzing ? '분석 중...' : '🤖 AI 분석 실행'}
            </button>
          </div>

          {proposals.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm bg-white border shadow-sm rounded-xl">
              제출된 제안서가 없습니다
            </div>
          ) : (
            proposals.map((p) => (
              <div key={p.id} className="bg-white border shadow-sm rounded-xl p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-gray-900">{p.tenant_name || '랜드사'}</h3>
                    <p className="text-sm text-gray-500">{p.proposal_title}</p>
                  </div>
                  <div className="text-right">
                    {p.rank && (
                      <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full mr-2">
                        {p.rank}위
                      </span>
                    )}
                    <span className="text-lg font-bold text-indigo-600">
                      {p.ai_review?.score ?? '—'}점
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-0.5">원가 (내부)</p>
                    <p className="font-semibold text-gray-800">₩{fmt(p.total_cost)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-0.5">판매가</p>
                    <p className="font-semibold text-gray-800">₩{fmt(p.total_selling_price)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-0.5">실질 총액</p>
                    <p className="font-semibold text-gray-800">₩{fmt(p.real_total_price)}</p>
                  </div>
                </div>

                {/* 체크리스트 */}
                <div className="mb-3">
                  <p className="text-xs text-gray-500 mb-1.5">원가 체크리스트</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(p.checklist || {}).map(([key, item]) => (
                      <span
                        key={key}
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          item.included ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                        }`}
                      >
                        {item.included ? '✓' : '✗'} {key}
                        {!item.included && item.amount ? ` (₩${fmt(item.amount)})` : ''}
                      </span>
                    ))}
                  </div>
                </div>

                {/* AI 리뷰 */}
                {p.ai_review?.issues && p.ai_review.issues.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1">AI 검토 사항</p>
                    <ul className="space-y-0.5">
                      {p.ai_review.issues.map((issue, i) => (
                        <li key={i} className="text-xs text-red-600 flex gap-1">
                          <span>⚠</span>{issue}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))
          )}

          {/* 분석 리포트 */}
          {report && (
            <div className="bg-white border border-purple-200 shadow-sm rounded-xl p-5">
              <h3 className="font-semibold text-gray-900 mb-3">🤖 AI 분석 리포트</h3>
              {report.key_insights?.length > 0 && (
                <ul className="mb-4 space-y-1">
                  {report.key_insights.map((i, idx) => (
                    <li key={idx} className="text-sm text-gray-700 flex gap-2">
                      <span className="text-purple-500">•</span>{i}
                    </li>
                  ))}
                </ul>
              )}
              <div
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(report.report_html) }}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Tab 4: 메시지 ───────────────────────────────────────────────────── */}
      {activeTab === 'messages' && (
        <div className="space-y-3">
          {messages.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm bg-white border shadow-sm rounded-xl">
              메시지가 없습니다
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className="bg-white border shadow-sm rounded-xl p-4 text-sm">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        msg.sender_type === 'customer'
                          ? 'bg-indigo-100 text-indigo-700'
                          : msg.sender_type === 'tenant'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {msg.sender_type === 'customer' ? '고객' : msg.sender_type === 'tenant' ? '랜드사' : 'AI/시스템'}
                    </span>
                    {msg.pii_blocked && (
                      <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                        ⚠️ PII 차단
                      </span>
                    )}
                    {!msg.is_visible_to_customer && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                        고객 비공개
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">{fmtDate(msg.created_at)}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">원본 (raw)</p>
                    <p className="text-gray-700 whitespace-pre-wrap bg-gray-50 rounded p-2 text-xs">
                      {msg.raw_content}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">AI 정제본</p>
                    <p className="text-gray-700 whitespace-pre-wrap bg-blue-50 rounded p-2 text-xs">
                      {msg.processed_content}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
