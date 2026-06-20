'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { buildGroupInquiryHandoffHref } from '@/lib/group-inquiry-handoff';

const CATEGORY_GROUP_INQUIRY_HREF = buildGroupInquiryHandoffHref({
  source: 'category_icons',
  intent: 'group_trip',
  partyType: 'group',
  query: '카테고리에서 단체 맞춤 견적 상담',
  selectedProducts: ['카테고리 단체 맞춤 견적'],
});

type CategoryLink = {
  icon: string;
  label: string;
  href: string;
  testId?: string;
};

const CATEGORIES: CategoryLink[] = [
  { icon: '🔥', label: '마감특가', href: '/packages?urgency=1' },
  { icon: '🌴', label: '동남아', href: '/destinations/region/southeast-asia' },
  { icon: '🏯', label: '일본', href: '/destinations/region/japan' },
  { icon: '🏮', label: '중국', href: '/destinations/region/china' },
  { icon: '🏛️', label: '유럽', href: '/destinations/region/europe' },
  { icon: '💍', label: '허니문', href: '/packages?category=honeymoon' },
  { icon: '⛳', label: '해외골프', href: '/packages?category=golf' },
  { icon: '👨‍👩‍👧', label: '단독맞춤', href: '/private-tour' },
  { icon: '👥', label: '단체·맞춤', href: CATEGORY_GROUP_INQUIRY_HREF, testId: 'category-group-inquiry' },
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
    <div className={`py-3 md:py-4 ${className}`}>
      <div className="max-w-[1024px] mx-auto">
        <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory scrollbar-hide px-4 md:px-0 md:justify-center">
          {CATEGORIES.map(cat => {
            const active = isLinkActive(cat.href, pathname);
            return (
              <Link
                key={cat.label}
                href={cat.href}
                data-testid={cat.testId}
                className="flex flex-col items-center gap-1.5 group shrink-0 snap-start w-[72px] card-touch"
              >
                <div
                  className={`w-[56px] h-[56px] rounded-[16px] flex items-center justify-center text-[26px] transition-all
                    ${active
                      ? 'bg-brand-light shadow-[0_0_0_2px_#3182F6]'
                      : 'bg-bg-section group-hover:bg-brand-light'
                    }`}
                >
                  {cat.icon}
                </div>
                <span
                  className={`text-[12px] font-medium tracking-[-0.01em] text-center leading-tight whitespace-nowrap
                    ${active ? 'text-brand' : 'text-text-primary group-hover:text-brand'}`}
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
