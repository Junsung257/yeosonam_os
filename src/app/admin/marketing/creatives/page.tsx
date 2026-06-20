'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { fmtDateISO } from '@/lib/admin-utils';

// ── 타입 ───────────────────────────────────────────────────

interface Creative {
  id: string;
  product_id: string;
  creative_type: 'carousel' | 'single_image' | 'text_ad' | 'short_video';
  channel: 'meta' | 'naver' | 'google';
  variant_index: number;
  hook_type: string | null;
  tone: string | null;
  key_selling_point: string | null;
  target_segment: string | null;
  slides: any[] | null;
  headline: string | null;
  primary_text: string | null;
  description: string | null;
  body: string | null;
  image_url: string | null;
  keywords: string[] | null;
  ad_copies: any[] | null;
  status: string;
  created_at: string;
  launched_at: string | null;
  travel_packages: { id: string; title: string; destination: string };
}

interface Package { id: string; title: string; destination: string; }

// ── 상수 ───────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  carousel: '캐러셀', single_image: '단일이미지', text_ad: '텍스트광고', short_video: '숏폼',
};
const CHANNEL_LABELS: Record<string, string> = {
  meta: 'Meta', naver: '네이버', google: '구글',
};
const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: '초안', color: 'bg-admin-surface-2 text-admin-muted' },
  review: { label: '검토중', color: 'bg-yellow-100 text-yellow-700' },
  active: { label: '활성', color: 'bg-green-100 text-green-700' },
  paused: { label: '일시정지', color: 'bg-orange-100 text-orange-700' },
  ended: { label: '종료', color: 'bg-red-100 text-red-600' },
};
const HOOK_COLORS: Record<string, string> = {
  urgency: 'bg-red-50 text-red-600', benefit: 'bg-blue-50 text-blue-600',
  scene: 'bg-purple-50 text-purple-600', question: 'bg-amber-50 text-amber-600',
  price: 'bg-green-50 text-green-600', price_hero: 'bg-green-50 text-green-600',
  scene_mood: 'bg-purple-50 text-purple-600', benefit_list: 'bg-blue-50 text-blue-600',
  destination: 'bg-teal-50 text-teal-600', feature: 'bg-indigo-50 text-indigo-600',
  departure: 'bg-sky-50 text-sky-600',
};

// ── 메인 페이지 ────────────────────────────────────────────

export default function CreativesPage() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [integrationBlocked, setIntegrationBlocked] = useState(false);

  // 필터
  const [filterType, setFilterType] = useState<string>('all');
  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterProduct, setFilterProduct] = useState('');

  // 생성 설정
  const [selectedPkg, setSelectedPkg] = useState('');
  const [channels, setChannels] = useState<string[]>(['meta']);
  const [carouselCount, setCarouselCount] = useState(3);
  const [singleCount, setSingleCount] = useState(3);
  const [showGenerator, setShowGenerator] = useState(false);

  // 성과 확장
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [perfData, setPerfData] = useState<any>(null);
  const [endTarget, setEndTarget] = useState<Creative | null>(null);
  const endConfirmDialogRef = useRef<HTMLDivElement | null>(null);
  const endConfirmCancelRef = useRef<HTMLButtonElement | null>(null);
  const endConfirmTitleId = 'creative-end-confirm-title';
  const endConfirmDescriptionId = 'creative-end-confirm-description';

  // 상품 목록 로드
  useEffect(() => {
    fetch('/api/packages?limit=200')
      .then(r => r.json())
      .then(d => {
        const all = d.data ?? d.packages ?? [];
        setPackages(all.filter((p: { status: string }) =>
          ['approved', 'active', 'pending', 'pending_review', 'draft'].includes(p.status)
        ));
      })
      .catch(() => {
        setIntegrationBlocked(true);
        setWarning(prev => prev || '상품 목록을 불러오지 못했습니다.');
      });
  }, []);

  // 소재 목록 로드
  const fetchCreatives = useCallback(async () => {
    setLoading(true);
    setIntegrationBlocked(false);
    const params = new URLSearchParams();
    if (filterType !== 'all') params.set('creative_type', filterType);
    if (filterChannel !== 'all') params.set('channel', filterChannel);
    if (filterStatus !== 'all') params.set('status', filterStatus);
    if (filterProduct) params.set('product_id', filterProduct);
    params.set('limit', '100');

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(`/api/campaigns/creatives?${params}`, { signal: controller.signal });
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        setCreatives([]);
        setIntegrationBlocked(true);
        setWarning('소재 API가 정상 응답을 반환하지 않았습니다. 관리자 세션 또는 연동 설정을 확인하세요.');
        return;
      }
      const data = await res.json().catch(() => ({}));
      setCreatives(data.creatives ?? []);
      if (!res.ok) {
        setIntegrationBlocked(true);
        setWarning(data.error ?? '소재 목록을 불러오지 못했습니다.');
        return;
      }
      if (data.degraded || data.access_state === 'supabase_unconfigured') {
        setIntegrationBlocked(true);
        setWarning(data.message ?? 'Supabase 연동이 설정되지 않아 실시간 소재 데이터를 불러올 수 없습니다.');
      } else {
        setWarning('');
      }
    } catch {
      setCreatives([]);
      setIntegrationBlocked(true);
      setWarning('소재 목록을 불러오지 못했습니다.');
    }
    finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }, [filterType, filterChannel, filterStatus, filterProduct]);

  useEffect(() => { fetchCreatives(); }, [fetchCreatives]);

  useEffect(() => {
    if (!endTarget) return undefined;

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    endConfirmCancelRef.current?.focus();

    const getFocusableElements = () => Array.from(
      endConfirmDialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter(element => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setEndTarget(null);
        return;
      }

      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActiveElement?.focus();
    };
  }, [endTarget]);

  // 소재 생성
  const handleGenerate = async () => {
    if (!selectedPkg) { setError('상품을 선택하세요'); return; }
    setError('');
    if (integrationBlocked) {
      setError('연동 상태를 먼저 확인한 뒤 소재를 생성하세요.');
      return;
    }
    setGenerating(true);
    try {
      const textAdChannels = channels.filter(c => c === 'naver' || c === 'google');
      const res = await fetch('/api/campaigns/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selectedPkg,
          channels: channels.includes('meta') ? ['meta'] : [],
          carouselCount: channels.includes('meta') ? carouselCount : 0,
          singleImageCount: channels.includes('meta') ? singleCount : 0,
          textAdChannels,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? '생성 실패'); return; }
      setShowGenerator(false);
      setFilterProduct(selectedPkg);
      fetchCreatives();
    } finally { setGenerating(false); }
  };

  // 상태 변경
  const handleStatusChange = async (id: string, newStatus: string) => {
    // 배포는 launch API 사용
    if (newStatus === 'launch') {
      try {
        const res = await fetch('/api/campaigns/launch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creative_ids: [id], budgets: { meta_daily: 10000 } }),
        });
        const data = await res.json();
        if (res.ok) fetchCreatives();
        else alert(`배포 실패: ${data.error || '알 수 없는 오류'}`);
      } catch { alert('배포 요청 실패'); }
      return;
    }

    try {
      await fetch('/api/campaigns/creatives', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus }),
      });
      if (newStatus === 'ended') setEndTarget(null);
      fetchCreatives();
    } catch { /* ignore */ }
  };

  // 성과 로드
  const loadPerformance = async (creativeId: string) => {
    if (expandedId === creativeId) { setExpandedId(null); return; }
    setExpandedId(creativeId);
    try {
      const res = await fetch(`/api/campaigns/performance?creative_id=${creativeId}`);
      const data = await res.json();
      setPerfData(data);
    } catch { setPerfData(null); }
  };

  const toggleChannel = (ch: string) => {
    setChannels(prev => prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]);
  };

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-admin-text">광고 소재 공장</h1>
          <p className="text-xs text-admin-muted mt-0.5">상품 → 캐러셀 + 단일이미지 + 텍스트광고 자동 생성</p>
        </div>
        <button onClick={() => setShowGenerator(!showGenerator)}
          disabled={integrationBlocked}
          title={integrationBlocked ? '연동 상태를 먼저 확인하세요' : undefined}
          className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 transition">
          + 소재 생성
        </button>
      </div>

      {/* 생성 패널 */}
      {warning && (
        <div className="rounded-admin-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {warning}
        </div>
      )}

      {showGenerator && (
        <div className="bg-white rounded-admin-md border border-admin-border-mid p-5 space-y-4">
          <h2 className="text-sm font-semibold text-admin-text-2">소재 생성 설정</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="creative-package" className="text-xs font-medium text-admin-muted block mb-1">상품 선택 *</label>
              <select id="creative-package" value={selectedPkg} onChange={e => setSelectedPkg(e.target.value)}
                className="w-full border border-admin-border-mid rounded-lg px-3 py-2 text-sm">
                <option value="">상품 선택...</option>
                {packages.map(p => <option key={p.id} value={p.id}>{p.title} ({p.destination})</option>)}
              </select>
            </div>
            <div>
              <div className="text-xs font-medium text-admin-muted block mb-1">채널</div>
              <div className="flex gap-2">
                {['meta', 'naver', 'google'].map(ch => (
                  <button key={ch} type="button" aria-pressed={channels.includes(ch)} onClick={() => toggleChannel(ch)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition ${channels.includes(ch) ? 'bg-violet-50 border-violet-300 text-violet-700' : 'border-admin-border-mid text-admin-muted'}`}>
                    {CHANNEL_LABELS[ch]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {channels.includes('meta') && (
            <div className="flex gap-6">
              <div>
                <div className="text-xs text-admin-muted">캐러셀 변형 수</div>
                <div className="flex items-center gap-2 mt-1">
                  {[1,2,3].map(n => (
                    <button key={n} type="button" aria-label={`캐러셀 변형 ${n}개`} aria-pressed={carouselCount === n} onClick={() => setCarouselCount(n)}
                      className={`w-8 h-8 rounded-lg text-xs font-medium transition ${carouselCount === n ? 'bg-violet-600 text-white' : 'bg-admin-surface-2 text-admin-muted'}`}>{n}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-admin-muted">단일이미지 변형 수</div>
                <div className="flex items-center gap-2 mt-1">
                  {[1,2,3].map(n => (
                    <button key={n} type="button" aria-label={`단일이미지 변형 ${n}개`} aria-pressed={singleCount === n} onClick={() => setSingleCount(n)}
                      className={`w-8 h-8 rounded-lg text-xs font-medium transition ${singleCount === n ? 'bg-violet-600 text-white' : 'bg-admin-surface-2 text-admin-muted'}`}>{n}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {error && <p className="text-xs text-red-500 bg-red-50 p-2 rounded-lg">{error}</p>}
          <button onClick={handleGenerate} disabled={generating || !selectedPkg || integrationBlocked}
            title={integrationBlocked ? '연동 상태를 먼저 확인하세요' : undefined}
            className="px-5 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition">
            {generating ? '생성 중 (최대 60초)...' : '소재 생성'}
          </button>
        </div>
      )}

      {/* 필터 바 */}
      <div className="bg-white rounded-admin-md border border-admin-border-mid p-3 flex flex-wrap items-center gap-3">
        <div className="flex border border-admin-border-mid rounded-lg overflow-hidden">
          {['all', 'carousel', 'single_image', 'text_ad'].map(t => (
            <button key={t} onClick={() => setFilterType(t)}
              className={`px-3 py-1.5 text-xs transition ${filterType === t ? 'bg-slate-900 text-white' : 'text-admin-muted hover:bg-admin-bg'}`}>
              {t === 'all' ? '전체' : TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <select value={filterChannel} onChange={e => setFilterChannel(e.target.value)}
          className="border border-admin-border-mid rounded-lg px-2 py-1.5 text-xs">
          <option value="all">전체 채널</option>
          {Object.entries(CHANNEL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-admin-border-mid rounded-lg px-2 py-1.5 text-xs">
          <option value="all">전체 상태</option>
          {Object.entries(STATUS_CONFIG).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
        </select>
        <select value={filterProduct} onChange={e => setFilterProduct(e.target.value)}
          className="border border-admin-border-mid rounded-lg px-2 py-1.5 text-xs min-w-[160px]">
          <option value="">전체 상품</option>
          {packages.map(p => <option key={p.id} value={p.id}>{p.title.slice(0, 25)}</option>)}
        </select>
        <span className="text-xs text-admin-muted-2 ml-auto">{creatives.length}건</span>
      </div>

      {/* 소재 목록 */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
              <div className="aspect-square bg-admin-surface-2 animate-pulse" />
              <div className="p-2 space-y-1.5">
                <div className="h-3 bg-admin-surface-2 rounded animate-pulse w-3/4" />
                <div className="h-3 bg-admin-surface-2 rounded animate-pulse w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : creatives.length === 0 ? (
        <div className="text-center py-16 text-admin-muted-2">
          <p className="text-lg mb-2">
            {integrationBlocked ? '소재 연동을 확인하세요' : '소재가 없습니다'}
          </p>
          <p className="text-xs">
            {integrationBlocked
              ? '연동 상태를 확인한 뒤 소재 목록을 다시 불러오세요'
              : '상단의 "소재 생성" 버튼을 눌러 시작하세요'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {creatives.map(c => (
            <div key={c.id} className="bg-white rounded-admin-md border border-admin-border-mid overflow-hidden">
              {/* 소재 카드 */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  {/* 좌측: 메타 정보 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_CONFIG[c.status]?.color ?? 'bg-admin-surface-2 text-admin-muted'}`}>
                        {STATUS_CONFIG[c.status]?.label ?? c.status}
                      </span>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-admin-surface-2 text-admin-muted">
                        {CHANNEL_LABELS[c.channel]} · {TYPE_LABELS[c.creative_type]}
                      </span>
                      {c.hook_type && (
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${HOOK_COLORS[c.hook_type] ?? 'bg-admin-bg text-admin-muted'}`}>
                          {c.hook_type}
                        </span>
                      )}
                      <span className="text-[10px] text-admin-muted-2">v{c.variant_index}</span>
                      <span className="text-[10px] text-admin-muted-2">{fmtDateISO(c.created_at)}</span>
                    </div>
                    <p className="text-xs text-admin-muted truncate mb-2">{c.travel_packages?.title}</p>

                    {/* 타입별 미리보기 */}
                    {c.creative_type === 'carousel' && c.slides && <CarouselPreview slides={c.slides} />}
                    {c.creative_type === 'single_image' && <SingleImagePreview creative={c} />}
                    {c.creative_type === 'text_ad' && <TextAdPreview creative={c} />}
                  </div>

                  {/* 우측: 액션 버튼 */}
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {c.status === 'draft' && (
                      <button onClick={() => handleStatusChange(c.id, 'review')}
                        className="text-[10px] px-3 py-1.5 bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-lg hover:bg-yellow-100">검토완료</button>
                    )}
                    {c.status === 'review' && (
                      <button onClick={() => handleStatusChange(c.id, 'launch')}
                        className="text-[10px] px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100">배포</button>
                    )}
                    {c.status === 'active' && (
                      <button onClick={() => handleStatusChange(c.id, 'paused')}
                        className="text-[10px] px-3 py-1.5 bg-orange-50 text-orange-700 border border-orange-200 rounded-lg hover:bg-orange-100">일시정지</button>
                    )}
                    {c.status === 'paused' && (
                      <button onClick={() => handleStatusChange(c.id, 'review')}
                        className="text-[10px] px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100">재개</button>
                    )}
                    {c.status !== 'ended' && (
                      <button
                        type="button"
                        onClick={() => setEndTarget(c)}
                        aria-haspopup="dialog"
                        aria-controls={endTarget?.id === c.id ? 'creative-end-confirm-dialog' : undefined}
                        className="text-[10px] px-3 py-1.5 bg-red-50 text-red-500 border border-red-200 rounded-lg hover:bg-red-100">종료</button>
                    )}
                    <button onClick={() => loadPerformance(c.id)}
                      className={`text-[10px] px-3 py-1.5 border rounded-lg transition ${expandedId === c.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-admin-bg text-admin-muted border-admin-border-mid hover:bg-admin-surface-2'}`}>
                      성과
                    </button>
                  </div>
                </div>
              </div>

              {/* 성과 확장 */}
              {expandedId === c.id && perfData && (
                <div className="border-t border-admin-border p-4 bg-admin-bg">
                  <PerformancePanel data={perfData} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {endTarget && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-6"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEndTarget(null);
          }}
        >
          <div
            id="creative-end-confirm-dialog"
            ref={endConfirmDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={endConfirmTitleId}
            aria-describedby={endConfirmDescriptionId}
            className="w-full rounded-t-admin-lg border border-admin-border-mid bg-admin-surface shadow-admin-lg sm:max-w-md sm:rounded-admin-lg"
          >
            <div className="border-b border-admin-border-mid px-5 py-4">
              <h2 id={endConfirmTitleId} className="text-lg font-bold text-admin-text">
                소재를 종료할까요?
              </h2>
              <p id={endConfirmDescriptionId} className="mt-2 text-sm leading-6 text-admin-muted">
                종료된 소재는 활성 캠페인 운영 대상에서 제외됩니다. 다시 쓰려면 새 검토 흐름으로 되돌려야 합니다.
              </p>
            </div>

            <div className="px-5 py-4">
              <div className="rounded-admin-md border border-admin-border-mid bg-admin-bg px-3 py-2">
                <div className="text-[11px] font-semibold uppercase text-admin-muted-2">대상 소재</div>
                <div className="mt-1 text-sm font-semibold text-admin-text">
                  {endTarget.travel_packages?.title ?? '상품 정보 없음'}
                </div>
                <div className="mt-1 text-xs text-admin-muted">
                  {CHANNEL_LABELS[endTarget.channel]} · {TYPE_LABELS[endTarget.creative_type]} · v{endTarget.variant_index}
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-admin-border-mid px-5 py-4 sm:flex-row sm:justify-end">
              <button
                ref={endConfirmCancelRef}
                type="button"
                className="rounded-admin-md border border-admin-border-mid px-4 py-2 text-sm font-semibold text-admin-text hover:bg-admin-surface-2 focus:outline-none focus:ring-2 focus:ring-admin-primary"
                onClick={() => setEndTarget(null)}
              >
                취소
              </button>
              <button
                type="button"
                className="rounded-admin-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                onClick={() => void handleStatusChange(endTarget.id, 'ended')}
              >
                종료 처리
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 캐러셀 미리보기 ────────────────────────────────────────

function CarouselPreview({ slides }: { slides: any[] }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {slides.map((s: any, i: number) => (
        <div key={i} className="shrink-0 w-36 bg-admin-bg rounded-lg p-2 border border-admin-border">
          {s.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.image_url} alt="" className="w-full h-16 object-cover rounded mb-1" />
          )}
          <p className="text-[10px] font-semibold text-admin-text-2 truncate">{s.headline || `슬라이드 ${i + 1}`}</p>
          <p className="text-[10px] text-admin-muted truncate">{s.body}</p>
          <span className="text-[9px] text-admin-muted-2">{s.role}</span>
        </div>
      ))}
    </div>
  );
}

// ── 단일이미지 미리보기 ────────────────────────────────────

function SingleImagePreview({ creative }: { creative: Creative }) {
  return (
    <div className="flex gap-3 items-start">
      {creative.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={creative.image_url} alt="" className="w-20 h-20 object-cover rounded-lg shrink-0" />
      )}
      <div className="min-w-0">
        {creative.headline && <p className="text-sm font-semibold text-admin-text-2 mb-0.5">{creative.headline}</p>}
        {creative.primary_text && <p className="text-xs text-admin-muted line-clamp-2 mb-0.5">{creative.primary_text}</p>}
        {creative.description && <p className="text-xs text-admin-muted-2">{creative.description}</p>}
      </div>
    </div>
  );
}

// ── 텍스트광고 미리보기 ────────────────────────────────────

function TextAdPreview({ creative }: { creative: Creative }) {
  return (
    <div className="space-y-2">
      {creative.keywords && creative.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {creative.keywords.map((kw, i) => (
            <span key={i} className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">{kw}</span>
          ))}
        </div>
      )}
      {creative.ad_copies && creative.ad_copies.length > 0 && (
        <div className="space-y-1.5">
          {creative.ad_copies.slice(0, 3).map((copy: any, i: number) => (
            <div key={i} className="bg-admin-bg rounded-lg p-2 border border-admin-border">
              <p className="text-xs font-semibold text-blue-700">{copy.title1} | {copy.title2}</p>
              <p className="text-[10px] text-admin-muted">{copy.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 성과 패널 ──────────────────────────────────────────────

function PerformancePanel({ data }: { data: any }) {
  const totals = data.totals;
  const rows = data.performance ?? [];

  if (rows.length === 0 && !totals) {
    return <p className="text-xs text-admin-muted-2 text-center py-4">성과 데이터가 아직 없습니다. 배포 후 수집됩니다.</p>;
  }

  return (
    <div className="space-y-3">
      {totals && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: '노출', value: totals.impressions?.toLocaleString() ?? '0' },
            { label: 'CTR', value: `${totals.ctr}%` },
            { label: '비용', value: `${Math.round(totals.spend).toLocaleString()}원` },
            { label: '전환율', value: `${totals.conv_rate}%` },
          ].map(m => (
            <div key={m.label} className="bg-white rounded-lg p-3 text-center border border-admin-border">
              <p className="text-[10px] text-admin-muted-2">{m.label}</p>
              <p className="text-sm font-bold text-admin-text-2">{m.value}</p>
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-admin-muted-2 border-b border-admin-border-mid">
                <th className="text-left py-1.5 font-medium">날짜</th>
                <th className="text-right py-1.5 font-medium">노출</th>
                <th className="text-right py-1.5 font-medium">클릭</th>
                <th className="text-right py-1.5 font-medium">CTR</th>
                <th className="text-right py-1.5 font-medium">비용</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 7).map((r: any) => (
                <tr key={r.id} className="border-b border-admin-border">
                  <td className="py-1.5 text-admin-muted">{r.date}</td>
                  <td className="py-1.5 text-right text-admin-muted">{r.impressions?.toLocaleString()}</td>
                  <td className="py-1.5 text-right text-admin-muted">{r.clicks?.toLocaleString()}</td>
                  <td className="py-1.5 text-right text-admin-muted">{Number(r.ctr).toFixed(2)}%</td>
                  <td className="py-1.5 text-right text-admin-muted">{Math.round(Number(r.spend)).toLocaleString()}원</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
