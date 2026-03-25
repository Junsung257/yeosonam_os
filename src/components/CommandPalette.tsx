'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Booking {
  id: string;
  booking_no?: string;
  package_title?: string;
  status: string;
  departure_date?: string;
  customers?: { name: string; phone?: string };
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
};
const STATUS_LABELS: Record<string, string> = {
  pending: '예약대기', confirmed: '예약확정', completed: '결제완료', cancelled: '취소',
};

interface CommandPaletteProps {
  bookings: Booking[];
  onSelect: (id: string) => void;
}

export default function CommandPalette({ bookings, onSelect }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [focusIdx, setFocusIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => !o);
        setQuery('');
        setFocusIdx(0);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const filtered = bookings
    .filter(b => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        (b.booking_no || '').toLowerCase().includes(q) ||
        (b.customers?.name || '').toLowerCase().includes(q) ||
        (b.package_title || '').toLowerCase().includes(q) ||
        (b.customers?.phone || '').includes(q)
      );
    })
    .slice(0, 10);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const b = filtered[focusIdx];
      if (b) { onSelect(b.id); setOpen(false); }
    }
  }, [filtered, focusIdx, onSelect]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />

      {/* Panel */}
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl ring-1 ring-gray-900/10 overflow-hidden">
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100">
          <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input ref={inputRef} type="text" value={query}
            onChange={e => { setQuery(e.target.value); setFocusIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="고객명, 예약번호, 상품명 검색..."
            className="flex-1 text-base text-gray-900 placeholder-gray-400 focus:outline-none bg-transparent" />
          <kbd className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-mono">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              {query ? '검색 결과 없음' : '예약 데이터를 입력해 검색하세요'}
            </p>
          ) : (
            filtered.map((b, i) => (
              <button key={b.id}
                onMouseEnter={() => setFocusIdx(i)}
                onClick={() => { onSelect(b.id); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition ${i === focusIdx ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-mono text-sm font-semibold text-gray-800">
                      {b.booking_no || b.id.slice(0, 8)}
                    </span>
                    <span className="font-medium text-gray-900">{b.customers?.name ?? '—'}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[b.status] || 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABELS[b.status] || b.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 truncate mt-0.5">
                    {b.package_title || '(상품 미지정)'}
                    {b.departure_date && <span className="ml-2">· {b.departure_date.slice(0, 10)}</span>}
                  </p>
                </div>
                {i === focusIdx && (
                  <kbd className="text-xs text-gray-400 bg-white border border-gray-200 px-1.5 py-0.5 rounded font-mono flex-shrink-0">↵</kbd>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2.5 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-400">
          <span><kbd className="bg-gray-100 px-1 py-0.5 rounded font-mono">↑↓</kbd> 이동</span>
          <span><kbd className="bg-gray-100 px-1 py-0.5 rounded font-mono">Enter</kbd> 열기</span>
          <span><kbd className="bg-gray-100 px-1 py-0.5 rounded font-mono">Ctrl+K</kbd> 닫기</span>
        </div>
      </div>
    </div>
  );
}
