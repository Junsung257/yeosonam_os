'use client';

import { useState, useEffect, useRef } from 'react';
import type { PosterFormat, PosterData } from '@/hooks/usePosterStudio';
import YeosonamA4Template from './YeosonamA4Template';
import type { AttractionInfo } from './YeosonamA4Template';
import type { NoticeBlock } from '@/lib/standard-terms';

interface PosterStudioProps {
  open: boolean;
  format: PosterFormat;
  data: PosterData;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pkg: any;
  downloading: boolean;
  pkgId?: string;
  onClose: () => void;
  onUpdateField: (field: keyof PosterData, value: string | string[]) => void;
  onDownload: () => void;
}

export default function PosterStudio({
  open,
  format,
  data,
  pkg,
  downloading,
  pkgId,
  onClose,
  onUpdateField,
  onDownload,
}: PosterStudioProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const downloadButtonRef = useRef<HTMLButtonElement | null>(null);
  const posterTitleId = 'poster-studio-title';
  const posterDescriptionId = 'poster-studio-description';
  const posterStatusId = 'poster-studio-status';
  const isA4 = format === 'A4';

  // 관광지 DB 로드 (1회)
  const [attractions, setAttractions] = useState<AttractionInfo[]>([]);
  useEffect(() => {
    fetch('/api/attractions').then(r => r.json()).then(d => setAttractions(d.attractions || [])).catch(() => {});
  }, []);

  // 4-level 약관 해소 (A4 surface) — 상품이 바뀌면 재fetch
  const [resolvedNotices, setResolvedNotices] = useState<NoticeBlock[]>([]);
  useEffect(() => {
    if (!pkgId) { setResolvedNotices([]); return; }
    fetch(`/api/packages/${pkgId}/terms?surface=a4`)
      .then(r => r.json())
      .then(d => setResolvedNotices((d.data ?? []) as NoticeBlock[]))
      .catch(() => setResolvedNotices([]));
  }, [pkgId]);

  useEffect(() => {
    if (!open) return undefined;

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (isA4 && !downloading) {
      downloadButtonRef.current?.focus();
    } else {
      closeButtonRef.current?.focus();
    }

    const getFocusableElements = () => Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter(element => !element.hasAttribute('disabled') && !element.getAttribute('aria-hidden'));

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActiveElement?.focus();
    };
  }, [downloading, isA4, onClose, open]);

  if (!open) return null;

  const posterTitleText = isA4 ? '포스터 스튜디오' : '모바일 프리뷰';
  const posterDescriptionText = isA4
    ? 'A4 다중 페이지 포스터를 검수하고 JPG 또는 ZIP으로 다운로드하는 패널입니다.'
    : '고객이 보는 모바일 상품 페이지를 iPhone 크기로 검수하는 패널입니다.';

  return (
    <div className="fixed inset-0 z-50 flex h-dvh max-h-dvh justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
        tabIndex={-1}
        aria-hidden="true"
        aria-label={isA4 ? '포스터 스튜디오 닫기' : '모바일 프리뷰 닫기'}
      />
      <div
        ref={dialogRef}
        className={`relative w-full ${isA4 ? 'max-w-[900px]' : 'max-w-[500px]'} bg-admin-surface-2 shadow-admin-lg border-l border-admin-border-mid h-dvh max-h-dvh flex flex-col`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={posterTitleId}
        aria-describedby={`${posterDescriptionId} ${posterStatusId}`}
      >
        {/* 헤더 */}
        <div className="bg-white border-b border-admin-border-mid px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 id={posterTitleId} className="text-admin-lg font-semibold text-admin-text-2">
              {posterTitleText}
            </h2>
            <p id={posterDescriptionId} className="text-[11px] text-admin-muted mt-0.5">
              {isA4
                ? 'A4 다중 페이지 — 클릭하여 텍스트 수정 가능 | 자동 페이지 분할'
                : 'iPhone 14 Pro (390×844) — 고객 뷰 검수'}
            </p>
            <p id={posterStatusId} role="status" aria-live="polite" aria-atomic="true" className="sr-only">
              {downloading ? '포스터 다운로드 파일을 생성 중입니다.' : posterDescriptionText}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isA4 && (
              <button
                ref={downloadButtonRef}
                type="button"
                onClick={onDownload}
                disabled={downloading}
                aria-busy={downloading}
                aria-describedby={posterStatusId}
                className="px-4 py-1.5 bg-blue-600 text-white text-admin-sm rounded hover:bg-blue-900 disabled:bg-slate-300 transition"
              >
                {downloading ? '생성 중...' : '다운로드 (JPG/ZIP)'}
              </button>
            )}
            <button
              ref={closeButtonRef}
              type="button"
              aria-label={isA4 ? '포스터 스튜디오 닫기' : '모바일 프리뷰 닫기'}
              onClick={onClose}
              className="p-1.5 text-admin-muted-2 hover:text-admin-muted transition"
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 콘텐츠 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex justify-center">
          {isA4 ? (
            /* ═══ A4 포스터 (YeosonamA4Template) ═══ */
            <div id="a4-canvas-wrapper">
              <YeosonamA4Template pkg={pkg || {}} attractions={attractions} resolvedNotices={resolvedNotices} />
            </div>
          ) : (
            /* ═══ 모바일 iframe 에뮬레이터 ═══ */
            <div className="flex flex-col items-center gap-3">
              <div className="bg-slate-900 rounded-[2.5rem] p-3 shadow-2xl" style={{ width: '410px' }}>
                <div className="bg-slate-900 rounded-full w-32 h-6 mx-auto mb-2 flex items-center justify-center">
                  <div className="w-16 h-4 bg-slate-800 rounded-full" />
                </div>
                <div className="bg-white rounded-[1.8rem] overflow-hidden" style={{ width: '384px', height: '830px' }}>
                  <iframe
                    src={pkgId ? `/lp/${pkgId}` : '/packages'}
                    className="w-full h-full border-0"
                    title="모바일 프리뷰"
                    style={{ width: '390px', height: '844px', transform: 'scale(0.985)', transformOrigin: 'top left' }}
                  />
                </div>
                <div className="mt-2 flex justify-center">
                  <div className="w-32 h-1 bg-slate-700 rounded-full" />
                </div>
              </div>
              <p className="text-[11px] text-admin-muted-2">실제 고객이 보는 화면입니다. 스크롤하여 검수하세요.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
