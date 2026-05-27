import SubNav from '@/components/admin/SubNav';

const BLOG_TABS = [
  { href: '/admin/blog', label: '블로그 관리' },
  { href: '/admin/blog/write', label: '글 작성' },
  { href: '/admin/blog/queue', label: '발행 큐' },
  { href: '/admin/blog/rankings', label: '순위 대시보드' },
  { href: '/admin/blog/topical', label: '토픽 권위' },
  { href: '/admin/blog/categories', label: '카테고리' },
  { href: '/admin/blog/ads', label: '블로그 광고' },
  { href: '/admin/blog/policy', label: '발행 정책' },
];

export default function BlogSubNav() {
  return <SubNav basePath="/admin/blog" tabs={BLOG_TABS} />;
}
