'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { NoticeBlock } from '@/lib/standard-terms-client';
import { getSourceBadgeColor } from '@/lib/standard-terms-client';
import {
  groupNoticesForPresentation,
  splitNoticeLines,
  stripNoticeTitleEmoji,
  type TermsPresentationGroup,
} from '@/lib/terms-presentation';

interface Props {
  open: boolean;
  onClose: () => void;
  notices: NoticeBlock[];
  hasSpecialTerms?: boolean;
  productTitle?: string;
}

function GroupSection({ group, defaultOpen }: { group: TermsPresentationGroup; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const contentId = useId();

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        data-testid="package-terms-group-toggle"
        aria-expanded={open}
        aria-controls={contentId}
        className="w-full flex items-center gap-2 px-4 py-3 text-left bg-gray-50/80 hover:bg-gray-50 transition"
      >
        <span className="text-base shrink-0">{group.icon}</span>
        <span className="text-sm font-bold text-gray-800 flex-1">{group.title}</span>
        <span className="text-gray-300 text-sm">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div
          id={contentId}
          data-testid="package-terms-group-panel"
          className="px-4 pb-4 pt-2 space-y-3 bg-white"
          role="region"
          aria-label={group.title}
        >
          {group.notices.map((notice, idx) => {
            const lines = splitNoticeLines(notice.text);
            const badgeColor = getSourceBadgeColor(notice._source, notice._tier);
            const showSource = (notice._tier ?? 1) >= 2 && notice._source;
            return (
              <div key={`${notice.type}-${idx}`}>
                {notice.title && notice.title !== group.title && (
                  <p className="text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-2 flex-wrap">
                    <span>{stripNoticeTitleEmoji(notice.title)}</span>
                    {showSource && (
                      <span className={`text-[10px] font-bold ${badgeColor}`}>[{notice._source}]</span>
                    )}
                  </p>
                )}
                <div className="space-y-1">
                  {lines.map((line, lineIdx) => (
                    <p key={lineIdx} className="text-xs text-gray-600 leading-relaxed">
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function PackageTermsBottomSheet({
  open,
  onClose,
  notices,
  hasSpecialTerms = false,
  productTitle,
}: Props) {
  const groups = useMemo(() => groupNoticesForPresentation(notices), [notices]);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const termsSheetDescriptionId = 'package-terms-sheet-description';
  const termsDecisionSummaryId = 'package-terms-decision-summary';
  const firstGroupTitle = groups[0]?.title ?? '약관';
  const termsDecisionSummaryText = hasSpecialTerms
    ? `확인 우선순위: 특약 상품입니다. ${groups.length}개 약관 묶음 중 ${firstGroupTitle}부터 확인하세요. 특약은 표준 취소 규정보다 우선 적용될 수 있습니다.`
    : `확인 우선순위: ${groups.length}개 약관 묶음 중 ${firstGroupTitle}부터 확인하세요. 취소, 포함, 불포함 조건을 상담 전 확인하면 좋습니다.`;

  useEffect(() => {
    if (!open) return;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const getFocusableElements = () => Array.from(
      sheetRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter(element => !element.getAttribute('aria-hidden'));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (focusableElements.length === 1) {
        e.preventDefault();
        firstElement.focus();
        return;
      }
      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
        return;
      }
      if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      if (previousActiveElement && document.contains(previousActiveElement)) previousActiveElement.focus();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-[60] transition-opacity"
        onClick={onClose}
        aria-hidden
      />
      <div
        id="package-terms-sheet"
        data-testid="package-terms-sheet"
        ref={sheetRef}
        className="fixed inset-x-0 bottom-0 z-[70] flex flex-col bg-white rounded-t-2xl shadow-2xl max-h-[88dvh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="package-terms-sheet-title"
        aria-describedby={`${termsSheetDescriptionId} ${termsDecisionSummaryId}`}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        <div className="flex items-start justify-between gap-3 px-5 pb-3 shrink-0 border-b border-gray-100">
          <div className="min-w-0">
            <h2 id="package-terms-sheet-title" className="text-base font-extrabold text-gray-900">
              {hasSpecialTerms ? '특별약관 및 취소 규정' : '여행 약관 및 취소 규정'}
            </h2>
            {productTitle && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">{productTitle}</p>
            )}
          </div>
          <button
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            data-testid="package-terms-close"
            className="p-2 -mr-2 rounded-full hover:bg-gray-100 text-gray-500"
            aria-label="약관 바텀시트 닫기"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          <p id={termsSheetDescriptionId} className="sr-only">
            상품 약관과 취소 규정을 확인하고 각 항목을 펼쳐 자세한 내용을 볼 수 있습니다.
          </p>
          <p
            id={termsDecisionSummaryId}
            data-testid="package-terms-decision-summary"
            aria-label={termsDecisionSummaryText}
            className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs font-bold leading-relaxed text-blue-800"
          >
            {termsDecisionSummaryText}
          </p>
          {hasSpecialTerms && (
            <p className="text-xs font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5 leading-relaxed">
              ※ 본 상품은 특별약관이 적용되며, 공정거래위원회 표준약관보다 우선합니다. 예약 시 동의한 것으로 간주합니다.
            </p>
          )}

          {groups.map((group, idx) => (
            <GroupSection key={group.id} group={group} defaultOpen={idx === 0} />
          ))}

          <p className="text-[11px] text-gray-400 leading-relaxed px-1 pt-1">
            ※ 예약 확정 시점의 약관 전문이 [예약 안내문]으로 별도 발송됩니다.
          </p>
        </div>

        <div
          className="shrink-0 px-4 pt-3 pb-4 border-t border-gray-100 bg-white"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="약관 내용을 확인하고 닫기"
            className="w-full py-3.5 rounded-xl bg-gray-900 text-white text-sm font-bold"
          >
            확인했습니다
          </button>
        </div>
      </div>
    </>
  );
}
