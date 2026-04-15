'use client';

import { useState, useEffect, useCallback } from 'react';

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
  draft: { label: '초안', color: 'bg-gray-100 text-gray-600' },
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
      .catch(() => {});
  }, []);

  // 소재 목록 로드
  const fetchCreatives = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterType !== 'all') params.set('creative_type', filterType);
    if (filterChannel !== 'all') params.set('channel', filterChannel);
    if (filterStatus !== 'all') params.set('status', filterStatus);
    if (filterProduct) params.set('product_id', filterProduct);
    params.set('limit', '100');

    try {
      const res = await fetch(`/api/campaigns/creatives?${params}`);
      const data = await res.json();
      setCreatives(data.creatives ?? []);
    } catch { setCreatives([]); }
    finally { setLoading(false); }
  }, [filterType, filterChannel, filterStatus, filterProduct]);

  useEffect(() => { fetchCreatives(); }, [fetchCreatives]);

  // 소재 생성
  const handleGenerate = async () => {
    if (!selectedPkg) { setError('상품을 선택하세요'); return; }
    setError('');
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
    if (newStatus === 'ended' && !confirm('이 소재를 종료하시겠습니까?')) return;

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
          <h1 className="text-xl font-bold text-gray-900">광고 소재 공장</h1>
          <p className="text-xs text-gray-500 mt-0.5">상품 → 캐러셀 + 단일이미지 + 텍스트광고 자동 생성</p>
        </div>
        <button onClick={() => setShowGenerator(!showGenerator)}
          className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition">
          + 소재 생성
        </button>
      </div>

      {/* 생성 패널 */}
      {showGenerator && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">소재 생성 설정</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">상품 선택 *</label>
              <select value={selectedPkg} onChange={e => setSelectedPkg(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="">상품 선택...</option>
                {packages.map(p => <option key={p.id} value={p.id}>{p.title} ({p.destination})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">채널</label>
              <div className="flex gap-2">
                {['meta', 'naver', 'google'].map(ch => (
                  <button key={ch} onClick={() => toggleChannel(ch)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition ${channels.includes(ch) ? 'bg-violet-50 border-violet-300 text-violet-700' : 'border-gray-200 text-gray-500'}`}>
                    {CHANNEL_LABELS[ch]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {channels.includes('meta') && (
            <div className="flex gap-6">
              <div>
                <label className="text-xs text-gray-500">캐러셀 변형 수</label>
                <div className="flex items-center gap-2 mt-1">
                  {[1,2,3].map(n => (
                    <button key={n} onClick={() => setCarouselCount(n)}
                      className={`w-8 h-8 rounded-lg text-xs font-medium transition ${carouselCount === n ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{n}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500">단일이미지 변형 수</label>
                <div className="flex items-center gap-2 mt-1">
                  {[1,2,3].map(n => (
                    <button key={n} onClick={() => setSingleCount(n)}
                      className={`w-8 h-8 rounded-lg text-xs font-medium transition ${singleCount === n ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{n}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {error && <p className="text-xs text-red-500 bg-red-50 p-2 rounded-lg">{error}</p>}
          <button onClick={handleGenerate} disabled={generating || !selectedPkg}
            className="px-5 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition">
            {generating ? '생성 중 (최대 60초)...' : '소재 생성'}
          </button>
        </div>
      )}

      {/* 필터 바 */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap items-center gap-3">
        <div className="flex border border-gray-200 rounded-lg overflow-hidden">
          {['all', 'carousel', 'single_image', 'text_ad'].map(t => (
            <button key={t} onClick={() => setFilterType(t)}
              className={`px-3 py-1.5 text-xs transition ${filterType === t ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
              {t === 'all' ? '전체' : TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <select value={filterChannel} onChange={e => setFilterChannel(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs">
          <option value="all">전체 채널</option>
          {Object.entries(CHANNEL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs">
          <option value="all">전체 상태</option>
          {Object.entries(STATUS_CONFIG).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
        </select>
        <select value={filterProduct} onChange={e => setFilterProduct(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-[160px]">
          <option value="">전체 상품</option>
          {packages.map(p => <option key={p.id} value={p.id}>{p.title.slice(0, 25)}</option>)}
        </select>
        <span className="text-xs text-gray-400 ml-auto">{creatives.length}건</span>
      </div>

      {/* 소재 목록 */}
      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">불러오는 중...</div>
      ) : creatives.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">소재가 없습니다</p>
          <p className="text-xs">상단의 "소재 생성" 버튼을 눌러 시작하세요</p>
        </div>
      ) : (
        <div className="space-y-3">
          {creatives.map(c => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* 소재 카드 */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  {/* 좌측: 메타 정보 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_CONFIG[c.status]?.color ?? 'bg-gray-100 text-gray-500'}`}>
                        {STATUS_CONFIG[c.status]?.label ?? c.status}
                      </span>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {CHANNEL_LABELS[c.channel]} · {TYPE_LABELS[c.creative_type]}
                      </span>
                      {c.hook_type && (
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${HOOK_COLORS[c.hook_type] ?? 'bg-gray-50 text-gray-500'}`}>
                          {c.hook_type}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-400">v{c.variant_index}</span>
                      <span className="text-[10px] text-gray-400">{new Date(c.created_at).toLocaleDateString('ko')}</span>
                    </div>
                    <p className="text-xs text-gray-500 truncate mb-2">{c.travel_packages?.title}</p>

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
                      <button onClick={() => handleStatusChange(c.id, 'ended')}
                        className="text-[10px] px-3 py-1.5 bg-red-50 text-red-500 border border-red-200 rounded-lg hover:bg-red-100">종료</button>
                    )}
                    <button onClick={() => loadPerformance(c.id)}
                      className={`text-[10px] px-3 py-1.5 border rounded-lg transition ${expandedId === c.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}>
                      성과
                    </button>
                  </div>
                </div>
              </div>

              {/* 성과 확장 */}
              {expandedId === c.id && perfData && (
                <div className="border-t border-gray-100 p-4 bg-gray-50">
                  <PerformancePanel data={perfData} />
                </div>
              )}
            </div>
          ))}
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
        <div key={i} className="shrink-0 w-36 bg-gray-50 rounded-lg p-2 border border-gray-100">
          {s.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.image_url} alt="" className="w-full h-16 object-cover rounded mb-1" />
          )}
          <p className="text-[10px] font-semibold text-gray-800 truncate">{s.headline || `슬라이드 ${i + 1}`}</p>
          <p className="text-[10px] text-gray-500 truncate">{s.body}</p>
          <span className="text-[9px] text-gray-400">{s.role}</span>
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
        {creative.headline && <p className="text-sm font-semibold text-gray-800 mb-0.5">{creative.headline}</p>}
        {creative.primary_text && <p className="text-xs text-gray-600 line-clamp-2 mb-0.5">{creative.primary_text}</p>}
        {creative.description && <p className="text-xs text-gray-400">{creative.description}</p>}
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
            <div key={i} className="bg-gray-50 rounded-lg p-2 border border-gray-100">
              <p className="text-xs font-semibold text-blue-700">{copy.title1} | {copy.title2}</p>
              <p className="text-[10px] text-gray-500">{copy.description}</p>
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
    return <p className="text-xs text-gray-400 text-center py-4">성과 데이터가 아직 없습니다. 배포 후 수집됩니다.</p>;
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
            <div key={m.label} className="bg-white rounded-lg p-3 text-center border border-gray-100">
              <p className="text-[10px] text-gray-400">{m.label}</p>
              <p className="text-sm font-bold text-gray-800">{m.value}</p>
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-gray-400 border-b border-gray-200">
                <th className="text-left py-1.5 font-medium">날짜</th>
                <th className="text-right py-1.5 font-medium">노출</th>
                <th className="text-right py-1.5 font-medium">클릭</th>
                <th className="text-right py-1.5 font-medium">CTR</th>
                <th className="text-right py-1.5 font-medium">비용</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 7).map((r: any) => (
                <tr key={r.id} className="border-b border-gray-50">
                  <td className="py-1.5 text-gray-600">{r.date}</td>
                  <td className="py-1.5 text-right text-gray-600">{r.impressions?.toLocaleString()}</td>
                  <td className="py-1.5 text-right text-gray-600">{r.clicks?.toLocaleString()}</td>
                  <td className="py-1.5 text-right text-gray-600">{Number(r.ctr).toFixed(2)}%</td>
                  <td className="py-1.5 text-right text-gray-600">{Math.round(Number(r.spend)).toLocaleString()}원</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
