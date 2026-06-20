'use client';

import { useEffect, useId, useRef } from 'react';

export interface SheetAction {
  label: React.ReactNode;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  destructive?: boolean;
  description?: React.ReactNode;
  badge?: React.ReactNode;
}

interface MobileActionSheetProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions: SheetAction[];
  cancelLabel?: string;
}

export function MobileActionSheet({
  open,
  onClose,
  title,
  description,
  actions,
  cancelLabel = '닫기',
}: MobileActionSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const sheetBaseId = useId();
  const sheetTitleId = `${sheetBaseId}-title`;
  const sheetDescriptionId = `${sheetBaseId}-description`;

  useEffect(() => {
    if (!open) return;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const getFocusableElements = () => Array.from(
      sheetRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    document.body.style.overflow = 'hidden';
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
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    };
    const focusTimer = window.setTimeout(() => {
      getFocusableElements()[0]?.focus();
    }, 0);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
      window.setTimeout(() => {
        previousActiveElement?.focus();
      }, 0);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 transition-opacity opacity-100"
    >
      <button
        type="button"
        aria-label="모바일 액션 시트 닫기"
        className="absolute inset-0 bg-black/40 cursor-default"
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        className="absolute bottom-0 inset-x-0 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl transition-transform duration-200 translate-y-0"
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : '모바일 작업 메뉴'}
        aria-labelledby={title ? sheetTitleId : undefined}
        aria-describedby={description ? sheetDescriptionId : undefined}
      >
        <div className="pt-3 pb-2 flex justify-center">
          <div className="w-10 h-1.5 rounded-full bg-slate-300" />
        </div>
        {(title || description) && (
          <div className="px-5 pb-2">
            {title && (
              <div id={sheetTitleId} className="text-base font-semibold text-admin-text">
                {title}
              </div>
            )}
            {description && (
              <div id={sheetDescriptionId} className="text-xs text-admin-muted mt-1">{description}</div>
            )}
          </div>
        )}
        <div className="px-4 pb-4 space-y-2">
          {actions.map((a, idx) => (
            <button
              key={idx}
              type="button"
              disabled={a.disabled}
              onClick={async () => {
                await a.onClick();
              }}
              className={`w-full rounded-admin-lg px-4 py-3.5 text-left transition active:scale-[0.99] disabled:opacity-40 ${
                a.destructive
                  ? 'bg-red-50 text-red-700 hover:bg-red-100'
                  : 'bg-admin-surface-2 text-admin-text hover:bg-slate-200'
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                {a.badge}
                <span>{a.label}</span>
              </div>
              {a.description && (
                <div className="text-xs text-admin-muted mt-0.5">
                  {a.description}
                </div>
              )}
            </button>
          ))}
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onClose}
            aria-label={`모바일 액션 시트 ${cancelLabel}`}
            className="w-full rounded-admin-lg px-4 py-3 text-sm font-medium text-admin-muted hover:text-admin-text-2"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
