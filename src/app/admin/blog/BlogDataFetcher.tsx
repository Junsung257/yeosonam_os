import Link from 'next/link';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const STATUS_BADGE: Record<string, string> = {
  published: 'bg-emerald-50 text-emerald-700',
  draft: 'bg-amber-50 text-amber-600',
  archived: 'bg-admin-surface-2 text-admin-muted',
};

const CAT_LABELS: Record<string, string> = {
  product_intro: '상품 소개',
  travel_tips: '여행팁',
  visa_info: '비자·입국',
  itinerary: '추천일정',
  preparation: '여행준비',
  local_info: '현지정보',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}분 전`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}시간 전`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

const PAGE_SIZE = 50;

interface BlogPost {
  id: string;
  slug: string | null;
  seo_title: string | null;
  status: string;
  category: string | null;
  published_at: string | null;
  created_at: string;
  view_count: number | null;
  topic_source: string | null;
  travel_packages: { title: string; destination: string } | null;
}

export default async function BlogDataFetcher({
  status,
  page,
}: {
  status: string;
  page: number;
}) {
  if (!isSupabaseConfigured) {
    return (
      <div className="text-center py-12 text-admin-muted-2 text-admin-sm">DB 미연결 상태입니다.</div>
    );
  }

  const offset = (page - 1) * PAGE_SIZE;

  let query = supabaseAdmin
    .from('content_creatives')
    .select(
      'id, slug, seo_title, status, category, published_at, created_at, view_count, topic_source, travel_packages(title, destination)',
      { count: 'exact' }
    )
    .eq('channel', 'naver_blog')
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (status !== 'all') {
    query = query.eq('status', status);
  }

  const { data: posts, count, error } = await query;

  if (error) {
    return (
      <div className="text-center py-12 text-red-400 text-admin-sm">
        데이터 로드 오류: {error.message}
      </div>
    );
  }

  const total = count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const statusQS = status !== 'all' ? `&status=${status}` : '';

  if (!posts || posts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-14 admin-card">
        <div className="w-12 h-12 rounded-full bg-admin-surface-2 flex items-center justify-center text-admin-muted">
          <svg width={20} height={20} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        </div>
        <p className="text-admin-sm font-medium text-admin-muted">블로그 글이 없습니다.</p>
        <Link href="/admin/blog/write" className="text-brand text-admin-sm hover:text-brand-dark hover:underline font-medium">
          첫 글을 작성해보세요 →
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>제목</th>
              <th style={{ width: 80 }}>카테고리</th>
              <th className="text-right" style={{ width: 64 }}>조회</th>
              <th style={{ width: 64 }}>상태</th>
              <th style={{ width: 96 }}>날짜</th>
              <th style={{ width: 64 }}></th>
            </tr>
          </thead>
          <tbody>
            {(posts as BlogPost[]).map(post => (
              <tr key={post.id}>
                <td>
                  <p className="text-admin-sm font-medium text-admin-text truncate max-w-md">
                    {post.seo_title || post.travel_packages?.title || '(제목 없음)'}
                  </p>
                  {post.slug && (
                    <p className="text-admin-xs text-admin-muted-2 mt-0.5 font-mono">/blog/{post.slug}</p>
                  )}
                </td>
                <td>
                  <span className="text-admin-2xs text-admin-muted">
                    {CAT_LABELS[post.category || ''] || post.travel_packages?.destination || '—'}
                  </span>
                  {post.topic_source && post.topic_source !== 'manual' && (
                    <span className="ml-1 px-1 py-0.5 text-[9px] bg-brand-light text-brand rounded-admin-xs font-semibold uppercase">
                      auto
                    </span>
                  )}
                </td>
                <td className="text-right text-admin-xs admin-num font-semibold text-admin-text">
                  {(post.view_count ?? 0).toLocaleString()}
                </td>
                <td>
                  <span
                    className={`px-1.5 py-0.5 text-admin-2xs rounded-admin-xs font-semibold ${
                      STATUS_BADGE[post.status] || 'bg-admin-surface-2 text-admin-muted'
                    }`}
                  >
                    {post.status === 'published' ? '발행' : post.status === 'draft' ? '초안' : post.status}
                  </span>
                </td>
                <td className="text-admin-xs text-admin-muted-2 admin-num">
                  {timeAgo(post.published_at || post.created_at)}
                </td>
                <td>
                  <Link href={`/admin/blog/${post.id}`} className="text-admin-xs text-brand hover:text-brand-dark font-medium hover:underline">
                    편집
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-2">
          {page > 1 && (
            <Link
              href={`?page=${page - 1}${statusQS}`}
              className="h-8 px-3 inline-flex items-center text-admin-sm bg-admin-surface border border-admin-border-mid rounded-admin-sm hover:bg-admin-surface-2 hover:border-admin-border-strong transition-colors text-admin-text-2 font-medium"
            >
              이전
            </Link>
          )}
          <span className="text-admin-sm text-admin-muted admin-num">
            {page} / {totalPages} ({total.toLocaleString()}건)
          </span>
          {page < totalPages && (
            <Link
              href={`?page=${page + 1}${statusQS}`}
              className="h-8 px-3 inline-flex items-center text-admin-sm bg-admin-surface border border-admin-border-mid rounded-admin-sm hover:bg-admin-surface-2 hover:border-admin-border-strong transition-colors text-admin-text-2 font-medium"
            >
              다음
            </Link>
          )}
        </div>
      )}
    </>
  );
}
