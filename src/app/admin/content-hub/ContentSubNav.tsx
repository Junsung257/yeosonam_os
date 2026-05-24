'use client';

import SubNav from '@/components/admin/SubNav';

const CONTENT_TABS = [
  { href: '/admin/content-hub', label: '콘텐츠 허브' },
  { href: '/admin/content-queue', label: '콘텐츠 검수' },
  { href: '/admin/content-analytics', label: '콘텐츠 성과' },
  { href: '/admin/content-gaps', label: '콘텐츠 갭' },
];

export default function ContentSubNav() {
  return <SubNav basePath="/admin/content-hub" tabs={CONTENT_TABS} />;
}
