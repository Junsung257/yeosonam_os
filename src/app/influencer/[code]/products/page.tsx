'use client';

import { useParams } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { useInfluencerAuth } from '../auth-context';

interface Package {
  id: string;
  title: string;
  destination?: string;
  duration?: number;
  price?: number;
  product_type?: string;
  airline?: string;
  departure_airport?: string;
  product_highlights?: string[];
  product_summary?: string;
  status?: string;
}

interface Link {
  id: string;
  package_id: string;
  package_title?: string;
  short_url: string;
  click_count: number;
  conversion_count: number;
  created_at: string;
}

export default function InfluencerProducts() {
  const params = useParams();
  const code = params.code as string;
  const { authenticated } = useInfluencerAuth();

  const [packages, setPackages] = useState<Package[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pkgRes, linkRes] = await Promise.all([
        fetch('/api/packages'),
        fetch(`/api/influencer/links?code=${code}`),
      ]);
      const pkgJson = await pkgRes.json();
      const linkJson = await linkRes.json();

      // approved 상태만 표시
      setPackages((pkgJson.packages || []).filter((p: Package) => p.status === 'approved'));
      setLinks(linkJson.links || []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { if (authenticated) load(); }, [authenticated, load]);

  // 링크 생성
  const createLink = async (pkg: Package) => {
    setCreating(pkg.id);
    try {
      const res = await fetch('/api/influencer/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referral_code: code,
          package_id: pkg.id,
          package_title: pkg.title,
        }),
      });
      const json = await res.json();

      if (json.short_url) {
        await navigator.clipboard.writeText(json.short_url);
        setCopiedId(pkg.id);
        setToast('링크가 생성되어 클립보드에 복사되었습니다');
        setTimeout(() => { setCopiedId(null); setToast(''); }, 3000);
        load(); // 링크 목록 갱신
      }
    } catch {
      setToast('링크 생성 실패');
      setTimeout(() => setToast(''), 3000);
    } finally {
      setCreating(null);
    }
  };

  // 클립보드 복사
  const copyLink = async (url: string, pkgId: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedId(pkgId);
    setToast('링크가 복사되었습니다');
    setTimeout(() => { setCopiedId(null); setToast(''); }, 2000);
  };

  // 필터/검색
  const destinations = [...new Set(packages.map(p => p.destination).filter(Boolean))];
  const filtered = packages.filter(p => {
    if (filter !== 'all' && p.destination !== filter) return false;
    if (search && !p.title?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // 해당 상품에 이미 생성된 링크 찾기
  const getLinkForPackage = (pkgId: string) => links.find(l => l.package_id === pkgId);

  if (!authenticated) {
    return <p className="text-center text-gray-400 py-20">먼저 대시보드에서 인증해주세요</p>;
  }

  return (
    <div className="space-y-4">
      {/* 토스트 */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium animate-fade-in">
          {toast}
        </div>
      )}

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">상품 & 링크 생성</h1>
          <p className="text-sm text-gray-500">상품을 선택하고 나만의 추천 링크를 생성하세요</p>
        </div>
        <div className="text-sm text-gray-400">
          생성 링크 <span className="font-bold text-blue-600">{links.length}</span>개
        </div>
      </div>

      {/* 검색 & 필터 */}
      <div className="flex gap-2 flex-wrap">
        <input
          type="text"
          placeholder="상품명 검색..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm flex-1 min-w-[200px] focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          전체
        </button>
        {destinations.map(d => (
          <button
            key={d}
            onClick={() => setFilter(d!)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${filter === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {d}
          </button>
        ))}
      </div>

      {/* 상품 목록 */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-48 bg-white rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-4xl mb-2">📭</p>
          <p>검색 결과가 없습니다</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(pkg => {
            const existingLink = getLinkForPackage(pkg.id);
            const isCreating = creating === pkg.id;
            const isCopied = copiedId === pkg.id;

            return (
              <div key={pkg.id} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                {/* 상품 정보 */}
                <div className="mb-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-gray-900 text-sm leading-snug break-keep line-clamp-2">{pkg.title}</h3>
                    {pkg.price && (
                      <span className="shrink-0 text-blue-600 font-extrabold text-sm">
                        ₩{pkg.price.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {pkg.destination && <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-[10px] rounded font-medium">{pkg.destination}</span>}
                    {pkg.duration && <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-[10px] rounded font-medium">{pkg.duration}일</span>}
                    {pkg.airline && <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-[10px] rounded font-medium">{pkg.airline}</span>}
                    {pkg.product_type && <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 text-[10px] rounded font-medium">{pkg.product_type}</span>}
                  </div>
                </div>

                {/* 하이라이트 */}
                {pkg.product_highlights && pkg.product_highlights.length > 0 && (
                  <div className="mb-3 space-y-0.5">
                    {pkg.product_highlights.slice(0, 3).map((h, i) => (
                      <p key={i} className="text-xs text-gray-500 flex gap-1">
                        <span className="text-green-500 shrink-0">✦</span> {h}
                      </p>
                    ))}
                  </div>
                )}

                {/* 링크 영역 */}
                {existingLink ? (
                  <div className="space-y-2">
                    {/* 기존 링크 표시 (정식 URL) */}
                    <div className="bg-gray-50 rounded-lg px-3 py-2 flex items-center gap-2">
                      <span className="text-xs text-gray-400 truncate flex-1 font-mono">{existingLink.short_url}</span>
                      <button
                        onClick={() => copyLink(existingLink.short_url, pkg.id)}
                        className={`shrink-0 px-2 py-1 rounded text-xs font-medium transition-colors ${
                          isCopied ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                        }`}
                      >
                        {isCopied ? '복사됨 ✓' : '복사'}
                      </button>
                    </div>

                    {/* 추가 공유 옵션 — 단축링크 / 임베드 코드 */}
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={() => {
                          const baseUrl = window.location.origin;
                          const short = `${baseUrl}/r/${code}/${pkg.id}`;
                          copyLink(short, pkg.id);
                        }}
                        className="px-2 py-1.5 bg-amber-50 text-amber-800 rounded text-[11px] font-medium hover:bg-amber-100 transition-colors"
                        title="카톡/페북 공유 시 어필리에이터+여소남 OG 이미지 자동 노출"
                      >
                        🔗 단축링크 + OG
                      </button>
                      <button
                        onClick={() => {
                          const baseUrl = window.location.origin;
                          const embed = `<iframe src="${baseUrl}/embed/pkg/${pkg.id}?ref=${code}" width="100%" height="300" frameborder="0" loading="lazy" style="border:0;border-radius:12px;"></iframe>`;
                          copyLink(embed, pkg.id);
                          setToast('임베드 코드가 복사되었습니다 (블로그 HTML에 붙여넣기)');
                        }}
                        className="px-2 py-1.5 bg-purple-50 text-purple-800 rounded text-[11px] font-medium hover:bg-purple-100 transition-colors"
                        title="티스토리/네이버 블로그 HTML에 붙여넣어 상품 카드 임베드"
                      >
                        📋 임베드 코드
                      </button>
                    </div>

                    {/* 클릭/전환 통계 */}
                    <div className="flex gap-3 text-xs text-gray-400">
                      <span>클릭 <b className="text-gray-600">{existingLink.click_count}</b></span>
                      <span>전환 <b className="text-gray-600">{existingLink.conversion_count}</b></span>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => createLink(pkg)}
                    disabled={isCreating}
                    className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
                  >
                    {isCreating ? '생성 중...' : '🔗 추천 링크 생성'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
