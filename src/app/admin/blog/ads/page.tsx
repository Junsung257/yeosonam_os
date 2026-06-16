'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bot, CheckCircle2, Copy, PauseCircle, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';

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
  cta_clicks?: number | null;
  conversions: number;
  conversion_value_krw?: number | null;
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
  kakao: 'bg-yellow-100 text-yellow-800',
};

const STATUS_LABEL: Record<string, string> = {
  candidate: 'AI 후보',
  approved: '승인됨',
  testing: '테스트',
  active: '활성',
  winning: '성과 좋음',
  scaled: '확장',
  legacy_active: '기존 활성',
  paused: '정지',
  rejected: '제외',
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

function statusOf(mapping: Mapping) {
  return mapping.operational_status || (mapping.active ? 'legacy_active' : 'candidate');
}

function statusBucket(status: string) {
  if (status === 'candidate') return 'candidate';
  if (status === 'approved') return 'approved';
  if (status === 'testing') return 'testing';
  if (['active', 'winning', 'scaled', 'legacy_active'].includes(status)) return 'active';
  return 'paused';
}

export default function BlogAdsPage() {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [blogs, setBlogs] = useState<BlogOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPlatform, setFilterPlatform] = useState<string>('all');
  const [autoGenerating, setAutoGenerating] = useState(false);
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
      fetch(`/api/blog/ad-mapping?${params}`, { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/blog?admin=1&limit=100', { cache: 'no-store' }).then((r) => r.json()),
    ]);
    setMappings(mapRes.items || []);
    setBlogs(blogRes.posts || []);
    setLoading(false);
  }, [filterPlatform]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const stats = useMemo(() => {
    const buckets = { candidate: 0, approved: 0, testing: 0, active: 0, paused: 0 };
    let clicks = 0;
    let cta = 0;
    let conversions = 0;
    let value = 0;
    for (const mapping of mappings) {
      buckets[statusBucket(statusOf(mapping)) as keyof typeof buckets] += 1;
      clicks += Number(mapping.clicks || 0);
      cta += Number(mapping.cta_clicks || 0);
      conversions += Number(mapping.conversions || 0);
      value += Number(mapping.conversion_value_krw || 0);
    }
    return { ...buckets, clicks, cta, conversions, value };
  }, [mappings]);

  async function autoGenerate() {
    setAutoGenerating(true);
    try {
      await fetch('/api/blog/ad-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto_generate', limit: 80 }),
      });
      await fetchData();
    } finally {
      setAutoGenerating(false);
    }
  }

  async function createMapping() {
    if (!fBlog || !fKeyword.trim()) {
      alert('블로그와 광고 키워드는 필수입니다.');
      return;
    }
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
      const err = await res.json().catch(() => ({}));
      alert(`실패: ${err.error || res.status}`);
      return;
    }
    setFBlog('');
    setFKeyword('');
    setFCampaignSlug('');
    setFDkiHeadline('');
    setFDkiSubtitle('');
    setFormOpen(false);
    fetchData();
  }

  async function updateStatus(id: string, operationalStatus: 'approved' | 'paused' | 'rejected') {
    await fetch('/api/blog/ad-mapping', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, operational_status: operationalStatus }),
    });
    fetchData();
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="블로그 광고 매핑"
        subtitle="광고 후보 생성, 승인, 추적 링크, 블로그 랜딩 성과를 한 화면에서 관리합니다."
        actions={
          <>
            <Link href="/admin/blog">
              <Button variant="secondary" size="sm">
                <ArrowLeft size={14} />
                블로그 목록
              </Button>
            </Link>
            <Button variant="secondary" size="sm" onClick={autoGenerate} disabled={autoGenerating}>
              <Bot size={14} />
              {autoGenerating ? '후보 생성 중' : 'AI 후보 생성'}
            </Button>
            <Button variant="primary" size="sm" onClick={() => setFormOpen((open) => !open)}>
              <Plus size={14} />
              수동 매핑
            </Button>
          </>
        }
      />

      <section className="admin-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-admin-base font-semibold text-admin-text-2">운영 방식</h2>
            <p className="mt-1 max-w-3xl text-admin-xs leading-5 text-admin-muted">
              이 화면의 매핑은 광고를 즉시 켜는 버튼이 아닙니다. AI가 키워드와 블로그 랜딩 후보를 만들고,
              운영자가 승인하면 추적 링크와 광고 문구 치환값이 준비됩니다. 실제 네이버/구글 집행은 광고 운영 시스템의 예산,
              권한, 캠페인 상태가 모두 통과해야 가능합니다.
            </p>
          </div>
          <Link href="/admin/ad-os" className="inline-flex h-9 items-center gap-1.5 rounded-admin-sm border border-admin-border-strong px-3 text-admin-xs font-semibold text-admin-text-2 hover:bg-admin-bg">
            <ShieldCheck size={14} />
            광고 집행 상태
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
          {[
            ['AI 후보', stats.candidate],
            ['승인됨', stats.approved],
            ['테스트', stats.testing],
            ['활성/성과', stats.active],
            ['정지/만료', stats.paused],
          ].map(([label, value]) => (
            <div key={label} className="rounded-admin-sm bg-admin-surface-2 p-3">
              <p className="text-admin-2xs font-semibold text-admin-muted">{label}</p>
              <p className="mt-1 text-admin-lg font-bold text-admin-text-2 admin-num">{Number(value).toLocaleString('ko-KR')}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {[
            ['클릭', stats.clicks],
            ['상담 버튼', stats.cta],
            ['예약/전환', stats.conversions],
            ['전환가치', `${stats.value.toLocaleString('ko-KR')}원`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-admin-sm border border-admin-border p-3">
              <p className="text-admin-2xs font-semibold text-admin-muted">{label}</p>
              <p className="mt-1 text-admin-sm font-bold text-admin-text-2 admin-num">{String(value)}</p>
            </div>
          ))}
        </div>
      </section>

      {formOpen && (
        <section className="admin-card border-brand/20 p-4 space-y-2">
          <div className="grid gap-2 md:grid-cols-2">
            <select value={fBlog} onChange={(e) => setFBlog(e.target.value)} className="h-9 rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3 text-admin-sm text-admin-text">
              <option value="">블로그 선택</option>
              {blogs.map((blog) => (
                <option key={blog.id} value={blog.id}>
                  [{blog.destination || '-'}] {blog.seo_title?.slice(0, 50) || blog.slug}
                </option>
              ))}
            </select>
            <select value={fPlatform} onChange={(e) => setFPlatform(e.target.value)} className="h-9 rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3 text-admin-sm text-admin-text">
              {PLATFORMS.map((platform) => <option key={platform.v} value={platform.v}>{platform.label}</option>)}
            </select>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <input value={fKeyword} onChange={(e) => setFKeyword(e.target.value)} placeholder="광고 키워드 예: 부산 부모님 다낭 여행" className="h-9 rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3 text-admin-sm text-admin-text" />
            <input value={fCampaignSlug} onChange={(e) => setFCampaignSlug(e.target.value)} placeholder="캠페인 슬러그 선택, 미입력시 자동" className="h-9 rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3 text-admin-sm text-admin-text" />
          </div>
          <input value={fDkiHeadline} onChange={(e) => setFDkiHeadline(e.target.value)} placeholder="광고 제목 치환 문구 선택" className="h-9 w-full rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3 text-admin-sm text-admin-text" />
          <input value={fDkiSubtitle} onChange={(e) => setFDkiSubtitle(e.target.value)} placeholder="광고 부제 치환 문구 선택" className="h-9 w-full rounded-admin-sm border border-admin-border-mid bg-admin-surface px-3 text-admin-sm text-admin-text" />
          <Button variant="primary" onClick={createMapping} className="w-full">
            생성 + 추적 URL 자동 발급
          </Button>
        </section>
      )}

      <div className="flex w-fit gap-1 rounded-admin-sm bg-admin-surface-2 p-1">
        {['all', ...PLATFORMS.map((platform) => platform.v)].map((value) => (
          <button
            key={value}
            onClick={() => setFilterPlatform(value)}
            className={`h-8 rounded-admin-xs px-3 text-admin-sm font-medium transition-colors ${filterPlatform === value ? 'bg-admin-surface text-admin-text shadow-admin-xs' : 'text-admin-muted hover:text-admin-text-2'}`}
          >
            {value === 'all' ? '전체' : PLATFORMS.find((platform) => platform.v === value)?.label || value}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="admin-card py-12 text-center text-admin-sm text-admin-muted">로딩 중</div>
      ) : mappings.length === 0 ? (
        <div className="admin-card py-12 text-center text-admin-sm text-admin-muted">
          매핑 후보가 없습니다. AI 후보 생성을 누르면 블로그 랜딩과 광고 키워드를 자동으로 연결합니다.
        </div>
      ) : (
        <div className="overflow-hidden rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs">
          <table className="admin-data-table">
            <thead>
              <tr>
                <th style={{ width: 76 }}>채널</th>
                <th>키워드 / 블로그 랜딩</th>
                <th style={{ width: 220 }}>추적 링크 / 광고 치환</th>
                <th className="text-right" style={{ width: 70 }}>클릭</th>
                <th className="text-right" style={{ width: 70 }}>상담</th>
                <th className="text-right" style={{ width: 70 }}>전환</th>
                <th className="text-center" style={{ width: 100 }}>상태</th>
                <th style={{ width: 170 }}></th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => {
                const status = statusOf(mapping);
                return (
                  <tr key={mapping.id}>
                    <td>
                      <span className={`rounded-admin-xs px-2 py-1 text-admin-2xs font-semibold ${PLATFORM_COLOR[mapping.platform] || 'bg-admin-surface-2 text-admin-muted'}`}>
                        {PLATFORMS.find((platform) => platform.v === mapping.platform)?.label || mapping.platform}
                      </span>
                    </td>
                    <td>
                      <p className="font-semibold text-admin-text-2">{mapping.keyword}</p>
                      <p className="mt-0.5 text-admin-2xs text-admin-muted">
                        {mapping.content_creatives?.seo_title || mapping.content_creatives?.slug || '랜딩 미연결'}
                      </p>
                      {mapping.ad_campaigns && (
                        <p className="mt-0.5 text-admin-2xs text-admin-muted">캠페인: {mapping.ad_campaigns.name} ({mapping.ad_campaigns.status})</p>
                      )}
                    </td>
                    <td>
                      <button onClick={() => copyText(mapping.landing_url)} className="inline-flex max-w-full items-center gap-1 text-admin-2xs text-brand hover:underline">
                        <Copy size={12} />
                        <span className="truncate">{mapping.utm_campaign}</span>
                      </button>
                      <p className="mt-1 truncate text-admin-2xs text-admin-muted">{mapping.dki_headline || 'DKI 없음'}</p>
                    </td>
                    <td className="text-right admin-num">{Number(mapping.clicks || 0).toLocaleString('ko-KR')}</td>
                    <td className="text-right admin-num">{Number(mapping.cta_clicks || 0).toLocaleString('ko-KR')}</td>
                    <td className="text-right admin-num">{Number(mapping.conversions || 0).toLocaleString('ko-KR')}</td>
                    <td className="text-center">
                      <span className={`rounded-admin-xs px-2 py-1 text-admin-2xs font-semibold ${STATUS_COLOR[status] || STATUS_COLOR.candidate}`}>
                        {STATUS_LABEL[status] || status}
                      </span>
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {status === 'candidate' && (
                          <Button variant="secondary" size="sm" onClick={() => updateStatus(mapping.id, 'approved')}>
                            <CheckCircle2 size={13} />
                            승인
                          </Button>
                        )}
                        {status !== 'paused' && status !== 'expired' && (
                          <Button variant="secondary" size="sm" onClick={() => updateStatus(mapping.id, 'paused')}>
                            <PauseCircle size={13} />
                            정지
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={fetchData}>
                          <RefreshCw size={13} />
                        </Button>
                      </div>
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
