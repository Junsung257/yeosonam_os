import Link from 'next/link';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const STATUS_BADGE: Record<string, string> = {
  published: 'bg-emerald-50 text-emerald-700',
  draft: 'bg-amber-50 text-amber-600',
  archived: 'bg-slate-100 text-slate-500',
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
      <div className="text-center py-12 text-slate-400 text-[13px]">DB 미연결 상태입니다.</div>
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
      <div className="text-center py-12 text-red-400 text-[13px]">
        데이터 로드 오류: {error.message}
      </div>
    );
  }

  const total = count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const statusQS = status !== 'all' ? `&status=${status}` : '';

  if (!posts || posts.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-400 text-[13px] mb-3">블로그 글이 없습니다.</p>
        <Link href="/admin/blog/write" className="text-blue-600 text-[13px] hover:underline">
          첫 글을 작성해보세요 →
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-2.5 text-[11px] text-slate-500 font-medium">제목</th>
              <th className="text-left px-3 py-2.5 text-[11px] text-slate-500 font-medium w-20">카테고리</th>
              <th className="text-right px-3 py-2.5 text-[11px] text-slate-500 font-medium w-16">조회</th>
              <th className="text-left px-3 py-2.5 text-[11px] text-slate-500 font-medium w-16">상태</th>
              <th className="text-left px-3 py-2.5 text-[11px] text-slate-500 font-medium w-24">날짜</th>
              <th className="w-16"></th>
            </tr>
          </thead>
          <tbody>
            {(posts as BlogPost[]).map(post => (
              <tr key={post.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                <td className="px-4 py-3">
                  <p className="text-[13px] font-medium text-slate-800 truncate max-w-md">
                    {post.seo_title || post.travel_packages?.title || '(제목 없음)'}
                  </p>
                  {post.slug && (
                    <p className="text-[11px] text-slate-400 mt-0.5">/blog/{post.slug}</p>
                  )}
                </td>
                <td className="px-3 py-3">
                  <span className="text-[10px] text-slate-500">
                    {CAT_LABELS[post.category || ''] || post.travel_packages?.destination || '-'}
                  </span>
                  {post.topic_source && post.topic_source !== 'manual' && (
                    <span className="ml-1 px-1 py-0.5 text-[9px] bg-indigo-50 text-indigo-600 rounded">
                      auto
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-right text-[12px] tabular-nums font-semibold text-slate-700">
                  {(post.view_count ?? 0).toLocaleString()}
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${
                      STATUS_BADGE[post.status] || 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {post.status === 'published' ? '발행' : post.status === 'draft' ? '초안' : post.status}
                  </span>
                </td>
                <td className="px-3 py-3 text-[11px] text-slate-400">
                  {timeAgo(post.published_at || post.created_at)}
                </td>
                <td className="px-3 py-3">
                  <Link href={`/admin/blog/${post.id}`} className="text-[11px] text-blue-600 hover:underline">
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
              className="px-3 py-1.5 text-[12px] bg-white border border-slate-200 rounded hover:bg-slate-50 transition"
            >
              이전
            </Link>
          )}
          <span className="text-[12px] text-slate-500">
            {page} / {totalPages} ({total.toLocaleString()}건)
          </span>
          {page < totalPages && (
            <Link
              href={`?page=${page + 1}${statusQS}`}
              className="px-3 py-1.5 text-[12px] bg-white border border-slate-200 rounded hover:bg-slate-50 transition"
            >
              다음
            </Link>
          )}
        </div>
      )}
    </>
  );
}
