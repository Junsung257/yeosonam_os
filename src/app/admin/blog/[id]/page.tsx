'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { calculateSeoScore, getSeoGrade } from '@/lib/seo-scorer';

export default function BlogEditPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [blogHtml, setBlogHtml] = useState('');
  const [slug, setSlug] = useState('');
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [ogImageUrl, setOgImageUrl] = useState('');
  const [status, setStatus] = useState('draft');
  const [primaryKeyword, setPrimaryKeyword] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // 기존 글 로드
  useEffect(() => {
    if (!id) return;
    fetch(`/api/blog?id=${id}`)
      .then(r => r.json())
      .then(d => {
        const post = d.post;
        if (post) {
          setBlogHtml(post.blog_html || '');
          setSlug(post.slug || '');
          setSeoTitle(post.seo_title || '');
          setSeoDescription(post.seo_description || '');
          setOgImageUrl(post.og_image_url || '');
          setStatus(post.status || 'draft');
          setPrimaryKeyword(post.travel_packages?.destination || undefined);
        } else {
          showToast(d.error || '글을 찾을 수 없습니다');
        }
      })
      .catch(() => showToast('글을 불러오지 못했습니다'))
      .finally(() => setLoading(false));
  }, [id]);

  const previewHtml = useMemo(() => {
    if (!blogHtml) return '';
    try {
      const cleaned = blogHtml.replace(/\*\*([^*\n\[]+?)\*\*/g, (_m, inner) => inner);
      const html = /<[a-z][\s\S]*>/i.test(cleaned) ? cleaned : marked.parse(cleaned) as string;
      return DOMPurify.sanitize(html);
    } catch { return ''; }
  }, [blogHtml]);

  const seoScore = useMemo(() => {
    if (!blogHtml) return null;
    return calculateSeoScore({ content: blogHtml, primaryKeyword, metaTitle: seoTitle, metaDescription: seoDescription });
  }, [blogHtml, seoTitle, seoDescription]);

  const grade = seoScore ? getSeoGrade(seoScore.overall) : null;

  const handleSave = useCallback(async (targetStatus: 'draft' | 'published') => {
    if (!blogHtml.trim()) { showToast('본문을 입력하세요'); return; }
    if (!slug.trim()) { showToast('URL 슬러그를 입력하세요'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/blog', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          blog_html: blogHtml,
          slug,
          seo_title: seoTitle,
          seo_description: seoDescription,
          og_image_url: ogImageUrl || undefined,
          status: targetStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장 실패');
      setStatus(targetStatus);
      showToast(targetStatus === 'published' ? `발행 완료! /blog/${slug}` : '저장 완료');
    } catch (err: any) {
      showToast(err.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  }, [id, blogHtml, slug, seoTitle, seoDescription, ogImageUrl]);

  const handleReindex = async () => {
    if (!confirm('이 글의 색인 요청을 검색엔진에 다시 보내시겠습니까?\n\n- Google Indexing API\n- IndexNow (Bing/Yandex 등)\n- Bing sitemap ping')) return;
    setReindexing(true);
    try {
      const res = await fetch('/api/blog/reindex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '실패');
      const r = data.report;
      const lines = [
        `Google: ${r.google === 'success' ? '✓ 성공' : `✗ ${r.google_error || r.google}`}`,
        `IndexNow: ${r.indexnow === 'success' ? '✓ 성공' : `✗ ${r.indexnow_error || r.indexnow}`}`,
      ];
      showToast(`재색인 결과:\n${lines.join('\n')}`);
    } catch (err: any) {
      showToast(err.message || '재색인 실패');
    } finally {
      setReindexing(false);
    }
  };

  if (loading) return <div className="text-center py-12 text-slate-400">로딩 중...</div>;

  return (
    <div className="space-y-4">
      {/* 상단 바 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/admin/blog')} className="text-[12px] text-slate-500 hover:text-slate-700">← 목록</button>
          <h1 className="text-[16px] font-bold text-slate-800">블로그 편집</h1>
          <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-600'}`}>
            {status === 'published' ? '발행됨' : '초안'}
          </span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleSave('draft')} disabled={saving}
            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-[12px] rounded-lg hover:bg-slate-50 disabled:opacity-40 transition">
            저장
          </button>
          <button onClick={() => handleSave('published')} disabled={saving || !slug}
            className="px-4 py-2 bg-[#001f3f] text-white text-[12px] font-semibold rounded-lg hover:bg-blue-900 disabled:opacity-40 transition">
            {status === 'published' ? '업데이트' : '발행하기'}
          </button>
          {status === 'published' && slug && (
            <>
              <button onClick={handleReindex} disabled={reindexing}
                title="Google + IndexNow + Bing에 색인 요청 (색인 가속)"
                className="px-4 py-2 bg-white border border-emerald-300 text-emerald-700 text-[12px] rounded-lg hover:bg-emerald-50 disabled:opacity-40 transition">
                {reindexing ? '요청 중...' : '🔄 재색인 요청'}
              </button>
              <a href={`/blog/${slug}`} target="_blank" rel="noopener noreferrer"
                className="px-4 py-2 bg-white border border-blue-300 text-blue-600 text-[12px] rounded-lg hover:bg-blue-50 transition">
                ↗ 보기
              </a>
            </>
          )}
        </div>
      </div>

      {/* Split-pane 에디터 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" style={{ minHeight: '500px' }}>
        <div className="flex flex-col">
          <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-t-lg">
            <span className="text-[11px] text-slate-500 font-medium">마크다운 편집</span>
            <span className="text-[10px] text-slate-400">{blogHtml.length}자</span>
          </div>
          <textarea
            value={blogHtml}
            onChange={e => setBlogHtml(e.target.value)}
            className="flex-1 border border-t-0 border-slate-200 rounded-b-lg p-4 text-[13px] font-mono resize-none focus:outline-none focus:ring-1 focus:ring-[#005d90]"
          />
        </div>
        <div className="flex flex-col">
          <div className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-t-lg">
            <span className="text-[11px] text-slate-500 font-medium">미리보기</span>
          </div>
          <div className="flex-1 border border-t-0 border-slate-200 rounded-b-lg p-4 overflow-y-auto bg-white">
            {previewHtml ? (
              <div className="prose prose-sm prose-indigo max-w-none"
                dangerouslySetInnerHTML={{ __html: previewHtml }} />
            ) : (
              <p className="text-[13px] text-slate-300 italic">본문을 입력하면 미리보기가 표시됩니다</p>
            )}
          </div>
        </div>
      </div>

      {/* SEO 설정 */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[12px] font-semibold text-slate-700">SEO 설정</p>
          {grade && seoScore && (
            <div className="flex items-center gap-2">
              <span className={`text-[12px] font-bold ${grade.color}`}>{seoScore.overall}/100 {grade.label}</span>
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
              <span className="text-[11px] text-slate-400">/blog/</span>
              <input value={slug}
                onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9가-힣-]/g, '-').replace(/-+/g, '-'))}
                className="flex-1 border border-slate-200 rounded px-3 py-1.5 text-[13px] focus:ring-1 focus:ring-[#005d90]" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">OG 이미지</label>
            <input value={ogImageUrl} onChange={e => setOgImageUrl(e.target.value)}
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px] focus:ring-1 focus:ring-[#005d90]" />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">SEO 제목 <span className="text-slate-300">{seoTitle.length}/60</span></label>
            <input value={seoTitle} onChange={e => setSeoTitle(e.target.value.substring(0, 60))}
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px] focus:ring-1 focus:ring-[#005d90]" />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">SEO 설명 <span className="text-slate-300">{seoDescription.length}/160</span></label>
            <input value={seoDescription} onChange={e => setSeoDescription(e.target.value.substring(0, 160))}
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px] focus:ring-1 focus:ring-[#005d90]" />
          </div>
        </div>
        {seoScore && seoScore.recommendations.length > 0 && (
          <div className="mt-3 bg-amber-50 rounded-lg p-3">
            <p className="text-[10px] text-amber-700 font-medium mb-1">개선 권장사항</p>
            {seoScore.recommendations.slice(0, 5).map((rec, i) => (
              <p key={i} className="text-[11px] text-amber-600">• {rec}</p>
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg text-white text-[13px] shadow-lg bg-slate-800">
          {toast}
        </div>
      )}
    </div>
  );
}
