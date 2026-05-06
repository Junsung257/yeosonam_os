'use client';

/**
 * Phase 3-E: 리뷰 감정 분석 어드민 페이지
 * /admin/reviews
 */

import { useEffect, useState, useCallback } from 'react';
import { getSecret } from '@/lib/secret-registry';

interface ReviewRow {
  id: string;
  package_id: string | null;
  booking_id: string | null;
  customer_id: string | null;
  rating: number;
  content: string | null;
  sentiment_score: number | null;
  sentiment_tags: Record<string, number> | null;
  sentiment_analyzed_at: string | null;
  created_at: string;
}

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="text-amber-400 font-mono text-admin-sm">
      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
    </span>
  );
}

function SentimentBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-400">
        분석 대기
      </span>
    );
  }
  const color =
    score >= 70 ? 'bg-emerald-100 text-emerald-700' :
    score >= 40 ? 'bg-amber-100 text-amber-700' :
    'bg-red-100 text-red-700';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${color}`}>
      {score}점
    </span>
  );
}

function TagChips({ tags }: { tags: Record<string, number> | null }) {
  if (!tags) return <span className="text-slate-300 text-[11px]">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(tags).map(([key, val]) => (
        <span
          key={key}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px]"
        >
          {key} <span className="font-semibold">{val}</span>
        </span>
      ))}
    </div>
  );
}

export default function ReviewsAdminPage() {
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/package-reviews?limit=50');
      const json = await res.json() as { reviews?: ReviewRow[]; error?: string };
      if (json.error) throw new Error(json.error);
      setReviews(json.reviews ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchReviews();
  }, [fetchReviews]);

  const triggerSentimentCron = async () => {
    setTriggering(true);
    try {
      const secret = getSecret('NEXT_PUBLIC_CRON_SECRET') ?? '';
      const res = await fetch(`/api/cron/review-sentiment?secret=${secret}`);
      const json = await res.json() as { ok?: boolean; analyzed?: number; failed?: number; error?: string };
      if (!json.ok) {
        alert(`분석 실패: ${json.error ?? '알 수 없는 오류'}`);
      } else {
        alert(`분석 완료: ${json.analyzed}건 처리, ${json.failed ?? 0}건 실패`);
        await fetchReviews();
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : '오류');
    } finally {
      setTriggering(false);
    }
  };

  const analyzedCount = reviews.filter(r => r.sentiment_analyzed_at !== null).length;
  const pendingCount = reviews.length - analyzedCount;
  const avgScore =
    analyzedCount > 0
      ? Math.round(
          reviews.filter(r => r.sentiment_score !== null).reduce((s, r) => s + (r.sentiment_score ?? 0), 0) /
            analyzedCount,
        )
      : null;

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-slate-800">리뷰 감정 분석</h1>
          <p className="text-admin-xs text-slate-400 mt-0.5">
            고객 리뷰 목록 · AI 감정 점수 분석
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void fetchReviews()}
            disabled={loading}
            className="px-3 py-2 bg-white border border-slate-300 text-slate-600 text-admin-xs rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
          >
            새로고침
          </button>
          <button
            onClick={() => void triggerSentimentCron()}
            disabled={triggering || pendingCount === 0}
            className="px-3 py-2 bg-blue-600 text-white text-admin-xs rounded-lg hover:bg-blue-700 transition disabled:opacity-40"
          >
            {triggering ? '분석 중…' : `감정 분석 실행 (${pendingCount}건 대기)`}
          </button>
        </div>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-slate-100 rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <p className="text-[11px] text-slate-400 uppercase tracking-wide">전체 리뷰</p>
          <p className="text-[24px] font-bold text-slate-800 mt-1">{reviews.length}</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <p className="text-[11px] text-slate-400 uppercase tracking-wide">분석 완료</p>
          <p className="text-[24px] font-bold text-emerald-600 mt-1">{analyzedCount}</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <p className="text-[11px] text-slate-400 uppercase tracking-wide">평균 감정 점수</p>
          <p className="text-[24px] font-bold text-blue-600 mt-1">
            {avgScore !== null ? `${avgScore}점` : '—'}
          </p>
        </div>
      </div>

      {/* 오류 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-admin-xs text-red-600">
          {error}
        </div>
      )}

      {/* 테이블 */}
      <div className="bg-white border border-slate-100 rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
        {loading ? (
          <table className="w-full text-admin-xs">
            <thead>
              <tr className="border-b-2 border-slate-100">
                {['작성일', '별점', '내용 (일부)', '감정 점수', '카테고리 점수'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/80">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-100">
                  {[70, 80, 200, 50, 130].map((w, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3 bg-slate-100 rounded animate-pulse" style={{ width: w }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : reviews.length === 0 ? (
          <div className="py-14 flex flex-col items-center gap-3">
            <svg className="w-10 h-10 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" /></svg>
            <p className="text-admin-sm font-medium text-slate-500">리뷰가 없습니다.</p>
          </div>
        ) : (
          <table className="w-full text-admin-xs">
            <thead>
              <tr className="border-b-2 border-slate-100">
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/80 w-[90px]">작성일</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/80 w-[90px]">별점</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/80">내용 (일부)</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/80 w-[80px]">감정 점수</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/80 w-[220px]">카테고리 점수</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map(r => (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}
                  </td>
                  <td className="px-4 py-3">
                    <StarRating rating={r.rating} />
                  </td>
                  <td className="px-4 py-3 text-slate-600 max-w-[300px] truncate">
                    {r.content ?? <span className="text-slate-300 italic">내용 없음</span>}
                  </td>
                  <td className="px-4 py-3">
                    <SentimentBadge score={r.sentiment_score} />
                  </td>
                  <td className="px-4 py-3">
                    <TagChips tags={r.sentiment_tags} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
