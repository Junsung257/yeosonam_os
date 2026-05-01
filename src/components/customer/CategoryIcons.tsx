'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const CATEGORIES = [
  { icon: '🔥', label: '마감특가', href: '/packages?urgency=1' },
  { icon: '🌴', label: '동남아', href: '/destinations/region/southeast-asia' },
  { icon: '🏯', label: '일본', href: '/destinations/region/japan' },
  { icon: '🏮', label: '중국', href: '/destinations/region/china' },
  { icon: '🏛️', label: '유럽', href: '/destinations/region/europe' },
  { icon: '💍', label: '허니문', href: '/packages?category=honeymoon' },
  { icon: '⛳', label: '해외골프', href: '/packages?category=golf' },
  { icon: '📖', label: '매거진', href: '/blog' },
];

function isLinkActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href.startsWith('/blog')) return pathname.startsWith('/blog');
  if (href.includes('?')) return false; // query-param shortcuts: never show active
  const slug = href.split('/').pop() || '';
  return slug ? pathname.includes(slug) : false;
}

interface Props {
  className?: string;
}

export default function CategoryIcons({ className = '' }: Props) {
  const pathname = usePathname();

  return (
    <div className={`px-4 py-4 md:py-5 ${className}`}>
      <div className="max-w-[1024px] mx-auto">
        <div className="grid grid-cols-4 md:grid-cols-8 gap-x-1 gap-y-4">
          {CATEGORIES.map(cat => {
            const active = isLinkActive(cat.href, pathname);
            return (
              <Link
                key={cat.label}
                href={cat.href}
                className="flex flex-col items-center gap-2 group"
              >
                <div
                  className={`w-[60px] h-[60px] rounded-[16px] flex items-center justify-center text-[28px] transition-all
                    ${active
                      ? 'bg-[#EBF3FE] shadow-[0_0_0_2px_#3182F6]'
                      : 'bg-[#F2F4F6] group-hover:bg-[#EBF3FE]'
                    }`}
                >
                  {cat.icon}
                </div>
                <span
                  className={`text-[13px] md:text-[14px] font-medium tracking-[-0.01em] text-center leading-tight
                    ${active ? 'text-[#3182F6]' : 'text-[#191F28] group-hover:text-[#3182F6]'}`}
                >
                  {cat.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
