'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

interface MobileHeaderProps {
  title: string;
  subtitle?: string;
  backHref?: string;
  showBack?: boolean;
  rightSlot?: React.ReactNode;
}

export function MobileHeader({
  title,
  subtitle,
  backHref,
  showBack = false,
  rightSlot,
}: MobileHeaderProps) {
  const router = useRouter();

  return (
    <header
      className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex items-center gap-3 h-14 px-3">
        {showBack &&
          (backHref ? (
            <Link
              href={backHref}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100 active:scale-95 transition"
              aria-label="뒤로"
            >
              <ArrowLeft size={20} />
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => router.back()}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100 active:scale-95 transition"
              aria-label="뒤로"
            >
              <ArrowLeft size={20} />
            </button>
          ))}
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold text-slate-900 truncate leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-xs text-slate-500 truncate leading-tight mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>
    </header>
  );
}
