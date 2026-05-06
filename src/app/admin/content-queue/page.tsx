'use client';

import { useState, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { useToast } from '@/components/ui/Toast';
import { marked } from 'marked';
import Link from 'next/link';

const ANGLE_LABELS: Record<string, string> = {
  value: '가성비', emotional: '감성', filial: '효도', luxury: '럭셔리',
  urgency: '긴급특가', activity: '액티비티', food: '미식',
};

interface QueueItem {
  id: string;
  slug: string | null;
  seo_title: string | null;
  seo_description: string | null;
  og_image_url: string | null;
  blog_html: string | null;
  angle_type: string;
  channel: string;
  status: string;
  tracking_id: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  product_id: string | null;
  travel_packages: { id: string; title: string; destination: string } | null;
}

/** 순수 글자수: 마크다운 태그/이미지URL 제거 후 측정 */
function getPlainTextLength(md: string | null): number {
  if (!md) return 0;
  return md
    .replace(/!?\[.*?\]\(.*?\)/g, '')   // 이미지/링크 마크다운
    .replace(/[#*_~`>|\-]/g, '')         // 마크다운 기호
    .replace(/\s+/g, ' ')               // 다중 공백 → 단일
    .trim()
    .length;
}

/** 품질 게이트 판정 */
function getQualityGate(item: QueueItem): { label: string; color: string; level: 'good' | 'warn' | 'bad' } {
  const len = getPlainTextLength(item.blog_html);
  const hasSlug = !!item.slug;
  const hasSeoTitle = !!item.seo_title;

  if (len >= 1500 && hasSlug && hasSeoTitle) return { label: '발행 가능', color: 'text-green-600 bg-green-50', level: 'good' };
  if (len >= 800 && hasSlug) return { label: '보완 필요', color: 'text-orange-600 bg-orange-50', level: 'warn' };
  return { label: '재생성 권장', color: 'text-red-600 bg-red-50', level: 'bad' };
}

export default function ContentQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [tab, setTab] = useState<'draft' | 'published' | 'archived'>('draft');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const { toast: _t } = useToast();
  const showToast = (msg: string) => _t(msg, /실패|오류/.test(msg) ? 'error' : /완료|발행/.test(msg) ? 'success' : /필수|선택/.test(msg) ? 'warning' : 'info');

  // 인라인 편집 상태
  const [editSlug, setEditSlug] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editOgImage, setEditOgImage] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [processing, setProcessing] = useState(false);

  // 목록 로드
  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/content-queue?status=${tab}&limit=50`);
      const data = await res.json();
      setItems(data.queue || []);
      setPendingCount(data.pending_count || 0);
    } catch { /* ignore */ }
    setLoading(false);
  }, [tab]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  // 아이템 선택 시 편집 필드 초기화
  const selectItem = (item: QueueItem) => {
    setSelectedId(item.id);
    setEditSlug(item.slug || '');
    setEditTitle(item.seo_title || '');
    setEditDesc(item.seo_description || '');
    setEditOgImage(item.og_image_url || '');
    setRejectReason('');
  };

  const selectedItem = items.find(i => i.id === selectedId);

  // 승인
  const handleApprove = async () => {
    if (!selectedId || !editSlug) { showToast('슬러그는 필수입니다'); return; }
    setProcessing(true);
    try {
      const res = await fetch('/api/content-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creative_id: selectedId,
          action: 'approve',
          slug: editSlug,
          seo_title: editTitle || null,
          seo_description: editDesc || null,
          og_image_url: editOgImage || null,
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      showToast(`발행 완료! /blog/${editSlug}`);
      setSelectedId(null);
      loadQueue();
    } catch (err) {
      showToast('승인 실패: ' + (err instanceof Error ? err.message : '오류'));
    }
    setProcessing(false);
  };

  // 일괄 승인 (slug이 있는 항목만)
  const handleBulkApprove = async () => {
    const targets = items.filter(i => checkedIds.has(i.id) && i.slug);
    if (targets.length === 0) { showToast('slug이 있는 항목을 선택하세요'); return; }
    setProcessing(true);
    let ok = 0;
    for (const item of targets) {
      try {
        const res = await fetch('/api/content-queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creative_id: item.id,
            action: 'approve',
            slug: item.slug,
            seo_title: item.seo_title,
            seo_description: item.seo_description,
            og_image_url: item.og_image_url,
          }),
        });
        if (res.ok) ok++;
      } catch { /* skip */ }
    }
    showToast(`${ok}건 일괄 발행 완료`);
    setCheckedIds(new Set());
    setSelectedId(null);
    loadQueue();
    setProcessing(false);
  };

  // 반려
  const handleReject = async () => {
    if (!selectedId) return;
    setProcessing(true);
    try {
      const res = await fetch('/api/content-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creative_id: selectedId,
          action: 'reject',
          reject_reason: rejectReason || undefined,
        }),
      });
      if (!res.ok) throw new Error('반려 처리 실패');
      showToast('반려 완료');
      setSelectedId(null);
      loadQueue();
    } catch (err) {
      showToast('반려 실패: ' + (err instanceof Error ? err.message : '오류'));
    }
    setProcessing(false);
  };

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-admin-lg font-semibold text-slate-800">콘텐츠 검수</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            AI 생성 블로그 콘텐츠 품질 검수 · 대기 <span className="font-bold text-indigo-600">{pendingCount}건</span>
          </p>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-slate-200">
        {([
          { key: 'draft' as const, label: '검수 대기', color: 'text-orange-600' },
          { key: 'published' as const, label: '발행됨', color: 'text-green-600' },
          { key: 'archived' as const, label: '반려/보관', color: 'text-slate-400' },
        ]).map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setSelectedId(null); }}
            className={`px-4 py-2 text-admin-sm font-medium border-b-2 transition ${
              tab === t.key ? `${t.color} border-current` : 'text-slate-400 border-transparent hover:text-slate-600'
            }`}>
            {t.label}
            {t.key === 'draft' && pendingCount > 0 && (
              <span className="ml-1.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-600">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* 일괄 승인 바 (draft 탭에서만) */}
      {tab === 'draft' && checkedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2">
          <span className="text-admin-xs text-indigo-700 font-medium">{checkedIds.size}건 선택</span>
          <button onClick={handleBulkApprove} disabled={processing}
            className="px-3 py-1.5 bg-green-600 text-white text-admin-xs font-semibold rounded hover:bg-green-700 disabled:bg-slate-300 transition">
            {processing ? '처리 중...' : '선택 일괄 승인'}
          </button>
          <button onClick={() => setCheckedIds(new Set())}
            className="text-[11px] text-slate-400 hover:text-slate-600">선택 해제</button>
        </div>
      )}

      {/* 본문: 목록 + 상세 패널 */}
      <div className="flex gap-4">
        {/* 좌측: 목록 */}
        <div className="flex-1 space-y-2">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-3 space-y-2">
                  <div className="h-3.5 bg-slate-100 rounded animate-pulse w-3/4" />
                  <div className="h-3 bg-slate-100 rounded animate-pulse w-1/2" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-admin-sm text-slate-400">
              {tab === 'draft' ? '검수 대기 중인 글이 없습니다' : '해당 상태의 글이 없습니다'}
            </p>
          ) : (
            items.map(item => {
              const gate = getQualityGate(item);
              const plainLen = getPlainTextLength(item.blog_html);
              return (
              <div key={item.id} className="flex items-start gap-2">
                {/* 체크박스 (draft 탭에서만) */}
                {tab === 'draft' && (
                  <input type="checkbox" checked={checkedIds.has(item.id)}
                    onChange={e => {
                      const next = new Set(checkedIds);
                      e.target.checked ? next.add(item.id) : next.delete(item.id);
                      setCheckedIds(next);
                    }}
                    className="mt-3.5 w-4 h-4 rounded border-slate-300 text-indigo-600 flex-shrink-0" />
                )}
                <button onClick={() => selectItem(item)}
                  className={`flex-1 text-left p-3 rounded-lg border transition ${
                    selectedId === item.id
                      ? 'border-indigo-300 bg-indigo-50 shadow-sm'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-1">
                        {item.travel_packages?.destination && (
                          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                            {item.travel_packages.destination}
                          </span>
                        )}
                        <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400">
                          {ANGLE_LABELS[item.angle_type] || item.angle_type}
                        </span>
                        {item.status === 'published' && (
                          <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-600">발행됨</span>
                        )}
                        {/* 품질 게이트 배지 */}
                        {tab === 'draft' && (
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${gate.color}`}>
                            {gate.label}
                          </span>
                        )}
                      </div>
                      <p className="text-admin-sm font-medium text-slate-800 truncate">
                        {item.seo_title || item.travel_packages?.title || '제목 없음'}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {new Date(item.created_at).toLocaleDateString('ko-KR')} · {plainLen.toLocaleString()}자 · {item.tracking_id || '-'}
                      </p>
                    </div>
                  {item.slug && item.status === 'published' && (
                    <Link href={`/blog/${item.slug}`} target="_blank"
                      className="flex-shrink-0 text-[10px] text-indigo-500 hover:underline">
                      보기 →
                    </Link>
                  )}
                </div>
              </button>
              </div>
              );
            })
          )}
        </div>

        {/* 우측: 상세 패널 */}
        {selectedItem && (
          <div className="w-96 flex-shrink-0 border border-slate-200 rounded-lg bg-white p-4 space-y-4 overflow-y-auto max-h-[calc(100vh-200px)]">
            <p className="text-admin-xs font-semibold text-slate-700 uppercase">콘텐츠 상세</p>

            {/* 본문 미리보기 */}
            <div className="border border-slate-100 rounded-lg p-3 max-h-64 overflow-y-auto">
              {selectedItem.blog_html ? (
                <div className="prose prose-sm max-w-none text-admin-xs"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(
                      /<[a-z][\s\S]*>/i.test(selectedItem.blog_html)
                        ? selectedItem.blog_html
                        : marked.parse(selectedItem.blog_html) as string,
                    ),
                  }} />
              ) : (
                <p className="text-admin-xs text-slate-400">본문 없음</p>
              )}
            </div>

            {/* SEO 편집 (draft에서만 편집 가능) */}
            {tab === 'draft' && (
              <>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">URL 슬러그</label>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-slate-400">/blog/</span>
                    <input value={editSlug}
                      onChange={e => setEditSlug(e.target.value.toLowerCase().replace(/[^a-z0-9가-힣-]/g, '-').replace(/-+/g, '-'))}
                      placeholder="bangkok-5days-trip"
                      className="flex-1 border border-slate-200 rounded px-2 py-1 text-admin-xs focus:ring-1 focus:ring-indigo-400" />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">SEO 제목</label>
                  <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                    maxLength={60}
                    className="w-full border border-slate-200 rounded px-2 py-1 text-admin-xs focus:ring-1 focus:ring-indigo-400" />
                  <p className="text-[9px] text-slate-400 mt-0.5">{editTitle.length}/60</p>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">SEO 설명</label>
                  <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)}
                    maxLength={160}
                    className="w-full border border-slate-200 rounded px-2 py-1 text-admin-xs h-14 resize-none focus:ring-1 focus:ring-indigo-400" />
                  <p className="text-[9px] text-slate-400 mt-0.5">{editDesc.length}/160</p>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">OG 이미지</label>
                  <input value={editOgImage} onChange={e => setEditOgImage(e.target.value)}
                    placeholder="https://..."
                    className="w-full border border-slate-200 rounded px-2 py-1 text-admin-xs focus:ring-1 focus:ring-indigo-400" />
                </div>

                {/* 액션 버튼 */}
                <div className="pt-2 space-y-2">
                  <button onClick={handleApprove} disabled={processing || !editSlug}
                    className="w-full py-2 bg-green-600 text-white text-admin-sm font-semibold rounded-lg hover:bg-green-700 disabled:bg-slate-300 transition">
                    {processing ? '처리 중...' : '승인 · 블로그 발행'}
                  </button>
                  <div>
                    <input value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                      placeholder="반려 사유 (선택)"
                      className="w-full border border-slate-200 rounded px-2 py-1 text-[11px] mb-1" />
                    <button onClick={handleReject} disabled={processing}
                      className="w-full py-1.5 border border-red-200 text-red-500 text-admin-xs rounded hover:bg-red-50 disabled:text-slate-300 transition">
                      {processing ? '처리 중...' : '반려'}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* 발행된 글 링크 */}
            {tab === 'published' && selectedItem.slug && (
              <Link href={`/blog/${selectedItem.slug}`} target="_blank"
                className="block w-full py-2 bg-blue-600 text-white text-admin-sm font-semibold rounded-lg hover:bg-blue-700 transition text-center">
                블로그에서 보기 →
              </Link>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
