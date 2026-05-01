'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import InstagramPublishModal from '@/components/admin/InstagramPublishModal';

// ── 타입 ─────────────────────────────────────────────────────────────────────
interface Render { format: string; url: string; slide_index: number }
interface CardNewsData {
  id: string; title: string; status: string;
  slide_count: number; renders: Render[];
  ig_publish_status: string | null; ig_scheduled_for: string | null;
  linked_blog_id: string | null; package_id: string | null;
  template_family: string | null;
}
interface BlogData { id: string; title: string | null; status: string | null; url: string | null }
interface DistData { id: string; platform: string; status: string; scheduled_for: string | null }
interface FactoryStatus {
  job: { status: string; completed_steps: number; total_steps: number; steps: Record<string, { status: string }> } | null;
  card_news: CardNewsData;
  blog: BlogData | null;
  ig: { status: string; post_id: string | null; scheduled_for: string | null };
  meta_ads: DistData[];
  distributions: DistData[];
  tenant_channels: { ig_account: { display_name: string } | null; brand_kit: { code: string; name: string } | null };
}

type Tab = 'card_news' | 'instagram' | 'blog' | 'meta_ads';

const STATUS_BADGE: Record<string, string> = {
  pending:    'bg-gray-100 text-gray-600',
  running:    'bg-blue-100 text-blue-700',
  partial:    'bg-yellow-100 text-yellow-700',
  done:       'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-700',
  scheduled:  'bg-purple-100 text-purple-700',
  published:  'bg-green-100 text-green-700',
  DRAFT:      'bg-gray-100 text-gray-500',
  PUBLISHED:  'bg-green-100 text-green-700',
  idle:       'bg-gray-100 text-gray-400',
  queued:     'bg-yellow-100 text-yellow-700',
  publishing: 'bg-blue-100 text-blue-700',
};

// ── 컴포넌트 ──────────────────────────────────────────────────────────────────
export default function ContentHubPage() {
  const { cardNewsId } = useParams<{ cardNewsId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isNew = searchParams.get('source') === 'new';

  const [data, setData] = useState<FactoryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('card_news');
  const [showIgModal, setShowIgModal] = useState(false);
  const [generatingBlog, setGeneratingBlog] = useState(false);
  const [startingFactory, setStartingFactory] = useState(false);
  const [metaForm, setMetaForm] = useState({
    campaign_name: '', daily_budget_krw: 10000, primary_text: '', headline: '',
    description: '', cta_button: 'LEARN_MORE',
  });
  const [publishingMeta, setPublishingMeta] = useState(false);
  const [metaPublishMsg, setMetaPublishMsg] = useState('');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    const res = await fetch(`/api/content-factory/${cardNewsId}`);
    if (!res.ok) return;
    const json: FactoryStatus = await res.json();
    setData(json);
    setLoading(false);

    // job이 done/failed이거나 없으면 폴링 중단
    const jobDone = !json.job || ['done', 'failed'].includes(json.job.status);
    if (jobDone && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, [cardNewsId]);

  useEffect(() => {
    fetchStatus();
    pollingRef.current = setInterval(fetchStatus, 4000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [fetchStatus]);

  const handleStartFactory = async () => {
    setStartingFactory(true);
    await fetch(`/api/content-factory/${cardNewsId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start' }),
    });
    setStartingFactory(false);
    fetchStatus();
  };

  const handlePublishMeta = async () => {
    setPublishingMeta(true);
    setMetaPublishMsg('');
    try {
      const res = await fetch(`/api/content-factory/${cardNewsId}/publish-meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metaForm),
      });
      const result = await res.json();
      if (res.ok && result.ok) {
        setMetaPublishMsg(result.test_mode ? '✅ 테스트 모드: 드래프트 생성됨' : '✅ 발행 완료');
        fetchStatus();
      } else {
        setMetaPublishMsg(`❌ ${result.error ?? '발행 실패'}`);
      }
    } finally {
      setPublishingMeta(false);
    }
  };

  const handleGenerateBlog = async () => {
    if (!data?.card_news.id) return;
    setGeneratingBlog(true);
    try {
      const slideUrls = data.card_news.renders
        .filter(r => r.format === '1x1')
        .sort((a, b) => a.slide_index - b.slide_index)
        .map(r => r.url);
      await fetch('/api/blog/from-card-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_news_id: data.card_news.id, slide_image_urls: slideUrls }),
      });
      fetchStatus();
    } finally {
      setGeneratingBlog(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-500">{isNew ? '콘텐츠 생성 중...' : '로딩 중'}</p>
      </div>
    </div>
  );

  if (!data) return <div className="p-8 text-red-500">카드뉴스를 찾을 수 없습니다.</div>;

  const { job, card_news: cn, blog, ig, meta_ads, distributions, tenant_channels } = data;
  const coverRender = cn.renders.find(r => r.format === '1x1' && r.slide_index === 0);
  const allRenders1x1 = cn.renders.filter(r => r.format === '1x1').sort((a, b) => a.slide_index - b.slide_index);
  const jobProgress = job ? Math.round((job.completed_steps / job.total_steps) * 100) : null;

  const tabs: { key: Tab; label: string; badge?: string }[] = [
    { key: 'card_news', label: '카드뉴스' },
    { key: 'instagram', label: '인스타그램', badge: ig.status !== 'idle' ? ig.status : undefined },
    { key: 'blog', label: '블로그', badge: blog ? blog.status ?? undefined : undefined },
    { key: 'meta_ads', label: '메타광고', badge: meta_ads.length > 0 ? `${meta_ads.length}건` : undefined },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 text-sm">← 뒤로</button>
          <div>
            <h1 className="font-semibold text-gray-900 truncate max-w-md">{cn.title}</h1>
            <p className="text-xs text-gray-400 mt-0.5">콘텐츠 허브</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tenant_channels.brand_kit && (
            <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full border border-purple-200">
              {tenant_channels.brand_kit.name}
            </span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[cn.status] ?? 'bg-gray-100 text-gray-500'}`}>
            {cn.status}
          </span>
        </div>
      </div>

      {/* 진행 바 */}
      {job && (
        <div className="bg-white border-b px-6 py-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-gray-500">파이프라인 진행 ({job.completed_steps}/{job.total_steps})</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[job.status] ?? ''}`}>{job.status}</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div className="bg-purple-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${jobProgress ?? 0}%` }} />
          </div>
          <div className="flex gap-4 mt-2">
            {Object.entries(job.steps).map(([key, step]) => (
              <div key={key} className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${step.status === 'done' ? 'bg-green-400' : step.status === 'failed' ? 'bg-red-400' : step.status === 'running' ? 'bg-blue-400 animate-pulse' : 'bg-gray-300'}`} />
                <span className="text-[10px] text-gray-400">{key.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 메인 레이아웃 */}
      <div className="flex h-[calc(100vh-120px)]">
        {/* 좌측: 슬라이드 그리드 */}
        <div className="w-64 bg-white border-r p-3 overflow-y-auto flex-shrink-0">
          <p className="text-xs font-medium text-gray-500 mb-2">슬라이드 ({cn.slide_count}장)</p>
          {allRenders1x1.length > 0 ? (
            <div className="grid grid-cols-2 gap-1.5">
              {allRenders1x1.map(r => (
                <div key={r.slide_index} className="relative group">
                  <img src={r.url} alt={`슬라이드 ${r.slide_index + 1}`}
                    className="w-full aspect-square object-cover rounded border border-gray-100" />
                  <span className="absolute bottom-0.5 right-0.5 bg-black/50 text-white text-[9px] px-1 rounded">
                    {r.slide_index + 1}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-300">
              <p className="text-xs">렌더링 중...</p>
              <div className="w-5 h-5 border-2 border-purple-300 border-t-transparent rounded-full animate-spin mx-auto mt-2" />
            </div>
          )}

          {/* 전체 채널 생성 버튼 */}
          {cn.package_id && (
            <button
              onClick={handleStartFactory}
              disabled={startingFactory || job?.status === 'running'}
              className="w-full mt-4 py-2 px-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-200 text-white text-xs font-medium rounded-lg transition"
            >
              {startingFactory || job?.status === 'running' ? '생성 중...' : '⚡ 전 채널 생성'}
            </button>
          )}
        </div>

        {/* 우측: 탭 패널 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 탭 */}
          <div className="bg-white border-b flex gap-0">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition flex items-center gap-1.5 ${activeTab === t.key ? 'border-purple-600 text-purple-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                {t.label}
                {t.badge && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_BADGE[t.badge] ?? 'bg-gray-100 text-gray-500'}`}>
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* 탭 내용 */}
          <div className="flex-1 overflow-y-auto p-6">

            {/* ── 카드뉴스 탭 ── */}
            {activeTab === 'card_news' && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-medium text-gray-900">카드뉴스</h2>
                  <div className="flex gap-2">
                    <a
                      href={`/admin/marketing/card-news/${cn.id}/v2`}
                      className="text-xs px-3 py-1.5 border rounded-lg text-gray-600 hover:bg-gray-50"
                    >
                      V2 Studio →
                    </a>
                    <a
                      href={`/admin/marketing/card-news/${cn.id}`}
                      className="text-xs px-3 py-1.5 border rounded-lg text-gray-600 hover:bg-gray-50"
                    >
                      편집 →
                    </a>
                  </div>
                </div>

                {coverRender ? (
                  <img src={coverRender.url} alt="커버"
                    className="rounded-xl border max-w-xs shadow-sm" />
                ) : (
                  <div className="w-48 h-48 bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 text-sm animate-pulse">
                    렌더링 중
                  </div>
                )}

                <div className="grid grid-cols-3 gap-3 text-sm text-gray-600">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-1">슬라이드</p>
                    <p className="font-semibold">{cn.slide_count}장</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-1">렌더 수</p>
                    <p className="font-semibold">{cn.renders.length}개</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-1">템플릿</p>
                    <p className="font-semibold">{cn.template_family ?? '-'}</p>
                  </div>
                </div>

                {/* 비율별 포맷 다운로드 */}
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">포맷별 렌더</p>
                  {(['1x1', '4x5', '9x16', 'blog'] as const).map(fmt => {
                    const fmtRenders = cn.renders.filter(r => r.format === fmt);
                    return (
                      <div key={fmt} className="flex items-center justify-between py-2 border-b last:border-0">
                        <span className="text-sm text-gray-700">{fmt}</span>
                        {fmtRenders.length > 0 ? (
                          <span className="text-xs text-green-600 font-medium">{fmtRenders.length}장 완료</span>
                        ) : (
                          <span className="text-xs text-gray-400">미생성</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── 인스타그램 탭 ── */}
            {activeTab === 'instagram' && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-medium text-gray-900">인스타그램</h2>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_BADGE[ig.status] ?? 'bg-gray-100'}`}>
                    {ig.status}
                  </span>
                </div>

                {tenant_channels.ig_account ? (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-blue-700">
                    연결 계정: @{tenant_channels.ig_account.display_name}
                  </div>
                ) : (
                  <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-3 text-sm text-yellow-700">
                    인스타그램 계정 미설정 — 환경변수로 단일 계정 사용 중
                  </div>
                )}

                {ig.scheduled_for && (
                  <div className="text-sm text-gray-600">
                    예약 발행: <span className="font-medium">{new Date(ig.scheduled_for).toLocaleString('ko-KR')}</span>
                  </div>
                )}
                {ig.post_id && (
                  <div className="text-sm text-gray-600">
                    게시물 ID: <span className="font-mono text-xs">{ig.post_id}</span>
                  </div>
                )}

                {ig.status === 'idle' || ig.status === 'failed' ? (
                  <button
                    onClick={() => setShowIgModal(true)}
                    disabled={allRenders1x1.length < 2}
                    className="px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-600 text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-40 transition"
                  >
                    {allRenders1x1.length < 2 ? `인스타 발행 (렌더 ${allRenders1x1.length}/2장 필요)` : '📷 인스타그램 발행'}
                  </button>
                ) : ig.status === 'published' ? (
                  <div className="text-green-600 font-medium text-sm">✅ 발행 완료</div>
                ) : (
                  <div className="text-blue-600 text-sm animate-pulse">처리 중...</div>
                )}
              </div>
            )}

            {/* ── 블로그 탭 ── */}
            {activeTab === 'blog' && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-medium text-gray-900">블로그</h2>
                  {blog && (
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_BADGE[blog.status ?? ''] ?? 'bg-gray-100'}`}>
                      {blog.status}
                    </span>
                  )}
                </div>

                {blog ? (
                  <div className="space-y-3">
                    <div className="bg-green-50 border border-green-100 rounded-lg p-4">
                      <p className="font-medium text-gray-900 text-sm">{blog.title}</p>
                      {blog.url && (
                        <a href={blog.url} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline mt-1 block">{blog.url}</a>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <a
                        href={`/admin/blog/${blog.id}`}
                        className="text-sm px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                      >
                        블로그 편집 →
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-500">블로그 초안이 없습니다. 카드뉴스 PNG 렌더가 완료되면 블로그를 자동 생성할 수 있습니다.</p>
                    <button
                      onClick={handleGenerateBlog}
                      disabled={generatingBlog || allRenders1x1.length === 0}
                      className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition"
                    >
                      {generatingBlog ? '블로그 생성 중...' : allRenders1x1.length === 0 ? '렌더 완료 후 생성 가능' : '✍️ 블로그 초안 생성'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── 메타광고 탭 ── */}
            {activeTab === 'meta_ads' && (
              <div className="space-y-5">
                <h2 className="font-medium text-gray-900">메타 광고 직접 발행</h2>

                {/* 발행 폼 */}
                <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-semibold text-gray-500 uppercase block mb-1">캠페인명 (선택)</label>
                      <input
                        value={metaForm.campaign_name}
                        onChange={e => setMetaForm(f => ({ ...f, campaign_name: e.target.value }))}
                        placeholder={cn.title ?? '자동 생성'}
                        className="w-full border border-gray-200 rounded px-3 py-2 text-sm bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-gray-500 uppercase block mb-1">일예산 (KRW)</label>
                      <input
                        type="number" min={1000} step={1000}
                        value={metaForm.daily_budget_krw}
                        onChange={e => setMetaForm(f => ({ ...f, daily_budget_krw: parseInt(e.target.value) || 10000 }))}
                        className="w-full border border-gray-200 rounded px-3 py-2 text-sm bg-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-gray-500 uppercase block mb-1">광고 문구 (Primary Text)</label>
                    <textarea
                      value={metaForm.primary_text}
                      onChange={e => setMetaForm(f => ({ ...f, primary_text: e.target.value }))}
                      placeholder={cn.title ?? '광고 본문을 입력하세요...'}
                      rows={3}
                      className="w-full border border-gray-200 rounded px-3 py-2 text-sm bg-white resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-semibold text-gray-500 uppercase block mb-1">헤드라인</label>
                      <input
                        value={metaForm.headline}
                        onChange={e => setMetaForm(f => ({ ...f, headline: e.target.value }))}
                        placeholder={cn.title ?? '헤드라인'}
                        className="w-full border border-gray-200 rounded px-3 py-2 text-sm bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-gray-500 uppercase block mb-1">CTA 버튼</label>
                      <select
                        value={metaForm.cta_button}
                        onChange={e => setMetaForm(f => ({ ...f, cta_button: e.target.value }))}
                        className="w-full border border-gray-200 rounded px-3 py-2 text-sm bg-white"
                      >
                        <option value="LEARN_MORE">자세히 알아보기</option>
                        <option value="BOOK_TRAVEL">여행 예약하기</option>
                        <option value="SHOP_NOW">지금 보기</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-1">
                    {metaPublishMsg && (
                      <span className={`text-xs ${metaPublishMsg.startsWith('✅') ? 'text-green-600' : 'text-red-500'}`}>
                        {metaPublishMsg}
                      </span>
                    )}
                    <button
                      onClick={handlePublishMeta}
                      disabled={publishingMeta || allRenders1x1.length === 0}
                      className="ml-auto px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition"
                    >
                      {publishingMeta ? '발행 중...' : allRenders1x1.length === 0 ? '렌더 완료 후 발행 가능' : '📣 Meta 광고 발행'}
                    </button>
                  </div>
                </div>

                {/* 기존 발행 내역 */}
                {meta_ads.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">발행 내역</p>
                    <div className="space-y-2">
                      {meta_ads.map(d => (
                        <div key={d.id} className="bg-white border rounded-lg p-4 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-800">{d.platform}</p>
                            {d.scheduled_for && (
                              <p className="text-xs text-gray-400 mt-0.5">
                                예약: {new Date(d.scheduled_for).toLocaleString('ko-KR')}
                              </p>
                            )}
                          </div>
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_BADGE[d.status] ?? 'bg-gray-100'}`}>
                            {d.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 전체 채널 발행 현황 */}
                {distributions.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">전체 채널 현황</p>
                    <div className="space-y-1">
                      {distributions.map(d => (
                        <div key={d.id} className="flex items-center justify-between text-xs py-1.5 border-b last:border-0">
                          <span className="text-gray-600">{d.platform}</span>
                          <span className={`px-1.5 py-0.5 rounded font-medium ${STATUS_BADGE[d.status] ?? 'bg-gray-100'}`}>
                            {d.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 인스타그램 발행 모달 */}
      {showIgModal && (
        <InstagramPublishModal
          cardNewsId={cn.id}
          defaultCaption={cn.title}
          slideImageUrls={allRenders1x1.map(r => r.url)}
          onClose={() => setShowIgModal(false)}
          onSuccess={() => { setShowIgModal(false); fetchStatus(); }}
        />
      )}
    </div>
  );
}
