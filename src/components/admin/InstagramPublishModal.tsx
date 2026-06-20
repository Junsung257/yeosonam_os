'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  cardNewsId: string;
  defaultCaption: string;
  slideImageUrls?: string[];
  onClose: () => void;
  onSuccess: (result: { mode: 'now' | 'scheduled'; post_id?: string; scheduled_for?: string }) => void;
}

// KST 기준 "YYYY-MM-DDTHH:mm" 형태를 생성 (datetime-local input 용)
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  // 기본값: 내일 오전 9시 (KST)
  const [scheduledAt, setScheduledAt] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return toLocalInput(tomorrow);
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const captionRef = useRef<HTMLTextAreaElement | null>(null);
  const modalTitleId = 'instagram-publish-modal-title';
  const modalDescriptionId = 'instagram-publish-modal-description';
  const imageStatusId = 'instagram-publish-image-status';
  const tabListId = 'instagram-publish-mode-tabs';
  const captionHelpId = 'instagram-publish-caption-help';
  const errorId = 'instagram-publish-error';

  useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const getFocusableElements = () => Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );

    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => {
      captionRef.current?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (focusableElements.length === 1) {
        event.preventDefault();
        firstElement.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      window.setTimeout(() => {
        if (previousActiveElement && document.contains(previousActiveElement)) previousActiveElement.focus();
      }, 0);
    };
  }, [onClose]);

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
        // datetime-local 입력값 (로컬 시간) → ISO (UTC). 브라우저가 로컬 TZ 를 적용.
        // publish-scheduled 크론이 15분마다 실행 → 예약 시각 도래 후 보통 15분 이내 발행
        const parsed = new Date(scheduledAt);
        if (isNaN(parsed.getTime())) {
          throw new Error('예약 시각 파싱 실패');
        }
        if (parsed.getTime() < Date.now() + 5 * 60 * 1000) {
          throw new Error('예약 시각은 현재로부터 5분 이후여야 합니다');
        }
        body.scheduled_for = parsed.toISOString();
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
      <button
        type="button"
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] cursor-default"
        onClick={onClose}
        aria-label="인스타그램 발행 모달 닫기"
      />
      <div className="fixed inset-0 z-[61] flex items-center justify-center p-4 pointer-events-none">
        <div
          ref={dialogRef}
          className="pointer-events-auto bg-white rounded-admin-md w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]"
          role="dialog"
          aria-modal="true"
          aria-labelledby={modalTitleId}
          aria-describedby={`${modalDescriptionId} ${imageStatusId}`}
        >
          {/* 헤더 */}
          <div className="px-5 py-4 border-b border-admin-border-mid flex items-center justify-between">
            <div>
              <h3 id={modalTitleId} className="text-base font-bold text-admin-text">인스타그램 발행</h3>
              <p id={modalDescriptionId} className="sr-only">
                카드뉴스 슬라이드를 인스타그램에 즉시 발행하거나 예약 발행으로 저장합니다.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-admin-muted-2 hover:text-admin-muted text-xl leading-none"
              aria-label="인스타그램 발행 모달 닫기"
            >×</button>
          </div>

          {/* 이미지 프리뷰 */}
          <div className="px-5 pt-4">
            <div id={imageStatusId} className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-admin-muted uppercase">슬라이드</span>
              <span className={`text-xs ${imageCountValid ? 'text-admin-muted' : 'text-red-600 font-semibold'}`}>
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
                    className="w-16 h-16 object-cover rounded border border-admin-border-mid flex-shrink-0"
                  />
                ))}
              </div>
            )}
          </div>

          {/* 탭 */}
          <div className="px-5 pt-4">
            <div id={tabListId} className="flex gap-1 bg-admin-surface-2 rounded-lg p-1" role="group" aria-label="인스타그램 발행 방식">
              <button
                type="button"
                onClick={() => setTab('now')}
                aria-pressed={tab === 'now'}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition ${
                  tab === 'now' ? 'bg-white shadow-admin-xs text-admin-text-2' : 'text-admin-muted'
                }`}
              >즉시 발행</button>
              <button
                type="button"
                onClick={() => setTab('scheduled')}
                aria-pressed={tab === 'scheduled'}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition ${
                  tab === 'scheduled' ? 'bg-white shadow-admin-xs text-admin-text-2' : 'text-admin-muted'
                }`}
              >예약 발행</button>
            </div>
          </div>

          {/* 스크롤 영역 */}
          <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
            {tab === 'scheduled' && (
              <div>
                <label htmlFor="instagram-scheduled-at" className="text-xs font-semibold text-admin-muted uppercase block mb-1">발행 일시 (KST)</label>
                <input
                  id="instagram-scheduled-at"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={e => setScheduledAt(e.target.value)}
                  min={toLocalInput(new Date(Date.now() + 10 * 60 * 1000))}
                  aria-describedby="instagram-scheduled-at-help"
                  className="w-full border border-admin-border-mid rounded px-3 py-2 text-sm"
                />
                <p id="instagram-scheduled-at-help" className="text-[11px] text-admin-muted-2 mt-1">
                  크론이 15분마다 확인해 도래 후 보통 15분 이내 발행됩니다. 실 발행 시각 오차 ±15분.
                </p>
              </div>
            )}

            <div>
              <label htmlFor="instagram-caption" className="text-xs font-semibold text-admin-muted uppercase block mb-1">
                캡션 <span className={`ml-1 ${captionCount > captionLimit ? 'text-red-600' : 'text-admin-muted-2'}`}>
                  {captionCount}/{captionLimit}
                </span>
              </label>
              <textarea
                id="instagram-caption"
                ref={captionRef}
                value={caption}
                onChange={e => setCaption(e.target.value)}
                placeholder="인스타 피드에 표시될 캡션 + 해시태그"
                aria-describedby={error ? `${captionHelpId} ${errorId}` : captionHelpId}
                aria-invalid={captionCount > captionLimit}
                className="w-full border border-admin-border-mid rounded px-3 py-2 text-sm h-48 resize-none focus:ring-1 focus:ring-[#005d90]"
              />
              <p id={captionHelpId} className="sr-only">
                인스타그램 캡션은 최대 2200자까지 입력할 수 있습니다.
              </p>
            </div>

            {error && (
              <div id={errorId} role="alert" className="px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {error}
              </div>
            )}
          </div>

          {/* 하단 버튼 */}
          <div className="px-5 py-4 border-t border-admin-border-mid flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-admin-border-mid text-sm text-admin-muted py-2.5 rounded-lg hover:bg-admin-bg"
            >취소</button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !imageCountValid || !caption.trim() || captionCount > captionLimit}
              aria-busy={submitting}
              className="flex-1 bg-blue-600 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-blue-900 disabled:opacity-50"
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
