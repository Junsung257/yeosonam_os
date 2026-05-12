'use client';

import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="맨 위로"
      className="fixed bottom-24 right-4 md:bottom-8 md:right-6 z-40
        flex h-10 w-10 items-center justify-center
        rounded-full border border-slate-200 bg-white shadow-md
        text-slate-500 transition
        hover:border-brand/40 hover:text-brand hover:shadow-lg
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <ArrowUp size={18} />
    </button>
  );
}
