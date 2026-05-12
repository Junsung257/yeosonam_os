'use client';

/**
 * JarvisSidekick — 매직링크 액션 페이지 (예약/동의/리뷰 등) 에 임베드되는 floating 자비스 챗.
 *
 * Booking.com Smart Messenger / Trip.com TripGenie 패턴: 폼·정보는 메인 영역, 챗은 떠 있음.
 *
 * 사용:
 *   <JarvisSidekick context={{ bookingNo, bookingDestination, ... }} />
 *
 * 동작:
 *   - 우측 하단 floating 버튼 (보통/포커스 시 라벨 노출)
 *   - 클릭 시 drawer 슬라이드 인 (모바일 = 전체화면, 태블릿+ = 우측 패널)
 *   - 내부에 MagicLinkChat 위젯 재사용
 *   - ESC / 오버레이 클릭으로 닫기
 *   - body scroll lock 적용 (open 시)
 */

import { useEffect, useState } from 'react';
import MagicLinkChat, { type MagicLinkChatContext } from './MagicLinkChat';

interface Props {
  context: MagicLinkChatContext;
  /** 사이드킥 버튼 라벨 (기본: "여소남 안내") */
  label?: string;
  /** 사이드킥에 표시될 환영 메시지 (기본: 자동 생성) */
  greeting?: string;
  /** Quick replies override */
  quickReplies?: string[];
}

export default function JarvisSidekick({ context, label = '여소남 안내', greeting, quickReplies }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      {/* Floating Button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 bg-gray-900 text-white rounded-full pl-4 pr-5 py-3 shadow-lg flex items-center gap-2 hover:bg-gray-800 active:scale-95 transition"
          aria-label="여소남 안내 챗 열기"
        >
          <span className="w-7 h-7 rounded-full bg-white text-gray-900 flex items-center justify-center text-xs font-bold">
            여
          </span>
          <span className="text-sm font-semibold">{label}</span>
        </button>
      )}

      {/* Overlay + Drawer */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="fixed inset-0 sm:inset-auto sm:right-5 sm:bottom-5 sm:top-5 sm:w-[400px] z-50 bg-white sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-white/90 hover:bg-gray-100 text-gray-600 flex items-center justify-center text-lg"
              aria-label="닫기"
            >
              ×
            </button>
            <div className="flex-1 min-h-0">
              <MagicLinkChat
                context={context}
                greeting={greeting}
                quickReplies={quickReplies}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}
