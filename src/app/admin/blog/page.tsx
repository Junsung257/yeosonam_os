'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface BlogPost {
  id: string;
  slug: string | null;
  seo_title: string | null;
  status: string;
  category: string | null;
  published_at: string | null;
  created_at: string;
  travel_packages: { title: string; destination: string } | null;
}

const STATUS_TABS = [
  { key: 'all', label: '전체' },
  { key: 'published', label: '발행됨' },
  { key: 'draft', label: '초안' },
];

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

export default function BlogAdminPage() {
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get('status') || 'all';
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(initialStatus);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ admin: '1', limit: '100' });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/blog?${params}`);
      const data = await res.json();
      setPosts(data.posts || []);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  const filtered = posts;

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

      {/* 필터 탭 */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition ${
              statusFilter === tab.key
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 글 목록 */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-[13px]">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-400 text-[13px] mb-3">아직 블로그 글이 없습니다.</p>
          <Link href="/admin/blog/write" className="text-blue-600 text-[13px] hover:underline">
            첫 글을 작성해보세요 →
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-2.5 text-[11px] text-slate-500 font-medium">제목</th>
                <th className="text-left px-3 py-2.5 text-[11px] text-slate-500 font-medium w-20">카테고리</th>
                <th className="text-left px-3 py-2.5 text-[11px] text-slate-500 font-medium w-16">상태</th>
                <th className="text-left px-3 py-2.5 text-[11px] text-slate-500 font-medium w-24">날짜</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(post => (
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
                  </td>
                  <td className="px-3 py-3">
                    <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${STATUS_BADGE[post.status] || 'bg-slate-100 text-slate-500'}`}>
                      {post.status === 'published' ? '발행' : post.status === 'draft' ? '초안' : post.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-[11px] text-slate-400">
                    {timeAgo(post.published_at || post.created_at)}
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      href={`/admin/blog/${post.id}`}
                      className="text-[11px] text-blue-600 hover:underline"
                    >
                      편집
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
