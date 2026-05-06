'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

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

export default function BlogAdsPage() {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [blogs, setBlogs] = useState<BlogOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPlatform, setFilterPlatform] = useState<string>('all');

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

  const toggleActive = async (id: string, active: boolean) => {
    await fetch('/api/blog/ad-mapping', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active: !active }),
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-slate-800">블로그 광고 매핑</h1>
          <p className="text-admin-xs text-slate-400 mt-0.5">
            광고 키워드 × 블로그 랜딩페이지 매핑 + UTM 자동 생성 + DKI 헤드라인
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/blog" className="px-3 py-2 bg-white border border-slate-300 text-slate-600 text-admin-xs rounded-lg hover:bg-slate-50">
            ← 블로그 목록
          </Link>
          <button
            onClick={() => setFormOpen(!formOpen)}
            className="px-4 py-2 bg-blue-600 text-white text-admin-sm font-semibold rounded-lg hover:bg-blue-700"
          >
            + 매핑 추가
          </button>
        </div>
      </div>

      {/* 신규 매핑 폼 */}
      {formOpen && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select value={fBlog} onChange={e => setFBlog(e.target.value)} className="px-3 py-2 text-admin-xs border rounded">
              <option value="">블로그 선택</option>
              {blogs.map(b => (
                <option key={b.id} value={b.id}>
                  [{b.destination || '?'}] {b.seo_title?.slice(0, 50) || b.slug}
                </option>
              ))}
            </select>
            <select value={fPlatform} onChange={e => setFPlatform(e.target.value)} className="px-3 py-2 text-admin-xs border rounded">
              {PLATFORMS.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={fKeyword}
              onChange={e => setFKeyword(e.target.value)}
              placeholder="광고 키워드 (예: 다낭 패키지)"
              className="px-3 py-2 text-admin-xs border rounded"
            />
            <input
              value={fCampaignSlug}
              onChange={e => setFCampaignSlug(e.target.value)}
              placeholder="캠페인 슬러그 (선택, 미입력시 자동)"
              className="px-3 py-2 text-admin-xs border rounded"
            />
          </div>
          <input
            value={fDkiHeadline}
            onChange={e => setFDkiHeadline(e.target.value)}
            placeholder="DKI 헤드라인 (선택) — 이 키워드로 들어오면 H1을 이걸로 교체"
            className="w-full px-3 py-2 text-admin-xs border rounded"
          />
          <input
            value={fDkiSubtitle}
            onChange={e => setFDkiSubtitle(e.target.value)}
            placeholder="DKI 부제 (선택)"
            className="w-full px-3 py-2 text-admin-xs border rounded"
          />
          <button onClick={createMapping} className="w-full px-4 py-2 bg-blue-600 text-white text-admin-sm rounded font-semibold">
            생성 + UTM URL 자동 발급
          </button>
        </div>
      )}

      {/* 필터 */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {['all', ...PLATFORMS.map(p => p.v)].map(v => (
          <button
            key={v}
            onClick={() => setFilterPlatform(v)}
            className={`px-3 py-1.5 text-admin-xs font-medium rounded-md ${
              filterPlatform === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
            }`}
          >
            {v === 'all' ? '전체' : PLATFORMS.find(p => p.v === v)?.label || v}
          </button>
        ))}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-admin-sm">로딩...</div>
      ) : mappings.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-admin-sm">
          매핑이 없습니다. "매핑 추가" 버튼으로 광고 키워드를 블로그에 연결하세요.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-3 py-2 text-[11px] text-slate-500 font-medium w-16">플랫폼</th>
                <th className="text-left px-3 py-2 text-[11px] text-slate-500 font-medium">키워드 / 랜딩 블로그</th>
                <th className="text-left px-3 py-2 text-[11px] text-slate-500 font-medium w-48">DKI 헤드라인</th>
                <th className="text-right px-3 py-2 text-[11px] text-slate-500 font-medium w-16">클릭</th>
                <th className="text-right px-3 py-2 text-[11px] text-slate-500 font-medium w-16">전환</th>
                <th className="text-center px-3 py-2 text-[11px] text-slate-500 font-medium w-20">활성</th>
                <th className="w-28"></th>
              </tr>
            </thead>
            <tbody>
              {mappings.map(m => (
                <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2.5">
                    <span className={`px-1.5 py-0.5 text-[10px] rounded font-bold ${PLATFORM_COLOR[m.platform]}`}>
                      {PLATFORMS.find(p => p.v === m.platform)?.label || m.platform}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="text-admin-sm font-semibold text-slate-800">{m.keyword}</p>
                    <Link href={`/blog/${m.content_creatives?.slug}`} target="_blank" className="text-[11px] text-blue-600 hover:underline">
                      /blog/{m.content_creatives?.slug}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-slate-600">
                    {m.dki_headline ? (
                      <span className="inline-block px-1.5 py-0.5 bg-amber-50 text-amber-800 rounded" title={m.dki_headline}>
                        {m.dki_headline.slice(0, 30)}...
                      </span>
                    ) : (
                      <span className="text-slate-300">(기본 타이틀 사용)</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-admin-xs tabular-nums font-semibold">{m.clicks.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right text-admin-xs tabular-nums font-semibold text-emerald-600">{m.conversions.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      onClick={() => toggleActive(m.id, m.active)}
                      className={`px-2 py-0.5 text-[10px] rounded ${
                        m.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {m.active ? '활성' : '비활성'}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-right space-x-2">
                    <button onClick={() => copy(m.landing_url)} className="text-[11px] text-blue-600 hover:underline">
                      URL복사
                    </button>
                    <button onClick={() => remove(m.id)} className="text-[11px] text-rose-500 hover:underline">
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
