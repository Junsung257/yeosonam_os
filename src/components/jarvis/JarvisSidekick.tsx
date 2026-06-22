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

import { useEffect, useRef, useState } from 'react';
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
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerTitleId = 'jarvis-sidekick-title';
  const drawerDescriptionId = 'jarvis-sidekick-description';

  useEffect(() => {
    if (!open) return;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const triggerElement = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }

      if (e.key !== 'Tab') return;
      const focusableElements = drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusableElements?.length) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      window.setTimeout(() => {
        const returnTarget = previousActiveElement?.isConnected ? previousActiveElement : triggerElement;
        returnTarget?.focus();
      }, 0);
    };
  }, [open]);

  return (
    <>
      {/* Floating Button */}
      {!open && (
        <button
          ref={triggerRef}
          type="button"
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
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={drawerTitleId}
            aria-describedby={drawerDescriptionId}
            className="fixed inset-0 z-50 flex h-dvh flex-col overflow-hidden bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:inset-auto sm:bottom-5 sm:right-5 sm:top-5 sm:h-auto sm:w-[400px] sm:rounded-2xl sm:pb-0"
          >
            <p id={drawerTitleId} className="sr-only">
              여소남 안내 챗
            </p>
            <p id={drawerDescriptionId} className="sr-only">
              예약, 동의, 리뷰 등 매직링크 작업 중 필요한 도움말을 채팅으로 확인할 수 있습니다.
            </p>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-white/90 hover:bg-gray-100 text-gray-600 flex items-center justify-center text-lg"
              aria-label="여소남 안내 챗 닫기"
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
