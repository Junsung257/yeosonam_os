'use client';

import { useState } from 'react';
import {
  MousePointerClick, UserPlus, TrendingUp, ExternalLink,
  Copy, Trash2, MoreVertical, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';

// ─── Mock 데이터 ──────────────────────────────────────────────────────────────

interface CampaignLink {
  id: string;
  name: string;
  productLabel: string;
  url: string;
  source: 'insta' | 'kakao' | 'blog' | 'offline' | 'youtube' | 'naver';
  clicks: number;
  leads: number;
  createdAt: string;
  trend: 'up' | 'down' | 'flat';
  trendPct: number;
}

const MOCK_LINKS: CampaignLink[] = [
  {
    id: '1', name: '장가계 인스타 여름 특가',
    productLabel: '장가계 5박 6일 특가 (6/5)',
    url: 'https://yeosonam.com/lp/jangjiajie-special-0605?source=insta&utm_campaign=summer_sale_2026',
    source: 'insta', clicks: 3241, leads: 187, createdAt: '2026-03-01', trend: 'up', trendPct: 24,
  },
  {
    id: '2', name: '장가계 카카오 봄 프로모',
    productLabel: '장가계 5박 6일 특가 (6/5)',
    url: 'https://yeosonam.com/lp/jangjiajie-special-0605?source=kakao&utm_campaign=spring_promo',
    source: 'kakao', clicks: 1890, leads: 214, createdAt: '2026-03-05', trend: 'up', trendPct: 11,
  },
  {
    id: '3', name: '봉황고성 블로그 SEO',
    productLabel: '봉황고성 4박 5일 (6/12)',
    url: 'https://yeosonam.com/lp/phoenix-tour-0612?source=blog&utm_campaign=seo_blog',
    source: 'blog', clicks: 892, leads: 41, createdAt: '2026-03-10', trend: 'flat', trendPct: 0,
  },
  {
    id: '4', name: '계림 오프라인 전단지',
    productLabel: '계림 황산 5박 6일 (6/20)',
    url: 'https://yeosonam.com/lp/guilin-summer-0620?source=offline&utm_campaign=leaflet_gangnam',
    source: 'offline', clicks: 340, leads: 28, createdAt: '2026-03-12', trend: 'down', trendPct: 8,
  },
  {
    id: '5', name: '장가계 파트너A 협업',
    productLabel: '장가계 5박 6일 특가 (6/5)',
    url: 'https://yeosonam.com/lp/jangjiajie-special-0605?source=insta&ref=partner_001',
    source: 'insta', clicks: 1104, leads: 93, createdAt: '2026-03-14', trend: 'up', trendPct: 38,
  },
];

const SOURCE_META: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  insta:   { label: '인스타그램', color: 'text-pink-700',   bg: 'bg-pink-50',   dot: 'bg-pink-500' },
  kakao:   { label: '카카오톡',   color: 'text-yellow-700', bg: 'bg-yellow-50', dot: 'bg-yellow-500' },
  blog:    { label: '블로그',     color: 'text-green-700',  bg: 'bg-green-50',  dot: 'bg-green-500' },
  offline: { label: '오프라인',   color: 'text-gray-700',   bg: 'bg-gray-100',  dot: 'bg-gray-500' },
  youtube: { label: '유튜브',     color: 'text-red-700',    bg: 'bg-red-50',    dot: 'bg-red-500' },
  naver:   { label: '네이버',     color: 'text-emerald-700',bg: 'bg-emerald-50',dot: 'bg-emerald-500' },
};

function cvr(clicks: number, leads: number) {
  if (!clicks) return '0.0';
  return ((leads / clicks) * 100).toFixed(1);
}

function fmt(n: number) {
  return n >= 10000 ? `${(n / 10000).toFixed(1)}만` : n.toLocaleString();
}

// ─── KPI 집계 ─────────────────────────────────────────────────────────────────

function getKpi(links: CampaignLink[]) {
  const totalClicks = links.reduce((s, l) => s + l.clicks, 0);
  const totalLeads  = links.reduce((s, l) => s + l.leads, 0);
  const cvrPct = totalClicks ? ((totalLeads / totalClicks) * 100).toFixed(1) : '0.0';
  return { totalClicks, totalLeads, cvrPct };
}

// ─── 채널별 집계 ──────────────────────────────────────────────────────────────

function getChannelStats(links: CampaignLink[]) {
  const map: Record<string, { clicks: number; leads: number }> = {};
  for (const l of links) {
    if (!map[l.source]) map[l.source] = { clicks: 0, leads: 0 };
    map[l.source].clicks += l.clicks;
    map[l.source].leads  += l.leads;
  }
  const maxClicks = Math.max(...Object.values(map).map(v => v.clicks), 1);
  return Object.entries(map)
    .map(([source, v]) => ({ source, ...v, pct: Math.round((v.clicks / maxClicks) * 100) }))
    .sort((a, b) => b.clicks - a.clicks);
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function AnalyticsDashboard() {
  const [links, setLinks] = useState<CampaignLink[]>(MOCK_LINKS);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  const { totalClicks, totalLeads, cvrPct } = getKpi(links);
  const channelStats = getChannelStats(links);

  const handleCopy = async (link: CampaignLink) => {
    await navigator.clipboard.writeText(link.url).catch(() => null);
    setCopiedId(link.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = (id: string) => {
    setLinks(prev => prev.filter(l => l.id !== id));
    setMenuId(null);
  };

  return (
    <div className="space-y-8">
      {/* ── KPI 카드 3종 ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <KpiCard
          icon={<MousePointerClick className="w-6 h-6 text-blue-600" />}
          bg="bg-blue-50"
          label="누적 방문자 수"
          value={fmt(totalClicks)}
          sub="Total Clicks"
          highlight="text-blue-700"
        />
        <KpiCard
          icon={<UserPlus className="w-6 h-6 text-emerald-600" />}
          bg="bg-emerald-50"
          label="리드 발생 수"
          value={fmt(totalLeads)}
          sub="Generated Leads"
          highlight="text-emerald-700"
        />
        <KpiCard
          icon={<TrendingUp className="w-6 h-6 text-violet-600" />}
          bg="bg-violet-50"
          label="최종 전환율"
          value={`${cvrPct}%`}
          sub="CVR (Leads / Clicks)"
          highlight="text-violet-700"
        />
      </div>

      {/* ── 채널별 성과 비교 ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-gray-900">채널별 유입 성과 비교</h3>
          <span className="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full font-medium">
            클릭 수 기준
          </span>
        </div>
        <div className="space-y-4">
          {channelStats.map(ch => {
            const meta = SOURCE_META[ch.source] ?? SOURCE_META.offline;
            const chCvr = ch.clicks ? ((ch.leads / ch.clicks) * 100).toFixed(1) : '0.0';
            return (
              <div key={ch.source}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                    <span className="text-sm font-semibold text-gray-800">{meta.label}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>
                      CVR {chCvr}%
                    </span>
                  </div>
                  <div className="text-sm font-bold text-gray-700 tabular-nums">
                    {ch.clicks.toLocaleString()} 클릭 · {ch.leads.toLocaleString()} 리드
                  </div>
                </div>
                {/* 더블 프로그레스 바 */}
                <div className="relative h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`absolute left-0 top-0 h-full rounded-full transition-all duration-700 ${meta.dot}`}
                    style={{ width: `${ch.pct}%`, opacity: 0.25 }}
                  />
                  <div
                    className={`absolute left-0 top-0 h-full rounded-full transition-all duration-700 ${meta.dot}`}
                    style={{ width: `${Math.round((ch.leads / Math.max(...channelStats.map(c => c.leads), 1)) * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-xs text-gray-400">클릭 (연하게)</span>
                  <span className="text-xs text-gray-400">리드 전환 (진하게)</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 캠페인 링크 테이블 ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">생성된 캠페인 링크</h3>
          <span className="text-sm text-gray-400">{links.length}개</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-6 py-4 text-left font-semibold">캠페인명</th>
                <th className="px-6 py-4 text-left font-semibold">채널</th>
                <th className="px-6 py-4 text-right font-semibold">클릭</th>
                <th className="px-6 py-4 text-right font-semibold">리드</th>
                <th className="px-6 py-4 text-right font-semibold">CVR</th>
                <th className="px-6 py-4 text-right font-semibold">추이</th>
                <th className="px-6 py-4 text-center font-semibold">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {links.map(link => {
                const meta = SOURCE_META[link.source] ?? SOURCE_META.offline;
                const linkCvr = cvr(link.clicks, link.leads);
                return (
                  <tr key={link.id} className="hover:bg-gray-50 transition group">
                    <td className="px-6 py-5">
                      <p className="text-base font-semibold text-gray-900 leading-snug">{link.name}</p>
                      <p className="text-sm text-gray-400 mt-0.5">{link.productLabel}</p>
                    </td>
                    <td className="px-6 py-5">
                      <span className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full ${meta.bg} ${meta.color}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-right text-lg font-bold text-gray-800 tabular-nums">
                      {link.clicks.toLocaleString()}
                    </td>
                    <td className="px-6 py-5 text-right text-lg font-bold text-gray-800 tabular-nums">
                      {link.leads.toLocaleString()}
                    </td>
                    <td className="px-6 py-5 text-right">
                      <span className={`text-lg font-bold tabular-nums ${
                        parseFloat(linkCvr) >= 5 ? 'text-emerald-600'
                          : parseFloat(linkCvr) >= 3 ? 'text-blue-600'
                          : 'text-gray-500'
                      }`}>
                        {linkCvr}%
                      </span>
                    </td>
                    <td className="px-6 py-5 text-right">
                      {link.trend === 'up' && (
                        <span className="inline-flex items-center gap-0.5 text-sm font-semibold text-emerald-600">
                          <ArrowUpRight size={16} />+{link.trendPct}%
                        </span>
                      )}
                      {link.trend === 'down' && (
                        <span className="inline-flex items-center gap-0.5 text-sm font-semibold text-red-500">
                          <ArrowDownRight size={16} />-{link.trendPct}%
                        </span>
                      )}
                      {link.trend === 'flat' && (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* 링크 열기 */}
                        <ActionBtn
                          label="열기"
                          icon={<ExternalLink size={15} />}
                          onClick={() => window.open(link.url, '_blank')}
                          color="hover:bg-blue-50 hover:text-blue-600"
                        />
                        {/* 복사 */}
                        <ActionBtn
                          label={copiedId === link.id ? '복사됨' : '복사'}
                          icon={<Copy size={15} />}
                          onClick={() => handleCopy(link)}
                          color={copiedId === link.id ? 'bg-green-50 text-green-600' : 'hover:bg-gray-100 hover:text-gray-700'}
                        />
                        {/* 더보기 메뉴 */}
                        <div className="relative">
                          <ActionBtn
                            label=""
                            icon={<MoreVertical size={15} />}
                            onClick={() => setMenuId(menuId === link.id ? null : link.id)}
                            color="hover:bg-gray-100"
                          />
                          {menuId === link.id && (
                            <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-xl py-1 w-32">
                              <button
                                onClick={() => handleDelete(link.id)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition"
                              >
                                <Trash2 size={14} /> 삭제
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {links.length === 0 && (
          <div className="py-16 text-center text-gray-400">
            <p className="text-lg">아직 생성된 캠페인 링크가 없습니다.</p>
            <p className="text-sm mt-1">우측 상단 [새 링크 만들기] 버튼을 눌러 시작하세요.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 서브 컴포넌트 ────────────────────────────────────────────────────────────

function KpiCard({ icon, bg, label, value, sub, highlight }: {
  icon: React.ReactNode; bg: string; label: string;
  value: string; sub: string; highlight: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 flex items-start gap-4">
      <div className={`${bg} rounded-xl p-3 shrink-0`}>{icon}</div>
      <div>
        <p className="text-sm text-gray-500 font-medium">{label}</p>
        <p className={`text-3xl font-extrabold mt-0.5 tabular-nums ${highlight}`}>{value}</p>
        <p className="text-xs text-gray-400 mt-1">{sub}</p>
      </div>
    </div>
  );
}

function ActionBtn({ label, icon, onClick, color }: {
  label: string; icon: React.ReactNode; onClick: () => void; color: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 transition ${color}`}
    >
      {icon}
      {label && <span className="hidden sm:inline">{label}</span>}
    </button>
  );
}
