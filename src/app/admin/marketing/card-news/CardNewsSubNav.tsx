'use client';

import SubNav from '@/components/admin/SubNav';

const CARD_NEWS_TABS = [
  { href: '/admin/marketing/card-news', label: '카드뉴스 목록' },
  { href: '/admin/marketing/card-news/new', label: '새 카드뉴스' },
  { href: '/admin/marketing/card-news/campaign/new', label: '캠페인 생성' },
];

export default function CardNewsSubNav() {
  return <SubNav basePath="/admin/marketing/card-news" tabs={CARD_NEWS_TABS} />;
}
