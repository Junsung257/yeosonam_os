'use client';

/**
 * /admin/products/[id]/distribute
 *
 * 1개 상품으로 여러 플랫폼 마케팅 아웃풋 생성/관리 대시보드.
 *
 * 기능:
 *   - "전체 생성" 버튼 → /api/content/generate-all
 *   - 플랫폼별 개별 생성 버튼
 *   - 생성된 캡션/포스트 표시 + 복사 버튼
 *   - content_distributions 테이블 조회
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

interface Distribution {
  id: string;
  platform: string;
  payload: Record<string, unknown>;
  status: string;
  updated_at: string;
}

interface Product {
  id: string;
  title: string;
  destination?: string;
  price?: number;
}

interface LinkedCardNews {
  id: string;
  title: string;
  status?: string;
  template_family?: string;
  slides?: Array<Record<string, unknown>>;
  slide_image_urls?: string[];
}

const PLATFORM_META: Record<string, { label: string; color: string; icon: string; api: string }> = {
  instagram_caption: { label: 'Instagram 캡션', color: 'from-pink-500 to-orange-500', icon: 'IG', api: 'instagram-caption' },
  threads_post:      { label: 'Threads 포스트',   color: 'from-slate-700 to-slate-900',  icon: 'Th', api: 'threads-post' },
  card_news:         { label: '카드뉴스',          color: 'from-blue-500 to-indigo-600',  icon: 'CN', api: '' },
  blog_body:         { label: '블로그 본문',       color: 'from-emerald-500 to-teal-600', icon: 'Bg', api: 'blog-body' },
  meta_ads:          { label: 'Meta Ads',         color: 'from-blue-600 to-blue-800',    icon: 'MA', api: 'meta-ads' },
  google_ads_rsa:    { label: 'Google Ads RSA',   color: 'from-amber-500 to-orange-600', icon: 'GA', api: 'google-ads-rsa' },
  kakao_channel:     { label: 'Kakao Channel',   color: 'from-yellow-400 to-yellow-600', icon: 'KK', api: 'kakao-channel' },
};

export default function DistributePage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = params.id;
  // V2 Studio 에서 넘어올 때 ?card_news_id=XXX 로 들어옴. 상품이 없거나 고아 참조일 때 이 카드뉴스로 fallback.
  const cardNewsIdFromQuery = searchParams?.get('card_news_id') ?? null;

  const [product, setProduct] = useState<Product | null>(null);
  const [linkedCardNews, setLinkedCardNews] = useState<LinkedCardNews | null>(null);
  const [productMissing, setProductMissing] = useState(false);
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null); // platform being generated
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      // 1. 상품 조회
      const prodRes = await fetch(`/api/packages/${id}`);
      let prodOk = false;
      if (prodRes.ok) {
        const d = await prodRes.json();
        const p = (d.package ?? d.product ?? d) as Product | Record<string, unknown> | null;
        if (p && (p as Product).id) {
          setProduct(p as Product);
          prodOk = true;
        }
      }
      if (!prodOk) setProductMissing(true);

      // 2. 연결된 카드뉴스 조회
      //    우선순위: URL ?card_news_id → product_id 로 가장 최근 CONFIRMED → 가장 최근 DRAFT
      let cardNews: LinkedCardNews | null = null;
      if (cardNewsIdFromQuery) {
        const r = await fetch(`/api/card-news/${cardNewsIdFromQuery}`);
        if (r.ok) {
          const d = await r.json();
          cardNews = d.card_news as LinkedCardNews;
        }
      }
      if (!cardNews) {
        // 상품 없어도 package_id 로 카드뉴스 먼저 찾아봄 (고아 참조 복구)
        const r = await fetch(`/api/card-news?package_id=${id}&status=CONFIRMED&limit=1`);
        if (r.ok) {
          const d = await r.json();
          cardNews = (d.card_news?.[0] ?? null) as LinkedCardNews | null;
        }
        if (!cardNews) {
          const r2 = await fetch(`/api/card-news?package_id=${id}&limit=1`);
          if (r2.ok) {
            const d2 = await r2.json();
            cardNews = (d2.card_news?.[0] ?? null) as LinkedCardNews | null;
          }
        }
      }
      setLinkedCardNews(cardNews);

      // 3. 배포 이력 조회
      const distRes = await fetch(`/api/content/generate-all?product_id=${id}`);
      if (distRes.ok) {
        const d = await distRes.json();
        setDistributions(d.distributions ?? []);
      }
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [id, cardNewsIdFromQuery]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const generateAll = useCallback(async () => {
    setGenerating('__all__');
    try {
      const res = await fetch('/api/content/generate-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: id,
          platforms: ['instagram_caption', 'threads_post', 'meta_ads', 'google_ads_rsa', 'kakao_channel', 'blog_body'],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '생성 실패');
      showToast(`전체 생성 완료: ${Object.keys(data.results ?? {}).length}종`);
      await fetchAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '생성 실패');
    } finally {
      setGenerating(null);
    }
  }, [id, fetchAll, showToast]);

  const generateOne = useCallback(async (platform: string) => {
    const meta = PLATFORM_META[platform];
    if (!meta || !meta.api) return;
    setGenerating(platform);
    try {
      const res = await fetch(`/api/content/${meta.api}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '생성 실패');
      showToast(`${meta.label} 생성 완료`);
      await fetchAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '생성 실패');
    } finally {
      setGenerating(null);
    }
  }, [id, fetchAll, showToast]);

  const copyText = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`${label} 클립보드 복사`);
  }, [showToast]);

  if (loading) return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="h-6 bg-slate-100 rounded animate-pulse w-48" />
      <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-5 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 bg-slate-50 rounded-lg animate-pulse" />
        ))}
      </div>
    </div>
  );

  // 상품도 카드뉴스도 없으면 완전 404
  if (!product && !linkedCardNews) {
    return (
      <div className="p-10 max-w-xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded p-5">
          <div className="font-bold text-red-900 mb-1">상품 + 연결된 카드뉴스 모두 찾을 수 없습니다</div>
          <div className="text-sm text-red-700 mb-3">
            상품 ID <code className="bg-red-100 px-1 rounded">{id}</code> 이 삭제되었거나 유효하지 않습니다.
            URL 에 <code className="bg-red-100 px-1 rounded">?card_news_id=XXX</code> 를 추가하거나 목록에서 다시 진입해 주세요.
          </div>
          <button
            type="button"
            onClick={() => router.push('/admin/marketing/card-news')}
            className="px-3 py-2 text-sm bg-white border border-red-300 rounded hover:bg-red-100 text-red-700"
          >
            카드뉴스 목록으로
          </button>
        </div>
      </div>
    );
  }

  // 표시용 제목/메타 — 상품 우선, 없으면 카드뉴스 기반
  const displayTitle = product?.title ?? linkedCardNews?.title ?? '(제목 없음)';
  const displaySubtitle = product
    ? `${product.destination ?? '-'}${product.price ? ` · ${product.price.toLocaleString()}원~` : ''}`
    : linkedCardNews
      ? `카드뉴스만 연결됨 (${linkedCardNews.status ?? 'DRAFT'}) · 상품 연결 끊김`
      : '';

  return (
    <div className="min-h-screen bg-slate-50 p-6 max-w-[1200px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-xs text-slate-400 mb-1">Content Distribution</div>
          <h1 className="text-2xl font-bold text-slate-900">{displayTitle}</h1>
          <div className="text-sm text-slate-500 mt-1">{displaySubtitle}</div>
          {productMissing && linkedCardNews && (
            <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">
              ⚠ 상품이 삭제되었거나 연결 끊김 — 카드뉴스 기반으로만 동작. 플랫폼 카피 생성은 제한될 수 있습니다.
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded"
        >
          ← 뒤로
        </button>
      </div>

      {/* 연결된 카드뉴스 배지 */}
      {linkedCardNews && (
        <div className="mb-6 bg-white border border-blue-200 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center text-xs font-bold">CN</div>
            <div>
              <div className="text-xs text-slate-500">연결된 카드뉴스</div>
              <div className="font-semibold text-slate-900 text-sm">{linkedCardNews.title}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                <span className={`mr-2 px-1.5 py-0.5 rounded font-mono ${
                  linkedCardNews.status === 'CONFIRMED' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                }`}>{linkedCardNews.status ?? 'DRAFT'}</span>
                {linkedCardNews.template_family && <span>family: {linkedCardNews.template_family}</span>}
                {Array.isArray(linkedCardNews.slide_image_urls) && linkedCardNews.slide_image_urls.length > 0 && (
                  <span className="ml-2">· 렌더 {linkedCardNews.slide_image_urls.length}장</span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push(`/admin/marketing/card-news/${linkedCardNews.id}/v2`)}
            className="px-3 py-2 text-sm text-blue-700 border border-blue-300 rounded hover:bg-blue-50"
          >
            V2 Studio 열기 →
          </button>
        </div>
      )}

      {/* 전체 생성 */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-5 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-bold text-slate-900">🚀 전체 생성 (IG 캡션 + Threads 포스트)</div>
            <div className="text-sm text-slate-500 mt-1">
              Brief 1회 생성 후 모든 플랫폼 병렬 생성. 약 10초.
            </div>
          </div>
          <button
            type="button"
            onClick={generateAll}
            disabled={!!generating}
            className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded font-semibold disabled:opacity-50"
          >
            {generating === '__all__' ? '생성 중…' : '전체 생성'}
          </button>
        </div>
      </div>

      {/* 플랫폼 카드들 - 6종 + 카드뉴스 스튜디오 링크 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
        {(['instagram_caption','threads_post','meta_ads','google_ads_rsa','kakao_channel','blog_body'] as const).map((p) => (
          <PlatformCard
            key={p}
            platform={p}
            dist={distributions.find((d) => d.platform === p)}
            generating={generating === p}
            disabled={!!generating}
            onGenerate={() => generateOne(p)}
            onCopy={copyText}
          />
        ))}

        {/* 카드뉴스 스튜디오 링크 */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-5 flex items-center justify-between col-span-full">
          <div>
            <div className="font-bold text-slate-900">카드뉴스 (별도 스튜디오)</div>
            <div className="text-sm text-slate-500 mt-1">Satori Atom 기반 family 4종 × 포맷 4종 렌더</div>
          </div>
          <button
            type="button"
            onClick={() => router.push(`/admin/marketing/card-news`)}
            className="px-4 py-2 text-sm text-blue-700 border border-blue-300 rounded hover:bg-blue-50"
          >
            카드뉴스 스튜디오 →
          </button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white px-4 py-2 rounded shadow-lg text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────
// 플랫폼 카드
// ──────────────────────────────────────────────────────
function PlatformCard({
  platform, dist, generating, disabled, onGenerate, onCopy,
}: {
  platform: string;
  dist?: Distribution;
  generating: boolean;
  disabled: boolean;
  onGenerate: () => void;
  onCopy: (text: string, label: string) => void;
}) {
  const meta = PLATFORM_META[platform];
  const payload = dist?.payload;

  const renderInstagramCaption = () => {
    if (!payload) return <div className="text-sm text-slate-400">생성 안 됨</div>;
    const caption = payload.caption as string;
    const hashtags = payload.hashtags as string[] | undefined;
    const firstComment = payload.first_comment as string | null | undefined;
    const ctaType = payload.cta_type as string | undefined;

    return (
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-slate-600">캡션</span>
            <button type="button" onClick={() => onCopy(caption, '캡션')} className="text-[11px] text-blue-600 hover:underline">복사</button>
          </div>
          <pre className="text-sm bg-slate-50 rounded p-3 whitespace-pre-wrap max-h-64 overflow-auto">{caption}</pre>
        </div>
        {hashtags && hashtags.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-600">해시태그 {hashtags.length}개</span>
              <button type="button" onClick={() => onCopy(hashtags.join(' '), '해시태그')} className="text-[11px] text-blue-600 hover:underline">복사</button>
            </div>
            <div className="text-xs bg-slate-50 rounded p-2 flex flex-wrap gap-1">
              {hashtags.map((h, i) => (<span key={i} className="text-blue-600">{h}</span>))}
            </div>
          </div>
        )}
        {firstComment && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-600">첫 댓글</span>
              <button type="button" onClick={() => onCopy(firstComment, '첫 댓글')} className="text-[11px] text-blue-600 hover:underline">복사</button>
            </div>
            <pre className="text-xs bg-slate-50 rounded p-2 whitespace-pre-wrap">{firstComment}</pre>
          </div>
        )}
        {ctaType && <div className="text-[11px] text-slate-500">CTA: <span className="font-mono">{ctaType}</span></div>}
      </div>
    );
  };

  const renderThreadsPost = () => {
    if (!payload) return <div className="text-sm text-slate-400">생성 안 됨</div>;
    const main = payload.main as string;
    const thread = (payload.thread as string[] | undefined) ?? [];
    const hashtags = (payload.hashtags as string[] | undefined) ?? [];
    const ctaType = payload.cta_type as string | undefined;
    const allText = [main, ...thread].join('\n\n---\n\n');
    return (
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-slate-600">Main</span>
            <button type="button" onClick={() => onCopy(main, 'Main')} className="text-[11px] text-blue-600 hover:underline">복사</button>
          </div>
          <pre className="text-sm bg-slate-50 rounded p-3 whitespace-pre-wrap">{main}</pre>
        </div>
        {thread.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-600">Thread {thread.length}개</span>
              <button type="button" onClick={() => onCopy(thread.join('\n\n'), 'Thread')} className="text-[11px] text-blue-600 hover:underline">전체 복사</button>
            </div>
            {thread.map((t, i) => (<pre key={i} className="text-xs bg-slate-50 rounded p-2 whitespace-pre-wrap mb-1">{t}</pre>))}
          </div>
        )}
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          {hashtags.length > 0 && <span>태그 {hashtags.length}개</span>}
          {ctaType && <span>CTA: <span className="font-mono">{ctaType}</span></span>}
          <button type="button" onClick={() => onCopy(allText, '전체')} className="ml-auto text-blue-600 hover:underline">전체 텍스트 복사</button>
        </div>
      </div>
    );
  };

  const renderMetaAds = () => {
    if (!payload) return <div className="text-sm text-slate-400">생성 안 됨</div>;
    const primary = (payload.primary_texts as string[]) ?? [];
    const headlines = (payload.headlines as string[]) ?? [];
    const descriptions = (payload.descriptions as string[]) ?? [];
    const cta = payload.cta_button as string;
    return (
      <div className="space-y-3">
        <Section label={`Primary Text (${primary.length})`} items={primary} onCopy={onCopy} />
        <Section label={`Headlines (${headlines.length})`} items={headlines} onCopy={onCopy} />
        <Section label={`Descriptions (${descriptions.length})`} items={descriptions} onCopy={onCopy} />
        <div className="text-[11px] text-slate-500">CTA: <span className="font-mono">{cta}</span></div>
      </div>
    );
  };

  const renderGoogleAdsRSA = () => {
    if (!payload) return <div className="text-sm text-slate-400">생성 안 됨</div>;
    const headlines = (payload.headlines as string[]) ?? [];
    const descriptions = (payload.descriptions as string[]) ?? [];
    const paths = (payload.paths as string[]) ?? [];
    return (
      <div className="space-y-3">
        <Section label={`Headlines (${headlines.length})`} items={headlines} onCopy={onCopy} />
        <Section label={`Descriptions (${descriptions.length})`} items={descriptions} onCopy={onCopy} />
        <div className="text-[11px] text-slate-500">
          paths: /{paths[0] ?? ''} /{paths[1] ?? ''}
        </div>
      </div>
    );
  };

  const renderKakaoChannel = () => {
    if (!payload) return <div className="text-sm text-slate-400">생성 안 됨</div>;
    const msg = payload.message_text as string;
    const buttons = (payload.buttons as Array<{ label: string; action: string; url?: string | null }>) ?? [];
    return (
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-slate-600">메시지</span>
            <button type="button" onClick={() => onCopy(msg, '메시지')} className="text-[11px] text-blue-600 hover:underline">복사</button>
          </div>
          <pre className="text-sm bg-slate-50 rounded p-3 whitespace-pre-wrap">{msg}</pre>
        </div>
        <div className="flex flex-wrap gap-2">
          {buttons.map((b, i) => (
            <span key={i} className="px-2 py-1 text-xs bg-yellow-100 border border-yellow-300 rounded">
              {b.label} <span className="text-slate-500">· {b.action}</span>
            </span>
          ))}
        </div>
      </div>
    );
  };

  const renderBlogBody = () => {
    if (!payload) return <div className="text-sm text-slate-400">생성 안 됨</div>;
    const markdown = payload.markdown as string;
    const wordCount = payload.word_count as number;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">{wordCount}단어 · 마크다운</span>
          <button type="button" onClick={() => onCopy(markdown, '블로그 본문')} className="text-[11px] text-blue-600 hover:underline">전체 복사</button>
        </div>
        <pre className="text-xs bg-slate-50 rounded p-3 whitespace-pre-wrap max-h-64 overflow-auto">{markdown.slice(0, 2000)}{markdown.length > 2000 ? '\n\n...(요약)' : ''}</pre>
      </div>
    );
  };

  const renderers: Record<string, () => JSX.Element> = {
    instagram_caption: renderInstagramCaption,
    threads_post:      renderThreadsPost,
    meta_ads:          renderMetaAds,
    google_ads_rsa:    renderGoogleAdsRSA,
    kakao_channel:     renderKakaoChannel,
    blog_body:         renderBlogBody,
  };
  const renderFn = renderers[platform] ?? (() => <div className="text-sm text-slate-400">지원 예정</div>);

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded bg-gradient-to-br ${meta.color} text-white flex items-center justify-center text-xs font-bold`}>
            {meta.icon}
          </div>
          <span className="font-bold text-slate-900">{meta.label}</span>
          {dist && (
            <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">
              {new Date(dist.updated_at).toLocaleDateString()}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={disabled}
          className="px-3 py-1.5 text-xs bg-slate-900 text-white rounded disabled:opacity-50"
        >
          {generating ? '생성 중…' : dist ? '재생성' : '생성'}
        </button>
      </div>
      {renderFn()}
    </div>
  );
}

function Section({ label, items, onCopy }: { label: string; items: string[]; onCopy: (t: string, l: string) => void }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-slate-600">{label}</span>
        <button type="button" onClick={() => onCopy(items.join('\n'), label)} className="text-[11px] text-blue-600 hover:underline">전체 복사</button>
      </div>
      <div className="flex flex-col gap-1">
        {items.map((it, i) => (
          <div key={i} className="flex items-center justify-between text-xs bg-slate-50 rounded p-2">
            <span className="flex-1 pr-2">{it}</span>
            <button type="button" onClick={() => onCopy(it, label + i)} className="text-slate-400 hover:text-blue-600">복사</button>
          </div>
        ))}
      </div>
    </div>
  );
}
