'use client';

import { useState, useMemo } from 'react';

interface Props {
  cardNewsId: string;
  defaultCaption: string;
  slideImageUrls?: string[];
  onClose: () => void;
  onSuccess: (result: { mode: 'now' | 'scheduled'; post_id?: string; scheduled_for?: string }) => void;
}

export default function InstagramPublishModal({
  cardNewsId,
  defaultCaption,
  slideImageUrls,
  onClose,
  onSuccess,
}: Props) {
  const [tab, setTab] = useState<'now' | 'scheduled'>('now');
  const [caption, setCaption] = useState(defaultCaption);
  const [date, setDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const imageCount = slideImageUrls?.length ?? 0;
  const imageCountValid = imageCount >= 2 && imageCount <= 10;

  const captionCount = caption.length;
  const captionLimit = 2200;  // Instagram 캡션 최대 2200자

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        when: tab,
        caption: caption.trim(),
        image_urls: slideImageUrls,
      };
      if (tab === 'scheduled') {
        // 날짜 → 그날 자정 KST로 스케줄 (크론이 하루 1회 자정 UTC 실행, 약 9시간 오차)
        // 사용자 선택 날짜의 0시 UTC = KST 오전 9시
        body.scheduled_for = new Date(`${date}T00:00:00Z`).toISOString();
      }
      const res = await fetch(`/api/card-news/${cardNewsId}/publish-instagram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onSuccess({ mode: tab, post_id: data.post_id, scheduled_for: data.scheduled_for });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]" onClick={onClose} />
      <div className="fixed inset-0 z-[61] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto bg-white rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
          {/* 헤더 */}
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">인스타그램 발행</h3>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            >×</button>
          </div>

          {/* 이미지 프리뷰 */}
          <div className="px-5 pt-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-slate-500 uppercase">슬라이드</span>
              <span className={`text-xs ${imageCountValid ? 'text-slate-600' : 'text-red-600 font-semibold'}`}>
                {imageCount}장
              </span>
              {!imageCountValid && (
                <span className="text-xs text-red-600">(캐러셀은 2~10장 필요)</span>
              )}
            </div>
            {imageCount > 0 && (
              <div className="flex gap-1.5 overflow-x-auto pb-2">
                {slideImageUrls!.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={url}
                    alt={`슬라이드 ${i + 1}`}
                    className="w-16 h-16 object-cover rounded border border-slate-200 flex-shrink-0"
                  />
                ))}
              </div>
            )}
          </div>

          {/* 탭 */}
          <div className="px-5 pt-4">
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              <button
                onClick={() => setTab('now')}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition ${
                  tab === 'now' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'
                }`}
              >즉시 발행</button>
              <button
                onClick={() => setTab('scheduled')}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition ${
                  tab === 'scheduled' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'
                }`}
              >예약 발행</button>
            </div>
          </div>

          {/* 스크롤 영역 */}
          <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
            {tab === 'scheduled' && (
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">발행 날짜</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  선택한 날짜 이후 가장 가까운 자정 크론(UTC)에 발행됩니다. 한국시간 오전 9시경.
                </p>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">
                캡션 <span className={`ml-1 ${captionCount > captionLimit ? 'text-red-600' : 'text-slate-400'}`}>
                  {captionCount}/{captionLimit}
                </span>
              </label>
              <textarea
                value={caption}
                onChange={e => setCaption(e.target.value)}
                placeholder="인스타 피드에 표시될 캡션 + 해시태그"
                className="w-full border border-slate-200 rounded px-3 py-2 text-sm h-48 resize-none focus:ring-1 focus:ring-[#005d90]"
              />
            </div>

            {error && (
              <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {error}
              </div>
            )}
          </div>

          {/* 하단 버튼 */}
          <div className="px-5 py-4 border-t border-slate-200 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 border border-slate-200 text-sm text-slate-600 py-2.5 rounded-lg hover:bg-slate-50"
            >취소</button>
            <button
              onClick={handleSubmit}
              disabled={submitting || !imageCountValid || !caption.trim() || captionCount > captionLimit}
              className="flex-1 bg-[#001f3f] text-white text-sm font-medium py-2.5 rounded-lg hover:bg-blue-900 disabled:opacity-50"
            >
              {submitting
                ? (tab === 'now' ? '발행 중... (60초 소요)' : '저장 중...')
                : (tab === 'now' ? '지금 발행' : '예약 저장')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
