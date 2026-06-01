import Link from 'next/link';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { CAT_LABELS, VALID_CATEGORIES } from '@/lib/blog-categories';
import type { BlogCategory } from '@/lib/blog-categories';

const STATUS_BADGE: Record<string, string> = {
  published: 'bg-emerald-50 text-emerald-700',
  draft: 'bg-amber-50 text-amber-600',
  archived: 'bg-admin-surface-2 text-admin-muted',
};

// BlogDataFetcher 내부에서만 사용 (ssot는 lib/blog-categories.ts)

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
  travel_packages: { title: string; destination: string } | { title: string; destination: string }[] | null;
}

interface SearchStatus {
  googleIndexLabel: string;
  googleIndexClass: string;
  naverIndexLabel: string;
  naverIndexClass: string;
  exposureLabel: string;
  exposureClass: string;
}

function statusBadge(tone: 'good' | 'warn' | 'bad' | 'neutral'): string {
  if (tone === 'good') return 'bg-emerald-50 text-emerald-700';
  if (tone === 'warn') return 'bg-amber-50 text-amber-700';
  if (tone === 'bad') return 'bg-rose-50 text-rose-700';
  return 'bg-admin-surface-2 text-admin-muted';
}

function isGoogleIndexed(index: {
  google_status?: string | null;
  google_index_verdict?: string | null;
  google_coverage_state?: string | null;
} | undefined): boolean {
  const coverage = (index?.google_coverage_state || '').toLowerCase();
  return index?.google_status === 'indexed' || (index?.google_index_verdict === 'PASS' && coverage.includes('index'));
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
  const typedPosts = (posts || []) as BlogPost[];
  const slugs = typedPosts.map((post) => post.slug).filter((slug): slug is string => Boolean(slug));
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com').replace(/\/$/, '');

  const searchStatusBySlug = new Map<string, SearchStatus>();
  if (slugs.length > 0) {
    const [indexRes, rankRes] = await Promise.all([
      supabaseAdmin
        .from('indexing_reports')
        .select('url, google_status, google_error, google_index_verdict, google_coverage_state, google_indexing_state, google_last_crawl_time, indexnow_status, reported_at')
        .order('reported_at', { ascending: false })
        .limit(500),
      supabaseAdmin
        .from('rank_history')
        .select('slug, impressions, clicks, position, date')
        .in('slug', slugs)
        .eq('source', 'gsc-page')
        .gte('date', new Date(Date.now() - 30 * 86400_000).toISOString().split('T')[0]),
    ]);

    const latestIndexBySlug = new Map<string, {
      google_status: string | null;
      indexnow_status: string | null;
      google_error: string | null;
      google_index_verdict?: string | null;
      google_coverage_state?: string | null;
      google_indexing_state?: string | null;
      google_last_crawl_time?: string | null;
    }>();
    for (const row of indexRes.data || []) {
      const report = row as {
        url: string | null;
        google_status: string | null;
        google_error: string | null;
        indexnow_status: string | null;
        google_index_verdict?: string | null;
        google_coverage_state?: string | null;
        google_indexing_state?: string | null;
        google_last_crawl_time?: string | null;
      };
      const slug = slugs.find((s) =>
        report.url === `${baseUrl}/blog/${s}` ||
        report.url?.endsWith(`/blog/${s}`),
      );
      if (slug && !latestIndexBySlug.has(slug)) latestIndexBySlug.set(slug, report);
    }

    const exposureBySlug = new Map<string, { impressions: number; clicks: number; bestPosition: number | null }>();
    for (const row of rankRes.data || []) {
      const rank = row as { slug: string; impressions: number | null; clicks: number | null; position: number | null };
      const prev = exposureBySlug.get(rank.slug) || { impressions: 0, clicks: 0, bestPosition: null };
      prev.impressions += rank.impressions || 0;
      prev.clicks += rank.clicks || 0;
      if (rank.position) prev.bestPosition = prev.bestPosition === null ? rank.position : Math.min(prev.bestPosition, rank.position);
      exposureBySlug.set(rank.slug, prev);
    }

    for (const slug of slugs) {
      const index = latestIndexBySlug.get(slug);
      const exposure = exposureBySlug.get(slug);
      const impressions = exposure?.impressions || 0;
      const clicks = exposure?.clicks || 0;
      const googleRequested = index?.google_status === 'success';
      const googleFailed = index?.google_status === 'failed';
      const googleIndexed = isGoogleIndexed(index);
      const googleInspected = Boolean(index?.google_index_verdict || index?.google_coverage_state || ['indexed', 'not_indexed'].includes(index?.google_status || ''));
      const naverRequested = index?.indexnow_status === 'success';
      const naverFailed = index?.indexnow_status === 'failed';
      searchStatusBySlug.set(slug, {
        googleIndexLabel: googleIndexed ? '구글 색인처리됨' : googleInspected ? '구글 색인미확인' : googleRequested ? '구글 요청됨' : googleFailed ? '구글 실패' : '구글 대기',
        googleIndexClass: googleIndexed ? statusBadge('good') : googleInspected || googleRequested ? statusBadge('warn') : googleFailed ? statusBadge('bad') : statusBadge('neutral'),
        naverIndexLabel: naverRequested ? '네이버 요청됨' : naverFailed ? '네이버 실패' : '네이버 대기',
        naverIndexClass: naverRequested ? statusBadge('warn') : naverFailed ? statusBadge('bad') : statusBadge('neutral'),
        exposureLabel: impressions > 0 ? `${impressions.toLocaleString()} 노출${clicks > 0 ? `/${clicks.toLocaleString()} 클릭` : ''}` : '구글 미노출',
        exposureClass: impressions > 0 ? 'bg-blue-50 text-blue-700' : 'bg-admin-surface-2 text-admin-muted',
      });
    }
  }

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
              <th style={{ width: 150 }}>검색 상태</th>
              <th style={{ width: 96 }}>날짜</th>
              <th style={{ width: 64 }}></th>
            </tr>
          </thead>
          <tbody>
            {typedPosts.map(post => {
              const searchStatus = post.slug ? searchStatusBySlug.get(post.slug) : null;
              return (
              <tr key={post.id}>
                <td>
                  <p className="text-admin-sm font-medium text-admin-text truncate max-w-md">
                    {post.seo_title || (Array.isArray(post.travel_packages) ? post.travel_packages[0]?.title : post.travel_packages?.title) || '(제목 없음)'}
                  </p>
                  {post.slug && (
                    <p className="text-admin-xs text-admin-muted-2 mt-0.5 font-mono">/blog/{post.slug}</p>
                  )}
                </td>
                <td>
                  <span className="text-admin-2xs text-admin-muted">
                    {CAT_LABELS[post.category || ''] || (Array.isArray(post.travel_packages) ? post.travel_packages[0]?.destination : post.travel_packages?.destination) || '—'}
                  {post.category && !CAT_LABELS[post.category] && (
                    <span className="ml-1 px-1 py-0.5 text-[9px] bg-red-100 text-red-600 rounded-admin-xs font-semibold" title="정의되지 않은 카테고리">
                      !{post.category}
                    </span>
                  )}
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
                <td>
                  <div className="flex flex-col gap-1">
                    <span className={`w-fit px-1.5 py-0.5 text-admin-2xs rounded-admin-xs font-semibold ${searchStatus?.googleIndexClass || 'bg-admin-surface-2 text-admin-muted'}`}>
                      {searchStatus?.googleIndexLabel || '구글 대기'}
                    </span>
                    <span className={`w-fit px-1.5 py-0.5 text-admin-2xs rounded-admin-xs font-semibold ${searchStatus?.naverIndexClass || 'bg-admin-surface-2 text-admin-muted'}`}>
                      {searchStatus?.naverIndexLabel || '네이버 대기'}
                    </span>
                    <span className={`w-fit px-1.5 py-0.5 text-admin-2xs rounded-admin-xs font-semibold ${searchStatus?.exposureClass || 'bg-admin-surface-2 text-admin-muted'}`}>
                      {searchStatus?.exposureLabel || '구글 미노출'}
                    </span>
                  </div>
                </td>
                <td className="text-admin-xs text-admin-muted-2 admin-num">
                  {timeAgo(post.published_at || post.created_at)}
                </td>
                <td>
                  <div className="flex gap-1.5 items-center">
                    <Link href={`/admin/blog/${post.id}`} className="text-admin-xs text-brand hover:text-brand-dark font-medium hover:underline">
                      편집
                    </Link>
                    {post.slug && (
                      <a
                        href={`/blog/${post.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-admin-xs text-emerald-600 hover:text-emerald-700 font-medium hover:underline whitespace-nowrap"
                        title="실제 블로그 글 보기"
                      >
                        보기 →
                      </a>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
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
