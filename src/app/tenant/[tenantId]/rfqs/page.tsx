'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// ── 타입 정의 ────────────────────────────────────────────────────────────────
interface BidInfo {
  id: string;
  status: string;
  claimed_at?: string;
  submitted_at?: string;
}

interface TenantRfq {
  id: string;
  rfq_code: string;
  status: string;
  destination: string;
  departure_date?: string;
  adult_count: number;
  child_count: number;
  budget_per_person: number;
  hotel_grade: string;
  is_unlocked: boolean;
  unlocks_in_seconds: number;
  my_bid?: BidInfo;
}

// ── 상수 ─────────────────────────────────────────────────────────────────────
const BID_STATUS_LABELS: Record<string, string> = {
  invited: '초대됨',
  locked: '참여 확정',
  submitted: '제출 완료',
  timeout: '시간 초과',
  rejected: '탈락',
};

const BID_STATUS_COLORS: Record<string, string> = {
  invited: 'bg-gray-100 text-gray-600',
  locked: 'bg-blue-100 text-blue-700',
  submitted: 'bg-green-100 text-green-700',
  timeout: 'bg-red-100 text-red-600',
  rejected: 'bg-gray-100 text-gray-400',
};

const fmt = (n: number) => n.toLocaleString('ko-KR');

// ── 카운트다운 ────────────────────────────────────────────────────────────────
function UnlockCountdown({ seconds }: { seconds: number }) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
    if (seconds <= 0) return;
    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [seconds]);

  const m = Math.floor(remaining / 60);
  const s = remaining % 60;

  return (
    <span className="font-mono text-gray-500 text-sm">
      {m > 0 ? `${m}분 ` : ''}{s}초 후 오픈
    </span>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function TenantRfqsPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;

  const [rfqs, setRfqs] = useState<TenantRfq[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchRfqs();
    const interval = setInterval(fetchRfqs, 30000);
    return () => clearInterval(interval);
  }, [tenantId]);

  async function fetchRfqs() {
    try {
      const res = await fetch(`/api/tenant/rfqs?tenant_id=${tenantId}`);
      if (!res.ok) throw new Error('데이터를 불러올 수 없습니다');
      const data = await res.json();
      setRfqs(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  }

  const unlockedCount = rfqs.filter((r) => r.is_unlocked).length;
  const pendingCount = rfqs.filter((r) => !r.is_unlocked).length;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">📋 입찰 가능 RFQ</h1>
        <p className="text-sm text-gray-500 mt-1">단체여행 견적 요청에 입찰하세요</p>
      </div>

      {/* 티어별 안내 */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-indigo-800 mb-2">티어별 우선 노출 안내</h3>
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="bg-yellow-100 text-yellow-800 text-xs font-bold px-2 py-0.5 rounded-full">GOLD</span>
            <span className="text-gray-600">공고 등록 즉시 노출</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-gray-100 text-gray-700 text-xs font-bold px-2 py-0.5 rounded-full">SILVER</span>
            <span className="text-gray-600">+N분 후 노출</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-orange-100 text-orange-700 text-xs font-bold px-2 py-0.5 rounded-full">BRONZE</span>
            <span className="text-gray-600">+2N분 후 노출</span>
          </div>
        </div>
      </div>

      {/* 요약 */}
      <div className="flex gap-4 text-sm text-gray-600">
        <span>
          <strong className="text-indigo-700">{unlockedCount}</strong>건 입찰 가능
        </span>
        <span>
          <strong className="text-gray-500">{pendingCount}</strong>건 대기 중
        </span>
      </div>

      {/* 컨텐츠 */}
      {loading ? (
        <div className="text-center text-gray-400 py-12 text-sm">불러오는 중...</div>
      ) : error ? (
        <div className="text-center text-red-500 py-12 text-sm">{error}</div>
      ) : rfqs.length === 0 ? (
        <div className="text-center py-16 bg-white border shadow-sm rounded-xl">
          <p className="text-3xl mb-3">📭</p>
          <p className="text-gray-500 font-medium">현재 입찰 가능한 RFQ가 없습니다</p>
          <p className="text-sm text-gray-400 mt-1">새로운 단체여행 견적 요청이 등록되면 알림을 드립니다.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rfqs.map((rfq) => (
            <div
              key={rfq.id}
              className={`bg-white border shadow-sm rounded-xl p-5 transition-shadow ${
                rfq.is_unlocked ? 'hover:shadow-md' : 'opacity-75'
              }`}
            >
              {/* 카드 헤더 */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900 text-base">{rfq.destination}</h3>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">{rfq.rfq_code}</p>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    rfq.is_unlocked ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {rfq.is_unlocked ? '🔓 오픈' : '🔒 대기'}
                </span>
              </div>

              {/* 정보 */}
              <div className="grid grid-cols-2 gap-2 text-sm mb-4">
                <div>
                  <span className="text-gray-400">출발 희망: </span>
                  <span className="text-gray-700">{rfq.departure_date || '미정'}</span>
                </div>
                <div>
                  <span className="text-gray-400">인원: </span>
                  <span className="text-gray-700">
                    {rfq.adult_count + rfq.child_count}명
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">예산 (1인): </span>
                  <span className="font-medium text-gray-800">₩{fmt(rfq.budget_per_person)}</span>
                </div>
                <div>
                  <span className="text-gray-400">호텔: </span>
                  <span className="text-gray-700">{rfq.hotel_grade || '—'}</span>
                </div>
              </div>

              {/* 내 입찰 상태 */}
              {rfq.my_bid && (
                <div className="mb-3">
                  <span
                    className={`text-xs px-2 py-1 rounded-full font-medium ${
                      BID_STATUS_COLORS[rfq.my_bid.status] || 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {BID_STATUS_LABELS[rfq.my_bid.status] || rfq.my_bid.status}
                  </span>
                </div>
              )}

              {/* 액션 */}
              {rfq.is_unlocked && !rfq.my_bid ? (
                <Link
                  href={`/tenant/${tenantId}/rfqs/${rfq.id}`}
                  className="block w-full text-center bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  입찰하기
                </Link>
              ) : rfq.is_unlocked && rfq.my_bid ? (
                <Link
                  href={`/tenant/${tenantId}/rfqs/${rfq.id}`}
                  className="block w-full text-center border border-indigo-300 text-indigo-700 hover:bg-indigo-50 py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  상세 보기
                </Link>
              ) : (
                <div className="flex items-center justify-center gap-2 py-2.5 bg-gray-50 rounded-lg">
                  <span className="text-gray-400 text-lg">🔒</span>
                  <UnlockCountdown seconds={rfq.unlocks_in_seconds} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
