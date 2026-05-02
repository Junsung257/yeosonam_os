import { Suspense } from 'react';
import Link from 'next/link';
import BlogFilterTabs from './BlogFilterTabs';
import BlogDataFetcher from './BlogDataFetcher';

// Windows dev: chunk race 방지 / Vercel(Linux): 60초 캐시
export const dynamic = process.platform === 'win32' ? 'force-dynamic' : 'auto';
export const revalidate = 60;

function BlogTableSkeleton() {
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden animate-pulse">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="border-b border-slate-100 px-4 py-3 flex gap-4 items-center">
          <div className="h-4 bg-slate-100 rounded flex-1" />
          <div className="h-4 bg-slate-100 rounded w-20" />
          <div className="h-4 bg-slate-100 rounded w-10" />
          <div className="h-4 bg-slate-100 rounded w-12" />
          <div className="h-4 bg-slate-100 rounded w-20" />
          <div className="h-4 bg-slate-100 rounded w-8" />
        </div>
      ))}
    </div>
  );
}

export default function BlogAdminPage({
  searchParams,
}: {
  searchParams: { status?: string; page?: string };
}) {
  const status = searchParams.status ?? 'all';
  const page = Math.max(1, Number(searchParams.page ?? '1'));

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-slate-800">블로그 관리</h1>
          <p className="text-[12px] text-slate-400 mt-0.5">SEO 최적화 블로그 글 작성 · 편집 · 발행</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/blog/system"
            className="px-3 py-2 bg-white border border-slate-300 text-slate-600 text-[12px] rounded-lg hover:bg-slate-50 transition"
          >
            시스템·크론
          </Link>
          <Link
            href="/admin/blog/queue"
            className="px-3 py-2 bg-white border border-slate-300 text-slate-600 text-[12px] rounded-lg hover:bg-slate-50 transition"
          >
            자동 발행 큐
          </Link>
          <Link
            href="/admin/blog/categories"
            className="px-3 py-2 bg-white border border-slate-300 text-slate-600 text-[12px] rounded-lg hover:bg-slate-50 transition"
          >
            카테고리 관리
          </Link>
          <Link
            href="/admin/blog/write"
            className="px-4 py-2 bg-[#001f3f] text-white text-[13px] font-semibold rounded-lg hover:bg-blue-900 transition"
          >
            + 새 글 쓰기
          </Link>
        </div>
      </div>

      {/* 필터 탭 — 클라이언트 (URL 변경만 담당) */}
      <BlogFilterTabs currentStatus={status} />

      {/* 글 목록 — Suspense로 감싸 클릭 즉시 Skeleton 노출 */}
      <Suspense key={`${status}-${page}`} fallback={<BlogTableSkeleton />}>
        <BlogDataFetcher status={status} page={page} />
      </Suspense>
    </div>
  );
}
