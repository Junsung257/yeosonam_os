'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

export interface BookingOption {
  id: string;
  booking_no?: string;
  package_title?: string;
  total_price?: number;
  total_cost?: number;
  paid_amount?: number;
  total_paid_out?: number;
  departure_date?: string;
  status?: string;
  customers?: { name?: string };
  lead_customer_id?: string;
}

export interface SmartComboboxProps {
  tx: { amount: number; counterparty_name?: string };
  bookings: BookingOption[];
  multiMode: boolean;
  multiSelected: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}

function fmt만(n: number) { return `${(n / 10000).toFixed(1)}만`; }
function fmtDate(d?: string) { return d ? d.slice(2, 10).replace(/-/g, '-') : ''; }
function getBalance(b: BookingOption) { return Math.max(0, (b.total_price || 0) - (b.paid_amount || 0)); }
function nameSim(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const an = a.replace(/\s+/g, ''), bn = b.replace(/\s+/g, '');
  if (an === bn) return 1.0;
  if (an.includes(bn) || bn.includes(an)) return 0.7;
  if (an[0] === bn[0]) return 0.3;
  return 0;
}

export function SmartCombobox({ tx, bookings, multiMode, multiSelected, onSelect, onToggle }: SmartComboboxProps) {
  const [query, setQuery] = useState(tx.counterparty_name || '');
  const [focusedIdx, setFocusedIdx] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const isRecommended = useCallback((b: BookingOption) => {
    const bal = getBalance(b);
    return bal === tx.amount && nameSim(b.customers?.name, tx.counterparty_name) >= 0.7;
  }, [tx]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const all = bookings.filter(b => {
      if (!q) return true;
      return (
        (b.customers?.name || '').toLowerCase().includes(q) ||
        (b.package_title || '').toLowerCase().includes(q) ||
        (b.booking_no || '').toLowerCase().includes(q) ||
        (b.departure_date || '').includes(q)
      );
    });
    return [...all.filter(isRecommended), ...all.filter(b => !isRecommended(b))];
  }, [bookings, query, isRecommended]);

  useEffect(() => { setFocusedIdx(0); }, [query]);

  useEffect(() => {
    const li = listRef.current?.children[focusedIdx] as HTMLElement;
    li?.scrollIntoView({ block: 'nearest' });
  }, [focusedIdx]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusedIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusedIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const b = filtered[focusedIdx];
      if (!b) return;
      if (multiMode) onToggle(b.id); else onSelect(b.id);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        autoFocus
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="이름, 상품명, 출발일 검색..."
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <ul ref={listRef} className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
        {filtered.length === 0 && (
          <li className="px-3 py-3 text-sm text-gray-400 text-center">검색 결과 없음</li>
        )}
        {filtered.map((b, i) => {
          const rec = isRecommended(b);
          const bal = getBalance(b);
          const isFocused = i === focusedIdx;
          const isChecked = multiSelected.has(b.id);
          return (
            <li
              key={b.id}
              onClick={() => multiMode ? onToggle(b.id) : onSelect(b.id)}
              onMouseEnter={() => setFocusedIdx(i)}
              className={`px-3 py-2 cursor-pointer text-sm transition
                ${rec ? 'bg-emerald-50 border-l-2 border-emerald-400' : ''}
                ${isFocused && !rec ? 'bg-blue-50' : ''}
                ${isFocused && rec ? 'bg-emerald-100' : ''}
              `}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {multiMode && (
                    <input type="checkbox" readOnly checked={isChecked}
                      className="rounded border-gray-300 text-blue-600" />
                  )}
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-400">[출발 {fmtDate(b.departure_date)}]</span>
                      <span className="font-medium text-gray-900">{b.customers?.name || '이름 없음'}</span>
                      {b.package_title && <span className="text-gray-500">· {b.package_title}</span>}
                      {rec && <span className="text-xs px-1.5 py-0.5 bg-emerald-200 text-emerald-800 rounded-full font-semibold">✨ 추천</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      💰 판매가: {fmt만(b.total_price || 0)} / 미수금: {fmt만(bal)}
                    </div>
                  </div>
                </div>
                {b.booking_no && <span className="text-xs text-gray-400 shrink-0">{b.booking_no}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
