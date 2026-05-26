'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function AffiliateCardNewsListPage() {
  const router = useRouter();
  const [info, setInfo] = useState<any>(null);
  const [cardNews, setCardNews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('affiliate_info');
    if (!stored) {
      router.replace('/affiliate/login');
      return;
    }
    setInfo(JSON.parse(stored));
    loadCardNews();
  }, [router]);

  const loadCardNews = async () => {
    const token = localStorage.getItem('affiliate_token');
    if (!token) return;
    try {
      const res = await fetch('/api/affiliate/card-news', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setCardNews(json.data || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('affiliate_token');
    localStorage.removeItem('affiliate_info');
    router.replace('/affiliate/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <a href="/affiliate/dashboard" className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            대시보드
          </a>
          <div className="flex items-center gap-3">
          <Link href="/affiliate/card-news/new" className="text-xs bg-amber-500 text-white px-3 py-1.5 rounded-lg hover:bg-amber-600">
              + 새 카드뉴스
            </Link>
            <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-gray-600">로그아웃</button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-lg font-semibold text-gray-900 mb-4">내 카드뉴스</h1>

        {loading ? (
          <div className="text-center py-12 text-gray-400 text-sm">로딩 중...</div>
        ) : cardNews.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border">
            <p className="text-gray-400 text-sm">아직 생성한 카드뉴스가 없습니다.</p>
            <Link href="/affiliate/card-news/new" className="inline-block mt-3 text-sm text-amber-600 hover:text-amber-700 underline">
              첫 카드뉴스 만들기
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {cardNews.map((cn) => (
              <div key={cn.id} className="bg-white rounded-xl border p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-gray-900 truncate">
                      {cn.title_slides?.[0]?.title || '제목 없음'}
                    </h3>
                    <p className="text-[10px] text-gray-400 mt-1">
                      {new Date(cn.created_at).toLocaleDateString('ko-KR')}
                      {cn.scheduled_at && ` · 예약: ${new Date(cn.scheduled_at).toLocaleDateString('ko-KR')}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400 ml-3">
                    <span>조회 {cn.views ?? 0}</span>
                    <span>클릭 {cn.clicks ?? 0}</span>
                    <span className={`px-1.5 py-0.5 rounded ${
                      cn.status === 'published' ? 'bg-green-100 text-green-700' :
                      cn.status === 'scheduled' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-500'
                    }`}>
                      {cn.status === 'published' ? '발행됨' : cn.status === 'scheduled' ? '예약' : '임시'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
