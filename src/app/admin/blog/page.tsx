import { Suspense } from 'react';
import Link from 'next/link';
import BlogFilterTabs from './BlogFilterTabs';
import BlogDataFetcher from './BlogDataFetcher';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { Plus, Settings, Calendar, Tags } from 'lucide-react';

// Next 15: route segment config 는 정적 평가만 가능. 항상 'auto' (60초 캐시).
export const dynamic = 'auto';
export const revalidate = 60;

function BlogTableSkeleton() {
  return (
    <div className="admin-card overflow-hidden animate-pulse">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="border-b border-admin-border px-4 py-3 flex gap-4 items-center last:border-0">
          <div className="h-4 bg-admin-surface-2 rounded flex-1" />
          <div className="h-4 bg-admin-surface-2 rounded w-20" />
          <div className="h-4 bg-admin-surface-2 rounded w-10" />
          <div className="h-4 bg-admin-surface-2 rounded w-12" />
          <div className="h-4 bg-admin-surface-2 rounded w-20" />
          <div className="h-4 bg-admin-surface-2 rounded w-8" />
        </div>
      ))}
    </div>
  );
}

export default async function BlogAdminPage(
  props: {
    searchParams: Promise<{ status?: string; page?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const status = searchParams.status ?? 'all';
  const page = Math.max(1, Number(searchParams.page ?? '1'));

  return (
    <div className="space-y-4">
      <PageHeader
        title="블로그 관리"
        subtitle="SEO 최적화 블로그 글 작성 · 편집 · 발행"
        actions={
          <>
            <Link href="/admin/blog/system">
              <Button variant="secondary" size="sm">
                <Settings size={14} />
                시스템·크론
              </Button>
            </Link>
            <Link href="/admin/blog/queue">
              <Button variant="secondary" size="sm">
                <Calendar size={14} />
                자동 발행 큐
              </Button>
            </Link>
            <Link href="/admin/blog/categories">
              <Button variant="secondary" size="sm">
                <Tags size={14} />
                카테고리 관리
              </Button>
            </Link>
            <Link href="/admin/blog/write">
              <Button variant="primary" size="sm">
                <Plus size={14} />
                새 글 쓰기
              </Button>
            </Link>
          </>
        }
      />

      {/* 필터 탭 — 클라이언트 (URL 변경만 담당) */}
      <BlogFilterTabs currentStatus={status} />

      {/* 글 목록 — Suspense로 감싸 클릭 즉시 Skeleton 노출 */}
      <Suspense key={`${status}-${page}`} fallback={<BlogTableSkeleton />}>
        <BlogDataFetcher status={status} page={page} />
      </Suspense>
    </div>
  );
}
