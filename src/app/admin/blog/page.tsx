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
      {/* 필터 탭 — 클라이언트 (URL 변경만 담당) */}
      <BlogFilterTabs currentStatus={status} />

      <section className="admin-card p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">구글 색인/노출</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              요청됨은 색인 요청, 색인처리됨은 URL Inspection 통과, 노출확인은 GSC 노출 데이터가 잡힌 상태입니다.
            </p>
          </div>
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">네이버 색인</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              현재는 IndexNow 요청 상태를 표시합니다. 실제 네이버 노출은 별도 수집 파이프라인으로 분리해야 합니다.
            </p>
          </div>
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">광고 OS 학습</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              구글 노출, CTA, 예약, 키워드 성과는 Ad OS에서 블로그/상품/테넌트 단위로 묶어 학습합니다.
            </p>
          </div>
        </div>
      </section>

      {/* 글 목록 — Suspense로 감싸 클릭 즉시 Skeleton 노출 */}
      <Suspense key={`${status}-${page}`} fallback={<BlogTableSkeleton />}>
        <BlogDataFetcher status={status} page={page} />
      </Suspense>
    </div>
  );
}
