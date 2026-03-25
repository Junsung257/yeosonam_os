'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CardNews } from '@/lib/supabase';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  LAUNCHED: 'bg-green-100 text-green-700',
  ARCHIVED: 'bg-red-100 text-red-500',
};
const STATUS_LABELS: Record<string, string> = {
  DRAFT: '초안', CONFIRMED: '컨펌됨', LAUNCHED: '런치됨', ARCHIVED: '보관',
};

interface Package { id: string; title: string; destination: string; }

export default function CardNewsListPage() {
  const router = useRouter();
  const [list, setList] = useState<CardNews[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedPkg, setSelectedPkg] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/card-news');
      if (res.ok) {
        const data = await res.json();
        setList(data.card_news ?? []);
      } else {
        console.warn('카드뉴스 목록 로드 실패:', res.status);
        setList([]);
      }
    } catch (err) {
      console.error('카드뉴스 fetch 에러:', err);
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
    fetch('/api/packages?limit=200')
      .then(r => r.json())
      .then(d => {
        const all = d.data ?? d.packages ?? [];
        setPackages(all.filter((p: { status: string }) =>
          ['approved', 'active', 'pending_review', 'REVIEW_NEEDED'].includes(p.status)
        ));
      });
  }, [fetchList]);

  const handleCreate = async () => {
    if (!selectedPkg) return;
    setCreating(true);
    try {
      const res = await fetch('/api/card-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package_id: selectedPkg }),
      });
      const data = await res.json();
      if (res.ok && data.card_news?.id) {
        router.push(`/admin/marketing/card-news/${data.card_news.id}`);
      } else {
        alert(data.error ?? '생성 실패');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleArchive = async (id: string) => {
    if (!confirm('이 카드뉴스를 보관 처리하시겠습니까?')) return;
    await fetch(`/api/card-news/${id}`, {
      method: 'DELETE',
    });
    fetchList();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">카드뉴스 관리</h1>
          <p className="text-sm text-gray-500">상품 데이터 기반 자동 생성 → Meta Ads 즉시 배포</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => router.push('/admin/marketing')}
            className="px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            ← 대시보드
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            + 새 카드뉴스
          </button>
        </div>
      </div>

      {/* 카드뉴스 그리드 */}
      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">불러오는 중...</div>
      ) : list.length === 0 ? (
        <div className="py-20 text-center text-sm text-gray-400">
          카드뉴스가 없습니다. 상품을 선택해 첫 카드뉴스를 만들어보세요.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {list.map(cn => {
            const cover = cn.slides?.[0];
            return (
              <div key={cn.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* 커버 이미지 미리보기 */}
                <div
                  className="relative h-40 bg-gray-200 flex items-center justify-center overflow-hidden"
                  style={cover?.bg_image_url ? { backgroundImage: `url(${cover.bg_image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                >
                  {cover?.bg_image_url ? (
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  ) : (
                    <span className="text-gray-400 text-sm">이미지 없음</span>
                  )}
                  <div className="absolute bottom-2 left-3 right-3">
                    <p className="text-white text-sm font-bold truncate drop-shadow">{cover?.headline}</p>
                  </div>
                  <div className="absolute top-2 right-2">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_BADGE[cn.status]}`}>
                      {STATUS_LABELS[cn.status]}
                    </span>
                  </div>
                </div>

                <div className="p-4">
                  <p className="font-semibold text-gray-800 text-sm truncate">{cn.title}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {cn.package_destination ?? '—'} · {cn.slides?.length ?? 0}장
                  </p>
                  <p className="text-xs text-gray-300 mt-0.5">{cn.created_at?.slice(0, 10)}</p>

                  <div className="flex gap-2 mt-3">
                    <Link
                      href={`/admin/marketing/card-news/${cn.id}`}
                      className="flex-1 text-center text-xs py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium"
                    >
                      편집
                    </Link>
                    {cn.status !== 'ARCHIVED' && (
                      <button
                        onClick={() => handleArchive(cn.id)}
                        className="text-xs px-3 py-1.5 bg-gray-50 text-gray-500 rounded-lg hover:bg-gray-100"
                      >
                        보관
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 신규 생성 모달 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">새 카드뉴스 생성</h2>
            <p className="text-sm text-gray-500 mb-4">
              상품 데이터를 분석해 슬라이드를 자동으로 생성합니다.<br />
              Pexels 이미지도 자동으로 매칭됩니다.
            </p>
            <div>
              <label className="text-xs font-medium text-gray-600">상품 선택 *</label>
              <select
                value={selectedPkg}
                onChange={e => setSelectedPkg(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">상품 선택...</option>
                {packages.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.destination})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 border border-gray-200 text-sm text-gray-600 py-2 rounded-lg hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={handleCreate}
                disabled={!selectedPkg || creating}
                className="flex-1 bg-blue-600 text-white text-sm py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? '생성 중...' : '자동 생성 시작'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
