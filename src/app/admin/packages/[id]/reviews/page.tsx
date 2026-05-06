'use client';

/**
 * /admin/packages/[id]/reviews
 *
 * 고객 후기 수동 관리 페이지
 * - 카카오톡/이메일 피드백 → admin_seeded 리뷰로 DB 등록
 * - 리뷰 승인(approved) / 숨김(rejected) 토글
 * - 리뷰 삭제
 *
 * 확장 전략: verified_booking 리뷰는 고객 예약 완료 후 자동 생성.
 * 현재는 admin_seeded 만 수동 입력.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';

interface ReviewRow {
  id: string;
  overall_rating: number;
  value_for_money: number | null;
  itinerary_quality: number | null;
  guide_quality: number | null;
  accommodation_quality: number | null;
  food_quality: number | null;
  title: string | null;
  review_text: string | null;
  pros: string[] | null;
  helpful_count: number;
  source_type: string;
  status: string;
  created_at: string;
  customers: { name: string | null } | null;
}

const RATING_FIELDS = [
  { key: 'value_for_money', label: '가성비' },
  { key: 'itinerary_quality', label: '일정' },
  { key: 'guide_quality', label: '가이드' },
  { key: 'accommodation_quality', label: '숙박' },
  { key: 'food_quality', label: '식사' },
];

function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`text-xl transition-colors ${n <= value ? 'text-amber-400' : 'text-slate-200 hover:text-amber-300'}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    approved: 'bg-emerald-100 text-emerald-700',
    pending: 'bg-amber-100 text-amber-700',
    rejected: 'bg-slate-100 text-slate-500',
  };
  const label: Record<string, string> = { approved: '노출', pending: '대기', rejected: '숨김' };
  return (
    <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${map[status] || 'bg-slate-100 text-slate-500'}`}>
      {label[status] || status}
    </span>
  );
}

const DEFAULT_FORM = {
  reviewer_name: '',
  overall_rating: 5,
  value_for_money: 0,
  itinerary_quality: 0,
  guide_quality: 0,
  accommodation_quality: 0,
  food_quality: 0,
  title: '',
  review_text: '',
  pros_raw: '',
};

export default function PackageReviewsAdminPage() {
  const params = useParams();
  const packageId = String(params?.id || '');

  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/packages/${packageId}/reviews`);
      const json = await res.json();
      setReviews(json.data || []);
    } finally {
      setLoading(false);
    }
  }, [packageId]);

  useEffect(() => { if (packageId) load(); }, [packageId, load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const pros = form.pros_raw.split('\n').map(s => s.trim()).filter(Boolean);
      const res = await fetch(`/api/packages/${packageId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewer_name: form.reviewer_name || null,
          overall_rating: form.overall_rating,
          value_for_money: form.value_for_money || null,
          itinerary_quality: form.itinerary_quality || null,
          guide_quality: form.guide_quality || null,
          accommodation_quality: form.accommodation_quality || null,
          food_quality: form.food_quality || null,
          title: form.title || null,
          review_text: form.review_text || null,
          pros: pros.length ? pros : null,
          source_type: 'admin_seeded',
          status: 'approved',
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        showToast(`오류: ${j.error}`);
        return;
      }
      setForm(DEFAULT_FORM);
      setShowForm(false);
      showToast('✅ 후기 등록 완료');
      load();
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (reviewId: string, current: string) => {
    const next = current === 'approved' ? 'rejected' : 'approved';
    await fetch(`/api/packages/${packageId}/reviews`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId, status: next }),
    });
    showToast(next === 'approved' ? '✅ 노출로 변경' : '🙈 숨김 처리');
    load();
  };

  const deleteReview = async (reviewId: string) => {
    if (!confirm('이 후기를 삭제하시겠습니까?')) return;
    await fetch(`/api/packages/${packageId}/reviews?reviewId=${reviewId}`, { method: 'DELETE' });
    showToast('🗑️ 삭제됨');
    load();
  };

  const approvedCount = reviews.filter(r => r.status === 'approved').length;
  const avgRating = approvedCount > 0
    ? (reviews.filter(r => r.status === 'approved').reduce((s, r) => s + r.overall_rating, 0) / approvedCount).toFixed(1)
    : '-';

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">⭐ 고객 후기 관리</h1>
          <p className="text-sm text-slate-500 mt-1">
            노출 중 {approvedCount}건 · 평균 {avgRating}점
            <span className="ml-3 text-xs text-blue-500">💬 admin_seeded = 카카오 피드백 수동 입력</span>
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/admin/packages?id=${packageId}`}
            className="px-3 py-1.5 bg-slate-100 text-slate-700 text-sm rounded-lg hover:bg-slate-200">← 어드민</a>
          <a href={`/packages/${packageId}`} target="_blank" rel="noopener"
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">고객 페이지 ↗</a>
        </div>
      </div>

      {/* 후기 등록 버튼 */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full mb-6 py-3 border-2 border-dashed border-brand text-brand rounded-xl text-sm font-semibold hover:bg-brand-light transition-colors"
        >
          + 카카오 피드백으로 후기 직접 입력
        </button>
      )}

      {/* 등록 폼 */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 bg-blue-50 border border-blue-200 rounded-2xl p-5 space-y-4">
          <h2 className="font-bold text-slate-800 text-base">📝 후기 직접 입력 (카카오 피드백 기반)</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">작성자 이름 (선택 — 성만 입력 시 "김**" 마스킹)</label>
              <input
                type="text"
                placeholder="김○○"
                value={form.reviewer_name}
                onChange={e => setForm(f => ({ ...f, reviewer_name: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">종합 별점 *</label>
              <StarInput value={form.overall_rating} onChange={v => setForm(f => ({ ...f, overall_rating: v }))} />
            </div>
          </div>

          {/* 세부 평점 */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-2">세부 평점 (선택 — 0 = 미입력)</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {RATING_FIELDS.map(f => (
                <div key={f.key}>
                  <div className="text-[11px] text-slate-500 mb-1">{f.label}</div>
                  <StarInput
                    value={(form as Record<string, unknown>)[f.key] as number}
                    onChange={v => setForm(prev => ({ ...prev, [f.key]: v }))}
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">후기 제목 (선택)</label>
            <input
              type="text"
              placeholder="예: 바나산이 정말 좋았어요!"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">후기 본문 (카카오 피드백 원문 붙여넣기)</label>
            <textarea
              rows={4}
              placeholder="고객이 카카오톡으로 남긴 피드백을 그대로 붙여넣으세요"
              value={form.review_text}
              onChange={e => setForm(f => ({ ...f, review_text: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:outline-none resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">좋았던 점 배지 (한 줄에 하나씩)</label>
            <textarea
              rows={3}
              placeholder={"가이드님이 친절해요\n호텔이 깨끗해요\n일정이 알차요"}
              value={form.pros_raw}
              onChange={e => setForm(f => ({ ...f, pros_raw: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:outline-none resize-none font-mono"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-brand text-white text-sm font-bold rounded-lg hover:bg-brand-dark disabled:opacity-50 transition-colors"
            >
              {saving ? '저장 중...' : '✅ 저장 (바로 노출)'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setForm(DEFAULT_FORM); }}
              className="px-4 py-2 bg-slate-100 text-slate-600 text-sm rounded-lg hover:bg-slate-200">
              취소
            </button>
          </div>
        </form>
      )}

      {/* 후기 목록 */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <p className="text-4xl mb-3">💬</p>
          <p className="font-semibold">등록된 후기가 없습니다</p>
          <p className="text-sm mt-1">카카오톡 피드백을 위 버튼으로 직접 입력해보세요</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map(r => {
            const name = r.customers?.name ?? '익명';
            const maskedName = name.length > 0 ? `${name.charAt(0)}**` : '고객';
            return (
              <div key={r.id} className={`p-4 border rounded-xl transition-colors ${r.status === 'approved' ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-200 opacity-60'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <div className="flex gap-0.5">
                        {[1,2,3,4,5].map(n => (
                          <span key={n} className={`text-sm ${n <= r.overall_rating ? 'text-amber-400' : 'text-slate-200'}`}>★</span>
                        ))}
                      </div>
                      <StatusBadge status={r.status} />
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${r.source_type === 'verified_booking' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>
                        {r.source_type === 'verified_booking' ? '✓ 예약 확인' : '💬 카카오 후기'}
                      </span>
                      <span className="text-[11px] text-slate-400">{maskedName}</span>
                      <span className="text-[11px] text-slate-400">
                        {new Date(r.created_at).toLocaleDateString('ko-KR')}
                      </span>
                    </div>
                    {r.title && <p className="text-sm font-bold text-slate-800 mb-1">{r.title}</p>}
                    {r.review_text && (
                      <p className="text-sm text-slate-600 line-clamp-3 leading-relaxed">{r.review_text}</p>
                    )}
                    {r.pros && r.pros.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {r.pros.slice(0, 4).map((p, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 text-[11px] rounded">👍 {p}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button
                      onClick={() => toggleStatus(r.id, r.status)}
                      className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${r.status === 'approved' ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}
                    >
                      {r.status === 'approved' ? '숨김' : '노출'}
                    </button>
                    <button
                      onClick={() => deleteReview(r.id)}
                      className="text-xs px-2.5 py-1 rounded-lg font-medium bg-red-50 text-red-500 hover:bg-red-100"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-5 py-2.5 rounded-full shadow-xl z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
