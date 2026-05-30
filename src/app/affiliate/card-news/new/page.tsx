'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function AffiliateCardNewsNewPage() {
  const router = useRouter();
  const [info, setInfo] = useState<any>(null);
  const [checking, setChecking] = useState(true);
  const [topic, setTopic] = useState('');
  const [style, setStyle] = useState('travel');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    const stored = localStorage.getItem('affiliate_info');
    if (!stored) router.replace('/affiliate/login');
    else setInfo(JSON.parse(stored));
    setChecking(false);
  }, [router]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    setGenerating(true);
    setError('');

    try {
      const token = localStorage.getItem('affiliate_token');
      const res = await fetch('/api/affiliate/card-news', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          topic: topic.trim(),
          style,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error || '생성 실패');
        return;
      }

      setResult(json);
    } catch {
      setError('네트워크 오류');
    } finally {
      setGenerating(false);
    }
  };

  if (checking) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <a href="/affiliate/dashboard" className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            대시보드
          </a>
          <h1 className="text-sm font-semibold text-gray-900">새 카드뉴스 만들기</h1>
          <div className="w-16" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {!result ? (
          <form onSubmit={handleGenerate} className="bg-white rounded-xl border p-6 space-y-5">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">{error}</div>
            )}

            <div>
              <label htmlFor="card-news-topic" className="block text-sm font-medium text-gray-700 mb-2">주제</label>
              <input
                id="card-news-topic"
                type="text"
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="예: 제주도 여행 추천 코스"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                required
              />
              <p className="text-[10px] text-gray-400 mt-1">생성할 카드뉴스의 주제를 입력하세요.</p>
            </div>

            <div>
              <label htmlFor="card-news-style" className="block text-sm font-medium text-gray-700 mb-2">스타일</label>
              <select
                id="card-news-style"
                value={style}
                onChange={e => setStyle(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              >
                <option value="travel">여행</option>
                <option value="food">맛집</option>
                <option value="lifestyle">라이프스타일</option>
                <option value="promotion">프로모션</option>
              </select>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              <p className="font-medium mb-1">크레딧: {info?.content_used ?? 0} / {info?.content_quota ?? 0}회 사용</p>
              <p>1회 생성 시 1크레딧이 차감됩니다.</p>
            </div>

            <button
              type="submit"
              disabled={generating || (info?.content_used ?? 0) >= (info?.content_quota ?? 0)}
              className="w-full bg-gradient-to-r from-amber-500 to-orange-600 text-white py-3 rounded-lg font-medium hover:from-amber-600 hover:to-orange-700 disabled:opacity-50 transition-all text-sm"
            >
              {generating ? 'AI가 카드뉴스를 생성 중입니다...' : '카드뉴스 생성'}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border p-6 text-center">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">카드뉴스 생성 완료!</h2>
              <p className="text-xs text-gray-500 mt-1">{result.count}개의 슬라이드가 생성되었습니다.</p>
            </div>

            {/* 미리보기 */}
            <div className="grid grid-cols-2 gap-3">
              {result.slides?.map((slide: any, i: number) => (
                <div key={i} className="bg-white rounded-xl border overflow-hidden">
                  {slide.image_url && (
                    <img src={slide.image_url} alt="" className="w-full h-32 object-cover" />
                  )}
                  <div className="p-3">
                    <p className="text-xs font-medium text-gray-900 line-clamp-2">{slide.title || slide.content}</p>
                    <p className="text-[10px] text-gray-400 mt-1">슬라이드 {i + 1}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <Link
                href="/affiliate/card-news"
                className="flex-1 text-center py-2.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                내 카드뉴스 보기
              </Link>
              <button
                onClick={() => { setResult(null); setTopic(''); }}
                className="flex-1 py-2.5 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600 transition-colors"
              >
                새로 만들기
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
