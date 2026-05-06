'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { calculateSeoScore, getSeoGrade } from '@/lib/seo-scorer';
import { ANGLE_PRESETS, ANGLE_SUB_KEYWORDS, type AngleType } from '@/lib/content-generator';

interface Package {
  id: string; title: string; destination?: string; duration?: number; price?: number; status: string;
}

const CATEGORIES = [
  { value: 'travel_tips', label: '여행팁' },
  { value: 'visa_info', label: '비자·입국' },
  { value: 'itinerary', label: '추천일정' },
  { value: 'preparation', label: '여행준비' },
  { value: 'local_info', label: '현지정보' },
];

const ANGLES = Object.entries(ANGLE_PRESETS).map(([key, v]) => ({ value: key, label: v.label }));

export default function BlogWritePage() {
  const router = useRouter();

  // 글 유형
  const [postType, setPostType] = useState<'product' | 'info'>('product');

  // 상품 기반
  const [packages, setPackages] = useState<Package[]>([]);
  const [selectedPkgId, setSelectedPkgId] = useState('');
  const [angle, setAngle] = useState<AngleType>('value');
  const [bulkCount, setBulkCount] = useState(1); // 1 | 3 | 5

  // 정보성
  const [topic, setTopic] = useState('');
  const [category, setCategory] = useState('travel_tips');

  // 에디터
  const [blogHtml, setBlogHtml] = useState('');
  const [slug, setSlug] = useState('');
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [ogImageUrl, setOgImageUrl] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null); // AI 생성 시 이미 저장된 draft id

  // 상태
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 5000); };

  // 상품 로드
  useEffect(() => {
    fetch('/api/packages?limit=200')
      .then(r => r.json())
      .then(d => {
        const all = d.data ?? d.packages ?? [];
        setPackages(all.filter((p: Package) =>
          ['approved', 'active', 'pending', 'pending_review', 'draft'].includes(p.status)
        ));
      })
      .catch(() => {});
  }, []);

  // 미리보기 HTML
  const previewHtml = useMemo(() => {
    if (!blogHtml) return '';
    try {
      const cleaned = blogHtml.replace(/\*\*([^*\n\[]+?)\*\*/g, (_m, inner) => inner);
      const html = /<[a-z][\s\S]*>/i.test(cleaned) ? cleaned : marked.parse(cleaned) as string;
      return DOMPurify.sanitize(html);
    } catch { return ''; }
  }, [blogHtml]);

  // SEO 점수
  const seoScore = useMemo(() => {
    if (!blogHtml) return null;
    const keyword = postType === 'product'
      ? packages.find(p => p.id === selectedPkgId)?.destination
      : topic.split(' ')[0];
    return calculateSeoScore({
      content: blogHtml,
      primaryKeyword: keyword || undefined,
      metaTitle: seoTitle,
      metaDescription: seoDescription,
    });
  }, [blogHtml, seoTitle, seoDescription, postType, selectedPkgId, packages, topic]);

  const grade = seoScore ? getSeoGrade(seoScore.overall) : null;

  // AI 자동 생성
  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      if (postType === 'product') {
        if (!selectedPkgId) { showToast('상품을 선택하세요'); return; }

        // bulk 모드: 2개 이상이면 서로 다른 키워드로 일괄 생성 → 목록으로 이동
        if (bulkCount > 1) {
          const res = await fetch('/api/blog/bulk-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_id: selectedPkgId, angle, count: bulkCount, tone: 'professional' }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || '일괄 생성 실패');
          showToast(`${data.success}/${data.total}개 생성 완료! 목록에서 확인하세요.`);
          setTimeout(() => router.push('/admin/blog?status=draft'), 1500);
          return;
        }

        const res = await fetch('/api/content-hub/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id: selectedPkgId,
            angle,
            channel: 'naver_blog',
            ratio: '16:9',
            slideCount: 0,
            tone: 'professional',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '생성 실패');
        const creative = data.creative;
        if (creative) {
          setBlogHtml(creative.blog_html || '');
          if (creative.slug) setSlug(creative.slug);
          if (creative.seo_title) setSeoTitle(creative.seo_title);
          if (creative.seo_description) setSeoDescription(creative.seo_description);
          if (creative.og_image_url) setOgImageUrl(creative.og_image_url);
          if (creative.id) setDraftId(creative.id); // 이미 draft로 저장된 id 기억
        }
        showToast('AI 블로그 생성 완료!');
      } else {
        if (!topic.trim()) { showToast('주제를 입력하세요'); return; }
        const res = await fetch('/api/blog/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic, category }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '생성 실패');
        setBlogHtml(data.blog_html || '');
        if (data.seo?.slug) setSlug(data.seo.slug);
        if (data.seo?.seoTitle) setSeoTitle(data.seo.seoTitle);
        if (data.seo?.seoDescription) setSeoDescription(data.seo.seoDescription);
        showToast('AI 블로그 생성 완료!');
      }
    } catch (err: any) {
      showToast(err.message || '생성 실패');
    } finally {
      setGenerating(false);
    }
  }, [postType, selectedPkgId, angle, bulkCount, topic, category, router]);

  // 저장 (초안/발행)
  const handleSave = useCallback(async (status: 'draft' | 'published') => {
    if (!blogHtml.trim()) { showToast('본문을 입력하세요'); return; }
    if (!slug.trim()) { showToast('URL 슬러그를 입력하세요'); return; }
    if (status === 'published' && !seoTitle.trim()) { showToast('발행 시 SEO 제목이 필요합니다'); return; }

    setSaving(true);
    try {
      // AI 생성으로 이미 draft 저장된 게 있으면 PATCH로 업데이트, 없으면 POST로 신규 생성
      const isUpdate = !!draftId;
      const res = await fetch('/api/blog', {
        method: isUpdate ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isUpdate ? {
          id: draftId,
          blog_html: blogHtml,
          slug,
          seo_title: seoTitle,
          seo_description: seoDescription,
          og_image_url: ogImageUrl || undefined,
          status,
        } : {
          blog_html: blogHtml,
          slug,
          seo_title: seoTitle,
          seo_description: seoDescription,
          og_image_url: ogImageUrl || undefined,
          product_id: postType === 'product' ? selectedPkgId || undefined : undefined,
          category: postType === 'info' ? category : 'product_intro',
          angle_type: angle,
          status,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장 실패');

      showToast(status === 'published' ? `발행 완료! /blog/${slug}` : '초안 저장 완료');
      const savedId = data.post?.id || draftId;
      if (savedId) {
        setTimeout(() => router.push(`/admin/blog/${savedId}`), 1000);
      }
    } catch (err: any) {
      showToast(err.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  }, [blogHtml, slug, seoTitle, seoDescription, ogImageUrl, postType, selectedPkgId, category, angle, draftId, router]);

  return (
    <div className="space-y-4">
      {/* 상단 바 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/admin/blog')} className="text-admin-xs text-slate-500 hover:text-slate-700">← 목록</button>
          <h1 className="text-admin-lg font-bold text-slate-800">블로그 에디터</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleSave('draft')} disabled={saving || !blogHtml}
            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-admin-xs rounded-lg hover:bg-slate-50 disabled:opacity-40 transition">
            {saving ? '저장 중...' : '초안 저장'}
          </button>
          <button onClick={() => handleSave('published')} disabled={saving || !blogHtml || !slug}
            className="px-4 py-2 bg-blue-600 text-white text-admin-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition">
            {saving ? '발행 중...' : '발행하기'}
          </button>
        </div>
      </div>

      {/* 글 유형 + 설정 */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4 space-y-3">
        {/* 유형 선택 */}
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-admin-sm cursor-pointer">
            <input type="radio" checked={postType === 'product'} onChange={() => setPostType('product')}
              className="text-blue-600" />
            상품 소개
          </label>
          <label className="flex items-center gap-1.5 text-admin-sm cursor-pointer">
            <input type="radio" checked={postType === 'info'} onChange={() => setPostType('info')}
              className="text-blue-600" />
            정보성 콘텐츠
          </label>
        </div>

        {postType === 'product' ? (
          <div className="space-y-2">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-[10px] text-slate-400 mb-1">상품 선택</label>
              <select value={selectedPkgId} onChange={e => setSelectedPkgId(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-2 text-admin-sm">
                <option value="">상품 선택...</option>
                {packages.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.title} {p.price ? `(₩${p.price.toLocaleString()})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-28">
              <label className="block text-[10px] text-slate-400 mb-1">앵글</label>
              <select value={angle} onChange={e => setAngle(e.target.value as AngleType)}
                className="w-full border border-slate-200 rounded px-3 py-2 text-admin-sm">
                {ANGLES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
            <div className="w-28">
              <label className="block text-[10px] text-slate-400 mb-1" title="같은 상품으로 서로 다른 키워드의 블로그 N개를 동시 생성 (긴꼬리 SEO)">
                생성 개수 <span className="text-slate-300">?</span>
              </label>
              <select value={bulkCount} onChange={e => setBulkCount(parseInt(e.target.value))}
                className="w-full border border-slate-200 rounded px-3 py-2 text-admin-sm">
                <option value={1}>1개</option>
                <option value={3}>3개 (권장)</option>
                <option value={5}>5개 (최대)</option>
              </select>
            </div>
            <button onClick={handleGenerate} disabled={generating || !selectedPkgId}
              className="px-4 py-2 bg-blue-600 text-white text-admin-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition whitespace-nowrap">
              {generating ? (bulkCount > 1 ? `${bulkCount}개 생성 중...` : 'AI 생성 중...') : (bulkCount > 1 ? `${bulkCount}개 일괄 생성` : 'AI 자동 생성')}
            </button>
          </div>
          {bulkCount > 1 && (
            <p className="text-[11px] text-slate-500 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
              💡 <strong>{bulkCount}개 일괄 생성</strong>: 같은 상품으로 서로 다른 키워드({ANGLE_SUB_KEYWORDS[angle].slice(0, bulkCount).map(s => s.keyword).join(', ')})의 블로그를 각각 생성합니다. 생성 후 <strong>블로그 목록(초안)</strong>에서 각각 검토 후 발행하세요.
            </p>
          )}
          </div>
        ) : (
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-[10px] text-slate-400 mb-1">주제</label>
              <input value={topic} onChange={e => setTopic(e.target.value)}
                placeholder="예: 베트남 비자 신청 방법, 다낭 맛집 추천 10곳"
                className="w-full border border-slate-200 rounded px-3 py-2 text-admin-sm" />
            </div>
            <div className="w-32">
              <label className="block text-[10px] text-slate-400 mb-1">카테고리</label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-2 text-admin-sm">
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <button onClick={handleGenerate} disabled={generating || !topic.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-admin-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition whitespace-nowrap">
              {generating ? 'AI 생성 중...' : 'AI 초안 생성'}
            </button>
          </div>
        )}
      </div>

      {/* Split-pane 에디터 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" style={{ minHeight: '500px' }}>
        {/* 좌: 마크다운 편집 */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-t-lg">
            <span className="text-[11px] text-slate-500 font-medium">마크다운 편집</span>
            <span className="text-[10px] text-slate-400">{blogHtml.length}자</span>
          </div>
          <textarea
            value={blogHtml}
            onChange={e => setBlogHtml(e.target.value)}
            placeholder="# 제목을 입력하세요&#10;&#10;## 소제목&#10;&#10;본문을 작성하세요..."
            className="flex-1 border border-t-0 border-slate-200 rounded-b-lg p-4 text-admin-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-[#005d90]"
          />
        </div>

        {/* 우: 미리보기 */}
        <div className="flex flex-col">
          <div className="flex items-center px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-t-lg">
            <span className="text-[11px] text-slate-500 font-medium">미리보기</span>
          </div>
          <div className="flex-1 border border-t-0 border-slate-200 rounded-b-lg p-4 overflow-y-auto bg-white">
            {previewHtml ? (
              <div className="prose prose-sm prose-indigo max-w-none"
                dangerouslySetInnerHTML={{ __html: previewHtml }} />
            ) : (
              <p className="text-admin-sm text-slate-300 italic">AI 생성 또는 직접 작성하면 미리보기가 표시됩니다</p>
            )}
          </div>
        </div>
      </div>

      {/* SEO 설정 + 점수 */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-admin-xs font-semibold text-slate-700">SEO 설정</p>
          {grade && seoScore && (
            <div className="flex items-center gap-2">
              <span className={`text-admin-xs font-bold ${grade.color}`}>{seoScore.overall}/100 {grade.label}</span>
              <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${seoScore.overall >= 80 ? 'bg-emerald-500' : seoScore.overall >= 60 ? 'bg-blue-500' : seoScore.overall >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                  style={{ width: `${seoScore.overall}%` }} />
              </div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">URL 슬러그</label>
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-slate-400 whitespace-nowrap">/blog/</span>
              <input value={slug}
                onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9가-힣-]/g, '-').replace(/-+/g, '-'))}
                placeholder="danang-hoian-value-trip"
                className="flex-1 border border-slate-200 rounded px-3 py-1.5 text-admin-sm focus:ring-1 focus:ring-[#005d90]" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">OG 이미지 (선택)</label>
            <input value={ogImageUrl} onChange={e => setOgImageUrl(e.target.value)}
              placeholder="https://images.pexels.com/..."
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-admin-sm focus:ring-1 focus:ring-[#005d90]" />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">SEO 제목 <span className="text-slate-300">{seoTitle.length}/60</span></label>
            <input value={seoTitle} onChange={e => setSeoTitle(e.target.value.substring(0, 60))}
              placeholder="다낭 호이안 3박5일 가성비 여행 | 2026 가이드"
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-admin-sm focus:ring-1 focus:ring-[#005d90]" />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">SEO 설명 <span className="text-slate-300">{seoDescription.length}/160</span></label>
            <input value={seoDescription} onChange={e => setSeoDescription(e.target.value.substring(0, 160))}
              placeholder="다낭 호이안 가성비 패키지 729,000원~. 여소남에서 비교하세요."
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-admin-sm focus:ring-1 focus:ring-[#005d90]" />
          </div>
        </div>

        {/* SEO 추천사항 */}
        {seoScore && seoScore.recommendations.length > 0 && (
          <div className="mt-3 bg-amber-50 rounded-lg p-3">
            <p className="text-[10px] text-amber-700 font-medium mb-1">개선 권장사항</p>
            {seoScore.recommendations.slice(0, 5).map((rec, i) => (
              <p key={i} className="text-[11px] text-amber-600">• {rec}</p>
            ))}
          </div>
        )}
      </div>

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg text-white text-admin-sm shadow-lg bg-slate-800">
          {toast}
        </div>
      )}
    </div>
  );
}
