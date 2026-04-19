'use client';

import { useState, useEffect } from 'react';
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

  if (!open) return null;

  const isA4 = format === 'A4';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        className={`relative w-full ${isA4 ? 'max-w-[900px]' : 'max-w-[500px]'} bg-slate-100 shadow-xl border-l border-slate-200 h-full flex flex-col`}
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-[16px] font-semibold text-slate-800">
              {isA4 ? '포스터 스튜디오' : '모바일 프리뷰'}
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {isA4
                ? 'A4 다중 페이지 — 클릭하여 텍스트 수정 가능 | 자동 페이지 분할'
                : 'iPhone 14 Pro (390×844) — 고객 뷰 검수'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isA4 && (
              <button
                onClick={onDownload}
                disabled={downloading}
                className="px-4 py-1.5 bg-[#001f3f] text-white text-[13px] rounded hover:bg-blue-900 disabled:bg-slate-300 transition"
              >
                {downloading ? '생성 중...' : '다운로드 (JPG/ZIP)'}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 transition"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 콘텐츠 */}
        <div className="flex-1 overflow-y-auto p-6 flex justify-center">
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
              <p className="text-[11px] text-slate-400">실제 고객이 보는 화면입니다. 스크롤하여 검수하세요.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
