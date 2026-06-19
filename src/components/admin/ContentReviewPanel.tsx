'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, XCircle, RefreshCw, AlertTriangle, FileText } from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ReviewPanelProps {
  creativeId: string;
  onComplete?: () => void;
}

type Decision = 'approved' | 'rejected' | 'changes_requested';

const REJECTION_CATEGORIES = [
  { value: 'quality_low', label: '품질 부족' },
  { value: 'fact_error', label: '사실 오류' },
  { value: 'seo_issue', label: 'SEO 문제' },
  { value: 'brand_violation', label: '브랜드 위반' },
  { value: 'duplicate', label: '중복 콘텐츠' },
  { value: 'inappropriate_tone', label: '부적절한 톤' },
  { value: 'legal_issue', label: '법적 문제' },
  { value: 'other', label: '기타' },
] as const;

// ─── Component ─────────────────────────────────────────────────────────────────

export default function ContentReviewPanel({
  creativeId,
  onComplete,
}: ReviewPanelProps) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creative, setCreative] = useState<{
    id: string;
    title: string;
    blog_html: string;
    channel: string;
    status: string;
    review_status: string;
  } | null>(null);
  const [reviewHistory, setReviewHistory] = useState<
    Array<{
      round: number;
      status: string;
      reviewerId: string;
      reviewedAt: string;
      note: string;
      rejectionCategory: string;
    }>
  >([]);

  // 폼 상태
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [rejectionCategory, setRejectionCategory] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [suggestedChanges, setSuggestedChanges] = useState('');

  // ─── 데이터 로드 ─────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 콘텐츠 정보
      const creativeRes = await fetch(`/api/content-review?creative_id=${creativeId}`);
      if (!creativeRes.ok) throw new Error('콘텐츠 조회 실패');

      const creativeData = await creativeRes.json();
      setCreative(creativeData.creative);
      setReviewHistory(creativeData.history ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '데이터 로드 실패');
    } finally {
      setLoading(false);
    }
  }, [creativeId]);

  useEffect(() => {
    if (creativeId) loadData();
  }, [creativeId, loadData]);

  // state 초기화
  const resetForm = () => {
    setDecision(null);
    setReviewNote('');
    setRejectionCategory('');
    setRejectionReason('');
    setSuggestedChanges('');
  };

  // ─── 제출 ────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!decision) return;
    setSubmitting(true);
    setError(null);

    const payload: Record<string, unknown> = {
      creative_id: creativeId,
      status: decision,
      review_note: reviewNote || null,
      rejection_category: decision === 'rejected' ? rejectionCategory || null : null,
      rejection_reason: decision === 'rejected' ? rejectionReason || null : null,
      suggested_changes:
        decision === 'changes_requested' ? suggestedChanges || null : null,
    };

    try {
      const res = await fetch('/api/content-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error ?? '제출 실패');
      }

      resetForm();
      onComplete?.();
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : '제출 실패');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── 렌더링 ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-admin-muted">
        <RefreshCw size={20} className="animate-spin mr-2" />
        로딩 중...
      </div>
    );
  }

  if (error && !creative) {
    return (
      <div className="rounded-admin-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle size={16} />
          <span className="font-semibold">오류</span>
        </div>
        <p>{error}</p>
        <button
          onClick={loadData}
          className="mt-2 text-xs text-red-600 underline hover:no-underline"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (!creative) {
    return (
      <div className="text-center py-12 text-admin-muted-2">
        콘텐츠를 찾을 수 없습니다.
      </div>
    );
  }

  const showRejectionFields = decision === 'rejected';
  const showChangesFields = decision === 'changes_requested';
  const canSubmit =
    decision &&
    !submitting &&
    (!showRejectionFields || (rejectionCategory && rejectionReason));

  return (
    <div className="bg-white rounded-admin-lg border border-admin-border overflow-hidden">
      {/* ── 헤더 ──────────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b border-admin-border bg-admin-bg/30">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-admin-text">콘텐츠 검토</h3>
            <p className="text-sm text-admin-muted mt-0.5">{creative.title}</p>
          </div>
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${
              creative.review_status === 'approved'
                ? 'bg-green-50 text-green-700 border-green-200'
                : creative.review_status === 'rejected'
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : creative.review_status === 'changes_requested'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : creative.review_status === 'in_review'
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : 'bg-gray-50 text-gray-600 border-gray-200'
            }`}
          >
            <FileText size={12} />
            {creative.review_status === 'none' && '검토 전'}
            {creative.review_status === 'pending_review' && '대기 중'}
            {creative.review_status === 'in_review' && '검토 중'}
            {creative.review_status === 'approved' && '승인됨'}
            {creative.review_status === 'rejected' && '반려'}
            {creative.review_status === 'changes_requested' && '수정 요청'}
          </span>
        </div>
      </div>

      {/* ── 본문 ──────────────────────────────────────────────── */}
      <div className="p-6 space-y-6">
        {/* 콘텐츠 미리보기 */}
        <div>
          <h4 className="text-sm font-bold text-admin-text-2 uppercase tracking-wide mb-2">
            콘텐츠 미리보기
          </h4>
          <div className="rounded-admin-md border border-admin-border-mid bg-admin-bg/20 p-4 max-h-60 overflow-y-auto">
            {creative.blog_html ? (
              <div
                className="prose prose-sm max-w-none text-admin-text [&_img]:max-w-full [&_img]:rounded"
                dangerouslySetInnerHTML={{ __html: creative.blog_html }}
              />
            ) : (
              <p className="text-admin-muted-2 text-sm italic">
                HTML 콘텐츠가 없습니다.
              </p>
            )}
          </div>
        </div>

        {/* 결정 선택 */}
        <div>
          <h4 className="text-sm font-bold text-admin-text-2 uppercase tracking-wide mb-3">
            검토 결정
          </h4>
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => setDecision('approved')}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-admin-md border-2 text-sm font-semibold transition ${
                decision === 'approved'
                  ? 'border-green-400 bg-green-50 text-green-700'
                  : 'border-admin-border-mid text-admin-muted hover:border-green-300 hover:bg-green-50/40'
              }`}
            >
              <CheckCircle2 size={16} />
              승인
            </button>
            <button
              onClick={() => setDecision('changes_requested')}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-admin-md border-2 text-sm font-semibold transition ${
                decision === 'changes_requested'
                  ? 'border-amber-400 bg-amber-50 text-amber-700'
                  : 'border-admin-border-mid text-admin-muted hover:border-amber-300 hover:bg-amber-50/40'
              }`}
            >
              <RefreshCw size={16} />
              수정 요청
            </button>
            <button
              onClick={() => setDecision('rejected')}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-admin-md border-2 text-sm font-semibold transition ${
                decision === 'rejected'
                  ? 'border-red-400 bg-red-50 text-red-700'
                  : 'border-admin-border-mid text-admin-muted hover:border-red-300 hover:bg-red-50/40'
              }`}
            >
              <XCircle size={16} />
              반려
            </button>
          </div>
        </div>

        {/* 반려 사유 카테고리 */}
        {showRejectionFields && (
          <div>
            <label htmlFor="content-review-rejection-category" className="block text-sm font-medium text-admin-text-2 mb-1.5">
              반려 사유 카테고리 <span className="text-red-500">*</span>
            </label>
            <select
              id="content-review-rejection-category"
              value={rejectionCategory}
              onChange={(e) => setRejectionCategory(e.target.value)}
              className="w-full border-2 border-admin-border-mid rounded-admin-md px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 bg-white"
            >
              <option value="">선택하세요</option>
              {REJECTION_CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>

            <label htmlFor="content-review-rejection-reason" className="block text-sm font-medium text-admin-text-2 mb-1.5 mt-3">
              반려 사유 상세 <span className="text-red-500">*</span>
            </label>
            <textarea
              id="content-review-rejection-reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              rows={2}
              placeholder="구체적인 반려 사유를 입력하세요"
              className="w-full border-2 border-admin-border-mid rounded-admin-md px-4 py-2.5 text-sm resize-none focus:outline-none focus:border-blue-500 bg-white"
            />
          </div>
        )}

        {/* 수정 요청 제안 */}
        {showChangesFields && (
          <div>
            <label htmlFor="content-review-suggested-changes" className="block text-sm font-medium text-admin-text-2 mb-1.5">
              수정 제안
            </label>
            <textarea
              id="content-review-suggested-changes"
              value={suggestedChanges}
              onChange={(e) => setSuggestedChanges(e.target.value)}
              rows={3}
              placeholder='예: {"headline": "더 강력한 헤드라인", "body": "SEO 키워드 포함"}'              className="w-full border-2 border-admin-border-mid rounded-admin-md px-4 py-2.5 text-sm resize-none focus:outline-none focus:border-blue-500 bg-white"
            />
            <p className="text-xs text-admin-muted-2 mt-1">
              JSON 형식 또는 자유 텍스트로 수정이 필요한 부분을 설명하세요.
            </p>
          </div>
        )}

        {/* 리뷰 노트 (공통) */}
        <div>
          <label htmlFor="content-review-note" className="block text-sm font-medium text-admin-text-2 mb-1.5">
            검토 메모
          </label>
          <textarea
            id="content-review-note"
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            rows={2}
            placeholder="검토자 코멘트 (선택사항)"
            className="w-full border-2 border-admin-border-mid rounded-admin-md px-4 py-2.5 text-sm resize-none focus:outline-none focus:border-blue-500 bg-white"
          />
        </div>

        {/* 오류 메시지 */}
        {error && (
          <div className="rounded-admin-md bg-red-50 border border-red-200 p-3 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* 제출 버튼 */}
        <div className="flex justify-end gap-3 pt-2 border-t border-admin-border">
          <button
            onClick={resetForm}
            className="px-4 py-2.5 rounded-admin-md border-2 border-admin-border-mid text-sm text-admin-muted hover:bg-admin-surface-2 transition"
          >
            초기화
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-6 py-2.5 rounded-admin-md bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition flex items-center gap-2"
          >
            {submitting ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                제출 중...
              </>
            ) : (
              <>
                <CheckCircle2 size={14} />
                검토 제출
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── 검토 이력 ────────────────────────────────────────── */}
      {reviewHistory.length > 0 && (
        <div className="border-t border-admin-border bg-admin-bg/20">
          <div className="px-6 py-3">
            <h4 className="text-xs font-bold text-admin-muted-2 uppercase tracking-wide mb-2">
              검토 이력 ({reviewHistory.length}회)
            </h4>
            <div className="space-y-2">
              {reviewHistory.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 text-xs p-2 rounded bg-white/50"
                >
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 mt-0.5 ${
                      entry.status === 'approved'
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : entry.status === 'rejected'
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : entry.status === 'changes_requested'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-blue-50 text-blue-700 border-blue-200'
                    }`}
                  >
                    R{entry.round}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-admin-text capitalize">
                      {entry.status === 'approved'
                        ? '승인'
                        : entry.status === 'rejected'
                          ? '반려'
                          : entry.status === 'changes_requested'
                            ? '수정 요청'
                            : entry.status}
                    </p>
                    {entry.note && (
                      <p className="text-admin-muted-2 mt-0.5 truncate">
                        {entry.note}
                      </p>
                    )}
                    {entry.reviewedAt && (
                      <p className="text-admin-muted-2 mt-0.5">
                        {new Date(entry.reviewedAt).toLocaleString('ko-KR')}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
