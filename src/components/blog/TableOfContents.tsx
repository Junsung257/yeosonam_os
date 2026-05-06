'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface TocItem {
  level: 2 | 3;
  text: string;
  id: string;
}

interface Props {
  items: TocItem[];
  variant?: 'mobile' | 'desktop' | 'both';
}

export default function TableOfContents({ items, variant = 'both' }: Props) {
  const showMobile = variant === 'mobile' || variant === 'both';
  const showDesktop = variant === 'desktop' || variant === 'both';
  const [activeId, setActiveId] = useState<string>('');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || items.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter(e => e.isIntersecting);
        if (visible.length > 0) {
          // 가장 위쪽에 있는 visible heading
          const topMost = visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
          setActiveId(topMost.target.id);
        }
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    );
    items.forEach(item => {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) return null;

  return (
    <>
      {/* 모바일 — 아코디언, Jiwonnote 미니멀 */}
      {showMobile && (
      <div className="md:hidden mb-8 border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setMobileOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3.5 text-sm font-bold text-slate-900"
          aria-expanded={mobileOpen}
        >
          <span>목차 ({items.length})</span>
          <ChevronDown size={16} className={`transition-transform ${mobileOpen ? 'rotate-180' : ''}`} />
        </button>
        {mobileOpen && (
          <ul className="px-4 pb-4 pt-1 space-y-2 border-t border-slate-100">
            {items.map(item => (
              <li key={item.id} className={item.level === 3 ? 'pl-4' : ''}>
                <a
                  href={`#${item.id}`}
                  onClick={() => setMobileOpen(false)}
                  className="block text-sm text-slate-600 hover:text-slate-900 transition leading-relaxed"
                >
                  {item.text}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      )}

      {/* 데스크톱 — sticky 사이드바, Jiwonnote 들여쓴 plain 리스트 */}
      {showDesktop && (
      <nav className="hidden md:block sticky top-24 self-start text-[13px]" aria-label="목차">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">목차</p>
        <ul className="space-y-0.5">
          {items.map(item => {
            const isActive = item.id === activeId;
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={`block leading-snug py-1.5 transition-all border-l-2 ${
                    item.level === 3 ? 'pl-5' : 'pl-3'
                  } ${
                    isActive
                      ? 'border-l-[var(--brand)] text-slate-900 font-semibold'
                      : 'border-l-transparent text-slate-500 hover:text-slate-900 hover:border-l-slate-300'
                  }`}
                >
                  {item.text}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      )}
    </>
  );
}
