'use client';

import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** 모바일: 하단 바텀시트 스타일. 데스크톱: 센터 모달 */
  sheet?: boolean;
  maxWidth?: string;
}

export default function Modal({ open, onClose, children, sheet = false, maxWidth = 'max-w-lg' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      {/* backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 animate-in fade-in duration-150"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* panel */}
      <div
        role="dialog"
        aria-modal="true"
        className={
          sheet
            ? 'fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-modal max-h-[90dvh] overflow-y-auto animate-in slide-in-from-bottom duration-200'
            : `fixed inset-0 z-50 flex items-center justify-center p-4`
        }
      >
        {sheet ? (
          <div className="w-full">
            <div className="mx-auto mt-3 mb-4 h-1 w-10 rounded-full bg-slate-200" />
            {children}
          </div>
        ) : (
          <div className={`relative bg-white rounded-2xl shadow-modal w-full ${maxWidth} animate-in zoom-in-95 duration-150`}>
            {children}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
