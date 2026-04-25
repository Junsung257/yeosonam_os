'use client';

/**
 * SearchInput — 어드민 ERP 통합 검색 입력
 *
 * variant:
 *   - 'topbar' : ⌘K 통합검색 트리거 버튼 (placeholder 표시 + kbd)
 *   - 'inline' : 페이지 내 필터 검색 입력
 */

import { Search } from 'lucide-react';
import type { ChangeEvent, KeyboardEvent } from 'react';

interface SearchInputProps {
  variant?: 'topbar' | 'inline';
  placeholder?: string;
  value?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onClick?: () => void;
  kbd?: string;
  width?: string;
  autoFocus?: boolean;
  className?: string;
}

export function SearchInput({
  variant = 'inline',
  placeholder = '검색...',
  value,
  onChange,
  onKeyDown,
  onClick,
  kbd,
  width,
  autoFocus,
  className = '',
}: SearchInputProps) {
  if (variant === 'topbar') {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`flex items-center gap-2 px-3.5 py-2 rounded-lg border-2 border-admin-border bg-admin-surface text-admin-sm text-admin-textMuted hover:border-admin-borderStrong hover:text-admin-text transition-colors ${className}`}
        style={width ? { width } : undefined}
      >
        <Search size={15} strokeWidth={2.2} className="text-admin-textSubtle" />
        <span className="flex-1 text-left">{placeholder}</span>
        {kbd && (
          <kbd className="text-admin-xs bg-slate-100 text-admin-textMuted px-1.5 py-0.5 rounded font-mono border border-slate-200">
            {kbd}
          </kbd>
        )}
      </button>
    );
  }

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <Search
        size={15}
        strokeWidth={2.2}
        className="absolute left-3 text-admin-textSubtle pointer-events-none"
      />
      <input
        type="search"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full pl-9 pr-3 py-2 rounded-lg border-2 border-admin-border bg-admin-surface text-admin-sm text-admin-text placeholder:text-admin-textSubtle focus:outline-none focus:border-admin-accent focus:ring-2 focus:ring-blue-200 transition-colors"
        style={width ? { width } : undefined}
      />
    </div>
  );
}

export default SearchInput;
