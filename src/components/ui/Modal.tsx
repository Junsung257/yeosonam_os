'use client';

import { ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** 모바일: 하단 바텀시트 스타일. 데스크톱: 센터 모달 */
  sheet?: boolean;
  maxWidth?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
}

export default function Modal({
  open,
  onClose,
  children,
  sheet = false,
  maxWidth = 'max-w-lg',
  ariaLabel = '모달 창',
  ariaLabelledBy,
  ariaDescribedBy,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const getFocusableElements = () => Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );

    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => {
      getFocusableElements()[0]?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;
      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        e.preventDefault();
        dialogRef.current?.focus();
        return;
      }

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
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
      window.setTimeout(() => {
        if (previousActiveElement && document.contains(previousActiveElement)) previousActiveElement.focus();
      }, 0);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      {/* backdrop — 어드민에선 약간 더 어둡게 (Linear/Stripe 톤) */}
      <div
        className="fixed inset-0 bg-slate-900/40 z-40 animate-in fade-in duration-150"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* panel */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabelledBy ? undefined : ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
        className={
          sheet
            ? 'fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-modal animate-in slide-in-from-bottom duration-200 [.admin-scope_&]:bg-admin-surface [.admin-scope_&]:rounded-t-admin-lg [.admin-scope_&]:shadow-admin-xl'
            : `fixed inset-0 z-50 flex items-center justify-center p-4`
        }
      >
        {sheet ? (
          <div className="w-full">
            <div className="mx-auto mt-3 mb-4 h-1 w-10 rounded-full bg-slate-200 [.admin-scope_&]:bg-admin-border-mid" />
            {children}
          </div>
        ) : (
          <div className={`relative bg-white rounded-2xl shadow-modal w-full ${maxWidth} animate-in zoom-in-95 duration-150 [.admin-scope_&]:bg-admin-surface [.admin-scope_&]:rounded-admin-md [.admin-scope_&]:shadow-admin-xl [.admin-scope_&]:border [.admin-scope_&]:border-admin-border-mid`}>
            {children}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
