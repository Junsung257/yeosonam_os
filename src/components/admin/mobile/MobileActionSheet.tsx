'use client';

import { useEffect } from 'react';

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
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity ${
        open ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      aria-hidden={!open}
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        className={`absolute bottom-0 inset-x-0 bg-white rounded-t-3xl shadow-2xl transition-transform duration-200 ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        role="dialog"
        aria-modal="true"
      >
        <div className="pt-3 pb-2 flex justify-center">
          <div className="w-10 h-1.5 rounded-full bg-slate-300" />
        </div>
        {(title || description) && (
          <div className="px-5 pb-2">
            {title && (
              <div className="text-base font-semibold text-slate-900">
                {title}
              </div>
            )}
            {description && (
              <div className="text-xs text-slate-500 mt-1">{description}</div>
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
              className={`w-full rounded-2xl px-4 py-3.5 text-left transition active:scale-[0.99] disabled:opacity-40 ${
                a.destructive
                  ? 'bg-red-50 text-red-700 hover:bg-red-100'
                  : 'bg-slate-100 text-slate-900 hover:bg-slate-200'
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                {a.badge}
                <span>{a.label}</span>
              </div>
              {a.description && (
                <div className="text-xs text-slate-500 mt-0.5">
                  {a.description}
                </div>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-2xl px-4 py-3 text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
