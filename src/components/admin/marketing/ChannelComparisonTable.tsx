'use client';

/**
 * 채널별 광고 성과 비교 테이블
 *
 * Google Ads / Naver Ads / Meta Ads / Organic / Direct 채널을 한눈에 비교.
 * 데이터는 서버 API(/api/admin/marketing/channel-performance)에서 조회.
 */

interface ChannelRow {
  channel: string;
  channelLabel: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  conversions: number;
  revenue: number;
  roas: number;
  prevSpend?: number;
  prevRevenue?: number;
}

interface ChannelComparisonTableProps {
  data: ChannelRow[];
  loading?: boolean;
}

function deltaArrow(current: number, previous?: number): { arrow: string; color: string; pct: number } | null {
  if (previous === undefined || previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  const absPct = Math.abs(pct);
  return {
    arrow: pct >= 0 ? '▲' : '▼',
    color: pct >= 0 ? 'text-emerald-600' : 'text-red-500',
    pct: absPct,
  };
}

function formatWon(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (v >= 10_000) return `${(v / 10000).toFixed(0)}만`;
  return v.toLocaleString('ko-KR');
}

const CHANNEL_COLORS: Record<string, string> = {
  google: 'text-blue-600',
  naver: 'text-emerald-600',
  meta: 'text-indigo-600',
  organic: 'text-amber-600',
  direct: 'text-slate-600',
};

const CHANNEL_BG: Record<string, string> = {
  google: 'bg-blue-50',
  naver: 'bg-emerald-50',
  meta: 'bg-indigo-50',
  organic: 'bg-amber-50',
  direct: 'bg-slate-50',
};

export default function ChannelComparisonTable({ data, loading }: ChannelComparisonTableProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-admin-md border border-admin-border-mid p-4 animate-pulse space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 bg-admin-surface-2 rounded" />
        ))}
      </div>
    );
  }

  const totalSpend = data.reduce((s, r) => s + r.spend, 0);
  const totalRevenue = data.reduce((s, r) => s + r.revenue, 0);
  const totalConversions = data.reduce((s, r) => s + r.conversions, 0);
  const blendedRoas = totalSpend > 0 ? (totalRevenue / totalSpend) * 100 : 0;

  return (
    <div>
      {/* 통합 Blended KPI */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-admin-bg rounded-lg p-3 border border-admin-border-mid">
          <p className="text-[11px] text-admin-muted font-medium uppercase tracking-wide">Total Spend</p>
          <p className="text-lg font-bold text-admin-text-2">{formatWon(totalSpend)}</p>
        </div>
        <div className="bg-admin-bg rounded-lg p-3 border border-admin-border-mid">
          <p className="text-[11px] text-admin-muted font-medium uppercase tracking-wide">Total Revenue</p>
          <p className="text-lg font-bold text-admin-text-2">{formatWon(totalRevenue)}</p>
        </div>
        <div className="bg-admin-bg rounded-lg p-3 border border-admin-border-mid">
          <p className="text-[11px] text-admin-muted font-medium uppercase tracking-wide">Blended ROAS</p>
          <p className="text-lg font-bold text-emerald-600">{blendedRoas.toFixed(1)}%</p>
        </div>
      </div>

      {/* 채널 비교 테이블 */}
      <div className="overflow-x-auto">
        <table className="w-full text-admin-sm">
          <thead>
            <tr className="border-b border-admin-border-mid">
              <th className="px-3 py-2 text-left text-[11px] font-medium text-admin-muted">채널</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium text-admin-muted">Spend</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium text-admin-muted">Imp.</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium text-admin-muted">Clicks</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium text-admin-muted">CTR</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium text-admin-muted">CPC</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium text-admin-muted">Conv.</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium text-admin-muted">Revenue</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium text-admin-muted">ROAS</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium text-admin-muted">전월比</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const moDelta = deltaArrow(row.spend, row.prevSpend);
              const color = CHANNEL_COLORS[row.channel] ?? 'text-admin-muted';
              const bg = CHANNEL_BG[row.channel] ?? 'bg-admin-surface-2';
              return (
                <tr key={row.channel} className="border-b border-admin-border-mid hover:bg-admin-bg">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${bg} border border-current ${color}`} />
                      <span className="font-medium text-admin-text-2">{row.channelLabel}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{formatWon(row.spend)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.impressions.toLocaleString('ko-KR')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.clicks.toLocaleString('ko-KR')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.ctr.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatWon(Math.round(row.cpc))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.conversions.toLocaleString('ko-KR')}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{formatWon(row.revenue)}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={`text-[11px] font-semibold ${row.roas >= 200 ? 'text-emerald-600' : row.roas >= 100 ? 'text-amber-600' : 'text-red-500'}`}>
                      {row.roas.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {moDelta ? (
                      <span className={`text-[11px] font-semibold ${moDelta.color}`}>
                        {moDelta.arrow} {moDelta.pct.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-admin-muted-2">--</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data.length === 0 && (
        <div className="p-8 text-center">
          <p className="text-admin-sm text-admin-muted-2">채널 성과 데이터가 없습니다.</p>
        </div>
      )}
    </div>
  );
}
