'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { Plus, ArrowLeft } from 'lucide-react';

interface Mapping {
  id: string;
  content_creative_id: string;
  campaign_id: string | null;
  platform: string;
  keyword: string;
  match_type: string;
  utm_source: string;
  utm_campaign: string;
  utm_term: string | null;
  dki_headline: string | null;
  landing_url: string;
  active: boolean;
  operational_status?: string | null;
  clicks: number;
  conversions: number;
  created_at: string;
  content_creatives: { slug: string; seo_title: string | null; destination: string | null; landing_enabled: boolean } | null;
  ad_campaigns: { name: string; status: string } | null;
}

interface BlogOption {
  id: string;
  slug: string | null;
  seo_title: string | null;
  destination: string | null;
  landing_enabled?: boolean;
}

const PLATFORMS = [
  { v: 'naver', label: '네이버' },
  { v: 'google', label: '구글' },
  { v: 'meta', label: 'Meta' },
  { v: 'kakao', label: '카카오' },
];

const PLATFORM_COLOR: Record<string, string> = {
  naver: 'bg-green-100 text-green-700',
  google: 'bg-blue-100 text-blue-700',
  meta: 'bg-indigo-100 text-indigo-700',
  kakao: 'bg-yellow-100 text-yellow-700',
};

const STATUS_LABEL: Record<string, string> = {
  candidate: '후보',
  approved: '승인',
  testing: '테스트',
  active: '집행',
  winning: '승자',
  scaled: '확대',
  legacy_active: '기존 활성',
  paused: '중지',
  rejected: '폐기',
  expired: '만료',
};

const STATUS_COLOR: Record<string, string> = {
  candidate: 'bg-admin-surface-2 text-admin-muted',
  approved: 'bg-blue-50 text-blue-700',
  testing: 'bg-amber-50 text-amber-700',
  active: 'bg-emerald-50 text-emerald-700',
  winning: 'bg-emerald-50 text-emerald-700',
  scaled: 'bg-purple-50 text-purple-700',
  legacy_active: 'bg-amber-50 text-amber-700',
  paused: 'bg-admin-surface-2 text-admin-muted',
  rejected: 'bg-rose-50 text-rose-700',
  expired: 'bg-rose-50 text-rose-700',
};

export default function BlogAdsPage() {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [blogs, setBlogs] = useState<BlogOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPlatform, setFilterPlatform] = useState<string>('all');
  const [autoGenerating, setAutoGenerating] = useState(false);

  // 신규 매핑 폼
  const [formOpen, setFormOpen] = useState(false);
  const [fBlog, setFBlog] = useState('');
  const [fPlatform, setFPlatform] = useState('naver');
  const [fKeyword, setFKeyword] = useState('');
  const [fCampaignSlug, setFCampaignSlug] = useState('');
  const [fDkiHeadline, setFDkiHeadline] = useState('');
  const [fDkiSubtitle, setFDkiSubtitle] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterPlatform !== 'all') params.set('platform', filterPlatform);
    const [mapRes, blogRes] = await Promise.all([
      fetch(`/api/blog/ad-mapping?${params}`).then(r => r.json()),
      fetch('/api/blog?admin=1&limit=100').then(r => r.json()),
    ]);
    setMappings(mapRes.items || []);
    setBlogs(blogRes.posts || []);
    setLoading(false);
  }, [filterPlatform]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (loading || autoGenerating || filterPlatform !== 'all' || mappings.length > 0 || blogs.length === 0) return;
    setAutoGenerating(true);
    fetch('/api/blog/ad-mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'auto_generate', limit: 50 }),
    })
      .then(() => fetchData())
      .finally(() => setAutoGenerating(false));
  }, [autoGenerating, blogs.length, fetchData, filterPlatform, loading, mappings.length]);

  const createMapping = async () => {
    if (!fBlog || !fKeyword.trim()) { alert('블로그와 키워드 필수'); return; }
    const res = await fetch('/api/blog/ad-mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content_creative_id: fBlog,
        platform: fPlatform,
        keyword: fKeyword.trim(),
        campaign_slug: fCampaignSlug.trim() || undefined,
        dki_headline: fDkiHeadline.trim() || undefined,
        dki_subtitle: fDkiSubtitle.trim() || undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert('실패: ' + err.error);
      return;
    }
    setFBlog(''); setFKeyword(''); setFCampaignSlug(''); setFDkiHeadline(''); setFDkiSubtitle('');
    setFormOpen(false);
    fetchData();
  };

  const toggleActive = async (id: string, status?: string | null) => {
    const nextStatus = ['active', 'winning', 'scaled'].includes(status || '') ? 'paused' : 'approved';
    await fetch('/api/blog/ad-mapping', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, operational_status: nextStatus }),
    });
    fetchData();
  };

  const remove = async (id: string) => {
    if (!confirm('매핑 삭제?')) return;
    await fetch(`/api/blog/ad-mapping?id=${id}`, { method: 'DELETE' });
    fetchData();
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('복사됨:\n' + text);
  };

  const mappingStats = mappings.reduce(
    (acc, mapping) => {
      const status = mapping.operational_status || (mapping.active ? 'legacy_active' : 'candidate');
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const activeLikeCount = ['active', 'winning', 'scaled', 'legacy_active'].reduce((sum, status) => sum + (mappingStats[status] || 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="블로그 광고 매핑"
        subtitle="광고 키워드 × 블로그 랜딩페이지 매핑 + UTM 자동 생성 + DKI 헤드라인"
        actions={
          <>
            <Link href="/admin/blog">
              <Button variant="secondary" size="sm">
                <ArrowLeft size={14} />
                블로그 목록
              </Button>
            </Link>
            <Button variant="primary" size="sm" onClick={() => setFormOpen(!formOpen)}>
              <Plus size={14} />
              매핑 추가
            </Button>
          </>
        }
      />

      {/* 신규 매핑 폼 */}
      <section className="admin-card p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-admin-base font-semibold text-admin-text-2">AI 매핑 운영 방식</h2>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              이 화면의 매핑은 광고를 즉시 켜는 버튼이 아니라 블로그 랜딩, 광고 키워드, UTM, DKI 문구를 묶는 승인 큐입니다.
              추천 → 승인 → 제한 예산 테스트 → 성과 학습 순서로만 외부 집행에 연결합니다.
            </p>
          </div>
          <Link href="/admin/ad-os" className="rounded-admin-sm border border-admin-border-strong px-3 py-2 text-admin-xs font-semibold text-admin-text-2 hover:bg-admin-bg">
            Ad OS에서 집행 상태 보기
          </Link>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
          {[
            ['추천', mappingStats.candidate || 0],
            ['승인', mappingStats.approved || 0],
            ['테스트', mappingStats.testing || 0],
            ['활성/확장', activeLikeCount],
            ['정지/제외', (mappingStats.paused || 0) + (mappingStats.negative || 0) + (mappingStats.rejected || 0)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-admin-sm bg-admin-surface-2 p-3">
              <p className="text-admin-2xs font-semibold text-admin-muted">{label}</p>
              <p className="mt-1 text-admin-lg font-bold text-admin-text-2">{Number(value).toLocaleString('ko-KR')}</p>
            </div>
          ))}
        </div>
        {activeLikeCount > 0 && (
          <div className="mt-3 rounded-admin-sm border border-amber-200 bg-amber-50 p-3 text-admin-xs leading-5 text-amber-800">
            활성으로 보이는 매핑은 외부 광고가 실제 집행 중이라는 뜻이 아닙니다. 네이버/구글 API 권한, 캠페인 ID, 예산 가드레일이 통과해야 실제 집행 가능 상태로 표시됩니다.
          </div>
        )}
      </section>

      {formOpen && (
        <div className="admin-card border-brand/20 p-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select value={fBlog} onChange={e => setFBlog(e.target.value)} className="h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors">
              <option value="">블로그 선택</option>
              {blogs.map(b => (
                <option key={b.id} value={b.id}>
                  [{b.destination || '?'}] {b.seo_title?.slice(0, 50) || b.slug}
                </option>
              ))}
            </select>
            <select value={fPlatform} onChange={e => setFPlatform(e.target.value)} className="h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors">
              {PLATFORMS.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={fKeyword}
              onChange={e => setFKeyword(e.target.value)}
              placeholder="광고 키워드 (예: 다낭 패키지)"
              className="h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
            />
            <input
              value={fCampaignSlug}
              onChange={e => setFCampaignSlug(e.target.value)}
              placeholder="캠페인 슬러그 (선택, 미입력시 자동)"
              className="h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
            />
          </div>
          <input
            value={fDkiHeadline}
            onChange={e => setFDkiHeadline(e.target.value)}
            placeholder="DKI 헤드라인 (선택) — 이 키워드로 들어오면 H1을 이걸로 교체"
            className="w-full h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
          />
          <input
            value={fDkiSubtitle}
            onChange={e => setFDkiSubtitle(e.target.value)}
            placeholder="DKI 부제 (선택)"
            className="w-full h-9 px-3 text-admin-sm border border-admin-border-mid rounded-admin-sm bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
          />
          <Button variant="primary" onClick={createMapping} className="w-full">
            생성 + UTM URL 자동 발급
          </Button>
        </div>
      )}

      {/* 필터 */}
      <div className="flex gap-1 bg-admin-surface-2 rounded-admin-sm p-1 w-fit">
        {['all', ...PLATFORMS.map(p => p.v)].map(v => (
          <button
            key={v}
            onClick={() => setFilterPlatform(v)}
            className={`px-3 h-8 text-admin-sm font-medium rounded-admin-xs transition-colors ${
              filterPlatform === v ? 'bg-admin-surface text-admin-text shadow-admin-xs' : 'text-admin-muted hover:text-admin-text-2'
            }`}
          >
            {v === 'all' ? '전체' : PLATFORMS.find(p => p.v === v)?.label || v}
          </button>
        ))}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="text-center py-12 text-admin-muted text-admin-sm">로딩…</div>
      ) : mappings.length === 0 ? (
        <div className="text-center py-12 text-admin-muted text-admin-sm admin-card">
          {autoGenerating ? '광고 매핑을 자동 생성하는 중입니다.' : '자동 생성할 매핑 후보가 아직 없습니다.'}
        </div>
      ) : (
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
          <table className="admin-data-table">
            <thead>
              <tr>
                <th style={{ width: 64 }}>플랫폼</th>
                <th>키워드 / 랜딩 블로그</th>
                <th style={{ width: 192 }}>DKI 헤드라인</th>
                <th className="text-right" style={{ width: 64 }}>클릭</th>
                <th className="text-right" style={{ width: 64 }}>전환</th>
                <th className="text-center" style={{ width: 88 }}>운영상태</th>
                <th style={{ width: 112 }}></th>
              </tr>
            </thead>
            <tbody>
              {mappings.map(m => {
                const status = m.operational_status || (m.active ? 'legacy_active' : 'candidate');
                return (
                <tr key={m.id}>
                  <td>
                    <span className={`px-2 py-0.5 text-admin-2xs rounded-admin-xs font-bold ${PLATFORM_COLOR[m.platform]}`}>
                      {PLATFORMS.find(p => p.v === m.platform)?.label || m.platform}
                    </span>
                  </td>
                  <td>
                    <p className="text-admin-sm font-semibold text-admin-text">{m.keyword}</p>
                    <Link href={`/blog/${m.content_creatives?.slug}`} target="_blank" className="text-admin-xs text-brand hover:text-brand-dark hover:underline font-mono">
                      /blog/{m.content_creatives?.slug}
                    </Link>
                  </td>
                  <td className="text-admin-xs text-admin-muted">
                    {m.dki_headline ? (
                      <span className="inline-block px-1.5 py-0.5 bg-status-warningBg text-status-warningFg rounded-admin-xs" title={m.dki_headline}>
                        {m.dki_headline.slice(0, 30)}…
                      </span>
                    ) : (
                      <span className="text-admin-muted-2">(기본 타이틀)</span>
                    )}
                  </td>
                  <td className="text-right text-admin-xs admin-num font-semibold">{m.clicks.toLocaleString()}</td>
                  <td className="text-right text-admin-xs admin-num font-semibold text-success">{m.conversions.toLocaleString()}</td>
                  <td className="text-center">
                    <button
                      onClick={() => toggleActive(m.id, status)}
                      className={`px-2 py-0.5 text-admin-2xs rounded-admin-xs font-semibold transition-colors ${
                        STATUS_COLOR[status] || 'bg-admin-surface-2 text-admin-muted'
                      }`}
                    >
                      {STATUS_LABEL[status] || status}
                    </button>
                  </td>
                  <td className="text-right space-x-2">
                    <button onClick={() => copy(m.landing_url)} className="text-admin-xs text-brand hover:text-brand-dark hover:underline font-medium">
                      URL복사
                    </button>
                    <button onClick={() => remove(m.id)} className="text-admin-xs text-danger hover:underline font-medium">
                      삭제
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
