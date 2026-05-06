'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { calculateSeoScore, getSeoGrade } from '@/lib/seo-scorer';

interface CardNewsRow {
  id: string;
  title: string | null;
  status: string | null;
  variant_angle: string | null;
  variant_score: number | null;
  slide_image_urls: string[] | null;
  ig_slide_urls: string[] | null;
  created_at: string;
}

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
  const [productId, setProductId] = useState<string | null>(null);
  const [angleType, setAngleType] = useState<string | null>(null);
  const [productTitle, setProductTitle] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [toast, setToast] = useState('');

  // 카드뉴스 패널 상태
  const [cardNewsList, setCardNewsList] = useState<CardNewsRow[]>([]);
  const [cardNewsLoading, setCardNewsLoading] = useState(false);

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
          setProductId(post.product_id || null);
          setAngleType(post.angle_type || null);
          setProductTitle(post.travel_packages?.title || '');
        } else {
          showToast(d.error || '글을 찾을 수 없습니다');
        }
      })
      .catch(() => showToast('글을 불러오지 못했습니다'))
      .finally(() => setLoading(false));
  }, [id]);

  // 같은 상품의 기존 카드뉴스 목록 로드 (productId 확정된 후).
  // 이미지가 1장 이상 있는 카드뉴스만 표시 — 첨부 가능한 항목만 노출해 UX 혼란 방지.
  useEffect(() => {
    if (!productId) {
      setCardNewsList([]);
      return;
    }
    setCardNewsLoading(true);
    fetch(`/api/card-news?package_id=${productId}&limit=30`)
      .then(r => r.json())
      .then(d => {
        const all = (d.card_news || []) as CardNewsRow[];
        const attachable = all.filter(cn =>
          (cn.ig_slide_urls?.length ?? 0) > 0 ||
          (cn.slide_image_urls?.length ?? 0) > 0
        );
        setCardNewsList(attachable);
      })
      .catch(() => setCardNewsList([]))
      .finally(() => setCardNewsLoading(false));
  }, [productId]);

  // 카드뉴스 슬라이드 이미지를 본문 끝에 첨부
  const attachCardNewsToBody = useCallback((cn: CardNewsRow) => {
    const urls = (cn.ig_slide_urls && cn.ig_slide_urls.length > 0)
      ? cn.ig_slide_urls
      : (cn.slide_image_urls || []);
    if (urls.length === 0) {
      showToast('첨부 가능한 슬라이드 이미지가 없습니다 (먼저 카드뉴스 확정·렌더 필요)');
      return;
    }
    const altBase = cn.title || productTitle || '카드뉴스';
    // alt 첫 토큰 "카드뉴스슬라이드::" 가 CSS 셀렉터(prose-blog img[alt^="카드뉴스슬라이드::"]) 식별 키.
    // 카드뉴스는 1:1 / 4:5 / 9:16 등 세로 비율이라 일반 이미지 정책으로는 잘리거나 너무 큼.
    // 마크다운 alt 안의 대괄호는 파서가 오인할 수 있어 콜론 형태로 prefix.
    const block = [
      '',
      '## 카드뉴스로 한눈에',
      '',
      ...urls.map((url, i) => `![카드뉴스슬라이드:: ${altBase} ${i + 1}/${urls.length}](${url})`),
      '',
    ].join('\n');
    setBlogHtml(prev => prev.trimEnd() + '\n' + block);
    showToast(`${urls.length}장 첨부 완료 — 발행 전 위치 조정 가능`);
  }, [productTitle]);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/id-trigger-only intentional
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
      // v1.5 quality gate warnings 노출 — 발행은 진행되지만 어드민이 인지하도록.
      if (targetStatus === 'published' && Array.isArray(data.quality_warnings) && data.quality_warnings.length > 0) {
        const lines = data.quality_warnings.slice(0, 3).map((w: { gate: string; reason?: string }) => `· ${w.gate}: ${w.reason ?? ''}`).join('\n');
        showToast(`발행 완료! 다만 게이트 경고:\n${lines}`);
      } else {
        showToast(targetStatus === 'published' ? `발행 완료! /blog/${slug}` : '저장 완료');
      }
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

  if (loading) return (
    <div className="space-y-4">
      <div className="h-8 bg-slate-100 rounded animate-pulse w-64" />
      <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-6 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-3.5 bg-slate-100 rounded animate-pulse" style={{ width: `${85 - i * 8}%` }} />
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* 상단 바 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/admin/blog')} className="text-admin-xs text-slate-500 hover:text-slate-700">← 목록</button>
          <h1 className="text-admin-lg font-bold text-slate-800">블로그 편집</h1>
          <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-600'}`}>
            {status === 'published' ? '발행됨' : '초안'}
          </span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleSave('draft')} disabled={saving}
            className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-admin-xs rounded-lg hover:bg-slate-50 disabled:opacity-40 transition">
            저장
          </button>
          <button onClick={() => handleSave('published')} disabled={saving || !slug}
            className="px-4 py-2 bg-blue-600 text-white text-admin-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition">
            {status === 'published' ? '업데이트' : '발행하기'}
          </button>
          {status === 'published' && slug && (
            <>
              <button onClick={handleReindex} disabled={reindexing}
                title="Google + IndexNow + Bing에 색인 요청 (색인 가속)"
                className="px-4 py-2 bg-white border border-emerald-300 text-emerald-700 text-admin-xs rounded-lg hover:bg-emerald-50 disabled:opacity-40 transition">
                {reindexing ? '요청 중...' : '🔄 재색인 요청'}
              </button>
              <a href={`/blog/${slug}`} target="_blank" rel="noopener noreferrer"
                className="px-4 py-2 bg-white border border-blue-300 text-blue-600 text-admin-xs rounded-lg hover:bg-blue-50 transition">
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
            className="flex-1 border border-t-0 border-slate-200 rounded-b-lg p-4 text-admin-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-[#005d90]"
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
              <p className="text-admin-sm text-slate-300 italic">본문을 입력하면 미리보기가 표시됩니다</p>
            )}
          </div>
        </div>
      </div>

      {/* SEO 설정 */}
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
              <span className="text-[11px] text-slate-400">/blog/</span>
              <input value={slug}
                onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9가-힣-]/g, '-').replace(/-+/g, '-'))}
                className="flex-1 border border-slate-200 rounded px-3 py-1.5 text-admin-sm focus:ring-1 focus:ring-[#005d90]" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">OG 이미지</label>
            <input value={ogImageUrl} onChange={e => setOgImageUrl(e.target.value)}
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-admin-sm focus:ring-1 focus:ring-[#005d90]" />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">SEO 제목 <span className="text-slate-300">{seoTitle.length}/60</span></label>
            <input value={seoTitle} onChange={e => setSeoTitle(e.target.value.substring(0, 60))}
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-admin-sm focus:ring-1 focus:ring-[#005d90]" />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-1">SEO 설명 <span className="text-slate-300">{seoDescription.length}/160</span></label>
            <input value={seoDescription} onChange={e => setSeoDescription(e.target.value.substring(0, 160))}
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-admin-sm focus:ring-1 focus:ring-[#005d90]" />
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

      {/* 카드뉴스 연결 패널 — 상품 블로그일 때만 노출 */}
      {productId && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-admin-xs font-semibold text-slate-700">카드뉴스 연결</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                같은 상품의 카드뉴스를 본문에 첨부하거나 새로 만들 수 있어요
              </p>
            </div>
            <Link
              href={`/admin/marketing/card-news/new?package_id=${productId}${angleType ? `&angle=${angleType}` : ''}`}
              className="px-3 py-1.5 bg-blue-600 text-white text-[11px] font-semibold rounded-lg hover:bg-blue-700 transition"
            >
              + 이 글로 새 카드뉴스 만들기
            </Link>
          </div>

          {cardNewsLoading ? (
            <p className="text-admin-xs text-slate-400 py-4 text-center">카드뉴스 불러오는 중…</p>
          ) : cardNewsList.length === 0 ? (
            <div className="border border-dashed border-slate-200 rounded-lg p-4 text-center">
              <p className="text-admin-xs text-slate-500">첨부 가능한 카드뉴스가 없습니다</p>
              <p className="text-[11px] text-slate-400 mt-1">
                슬라이드 이미지가 렌더된 카드뉴스만 노출됩니다. 위 버튼으로 새로 만들거나, 기존 카드뉴스를 확정·렌더해 주세요.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {cardNewsList.slice(0, 6).map(cn => {
                const thumbs = (cn.ig_slide_urls && cn.ig_slide_urls.length > 0)
                  ? cn.ig_slide_urls
                  : (cn.slide_image_urls || []);
                const firstThumb = thumbs[0];
                const hasImages = thumbs.length > 0;
                return (
                  <div key={cn.id} className="flex items-center gap-3 border border-slate-200 rounded-lg p-2">
                    <div className="w-12 h-12 bg-slate-100 rounded overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {firstThumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={firstThumb} alt={cn.title || ''} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-slate-300 text-[10px]">no img</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-admin-xs font-medium text-slate-700 truncate">{cn.title || '(제목없음)'}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {cn.variant_angle && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-slate-50 text-slate-500 rounded">
                            {cn.variant_angle}
                          </span>
                        )}
                        {typeof cn.variant_score === 'number' && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${cn.variant_score >= 80 ? 'bg-emerald-50 text-emerald-700' : cn.variant_score >= 65 ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                            {cn.variant_score}점
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400">
                          {hasImages ? `${thumbs.length}장` : '이미지 없음'}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => attachCardNewsToBody(cn)}
                      disabled={!hasImages}
                      className="px-2.5 py-1 text-[11px] font-medium bg-white border border-slate-300 text-slate-700 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition flex-shrink-0"
                    >
                      본문 첨부
                    </button>
                  </div>
                );
              })}
              {cardNewsList.length > 6 && (
                <p className="text-[11px] text-slate-400 col-span-full text-center pt-1">
                  외 {cardNewsList.length - 6}개 더 — 전체는 카드뉴스 페이지에서 확인
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg text-white text-admin-sm shadow-lg bg-slate-800">
          {toast}
        </div>
      )}
    </div>
  );
}
