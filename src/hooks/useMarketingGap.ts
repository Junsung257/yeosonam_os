/**
 * 마케팅 데이터 갭 보정 훅
 *
 * 실제 DB에 데이터가 부족한 경우, Mock/시뮬레이션 데이터를 반환하여
 * 대시보드가 항상 의미 있는 UI를 보여줄 수 있도록 합니다.
 *
 * 프로덕션 환경에서는 이 훅을 제거하거나 Mock 반환을 비활성화합니다.
 */

import { useState, useEffect, useCallback } from 'react';

export interface ChannelPerformance {
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

export interface FunnelStep {
  label: string;
  count: number;
  rate: number;
}

export interface TrendPoint {
  date: string;
  google_spend: number;
  google_revenue: number;
  naver_spend: number;
  naver_revenue: number;
  meta_spend: number;
  meta_revenue: number;
  organic_revenue: number;
}

export interface MarketingDashboardData {
  channels: ChannelPerformance[];
  funnel: FunnelStep[];
  trends: TrendPoint[];
  totalSpend: number;
  totalConversions: number;
  attributedRevenue: number;
  blendedRoas: number;
  avgCpa: number;
  prevTotalSpend?: number;
  prevTotalRevenue?: number;
}

/** 30일간의 일별 Mock 데이터 생성 */
function generateMockTrends(): TrendPoint[] {
  const days: TrendPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    days.push({
      date: dateStr,
      google_spend: Math.round(50000 + Math.random() * 80000),
      google_revenue: Math.round(150000 + Math.random() * 400000),
      naver_spend: Math.round(30000 + Math.random() * 60000),
      naver_revenue: Math.round(100000 + Math.random() * 300000),
      meta_spend: Math.round(40000 + Math.random() * 70000),
      meta_revenue: Math.round(80000 + Math.random() * 200000),
      organic_revenue: Math.round(50000 + Math.random() * 150000),
    });
  }
  return days;
}

/** Mock 채널 데이터 */
function generateMockChannels(): ChannelPerformance[] {
  return [
    { channel: 'google', channelLabel: 'Google Ads', spend: 2180000, impressions: 145000, clicks: 3200, ctr: 2.21, cpc: 681, conversions: 48, revenue: 8200000, roas: 376, prevSpend: 1950000, prevRevenue: 7600000 },
    { channel: 'naver', channelLabel: 'Naver Ads', spend: 1650000, impressions: 98000, clicks: 2100, ctr: 2.14, cpc: 786, conversions: 32, revenue: 5600000, roas: 339, prevSpend: 1480000, prevRevenue: 5100000 },
    { channel: 'meta', channelLabel: 'Meta Ads', spend: 1950000, impressions: 220000, clicks: 4100, ctr: 1.86, cpc: 476, conversions: 28, revenue: 4300000, roas: 221, prevSpend: 1780000, prevRevenue: 3900000 },
    { channel: 'organic', channelLabel: 'Organic', spend: 0, impressions: 0, clicks: 15000, ctr: 0, cpc: 0, conversions: 85, revenue: 12000000, roas: 0, prevRevenue: 10800000 },
    { channel: 'direct', channelLabel: 'Direct', spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, conversions: 12, revenue: 1800000, roas: 0, prevRevenue: 1500000 },
  ];
}

/** Mock 퍼널 */
function generateMockFunnel(): FunnelStep[] {
  return [
    { label: 'Impression', count: 463000, rate: 100 },
    { label: 'Click', count: 9400, rate: 2.03 },
    { label: 'Page View', count: 8200, rate: 87.23 },
    { label: 'Checkout', count: 310, rate: 3.78 },
    { label: 'Booking', count: 185, rate: 59.68 },
    { label: 'Payment Complete', count: 172, rate: 92.97 },
  ];
}

export function useMarketingGap(dataEnabled: boolean): {
  dashboardData: MarketingDashboardData | null;
  loading: boolean;
  refresh: () => void;
} {
  const [dashboardData, setDashboardData] = useState<MarketingDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 실제 API 호출
      const res = await fetch('/api/admin/marketing/dashboard');
      if (res.ok) {
        const json = await res.json();
        if (json.data && json.data.channels?.length > 0) {
          setDashboardData(json.data);
          setLoading(false);
          return;
        }
      }
    } catch {
      // API 실패 → Mock 데이터 사용
    }

    // 데이터가 없거나 API 실패 시 Mock 데이터 제공
    const channels = generateMockChannels();
    const trends = generateMockTrends();
    const funnel = generateMockFunnel();

    const totalSpend = channels.reduce((s, c) => s + c.spend, 0);
    const totalConversions = channels.reduce((s, c) => s + c.conversions, 0);
    const attributedRevenue = channels.reduce((s, c) => s + c.revenue, 0);
    const blendedRoas = totalSpend > 0 ? (attributedRevenue / totalSpend) * 100 : 0;
    const avgCpa = totalConversions > 0 ? totalSpend / totalConversions : 0;

    const prevTotalSpend = channels.reduce((s, c) => s + (c.prevSpend ?? 0), 0);
    const prevTotalRevenue = channels.reduce((s, c) => s + (c.prevRevenue ?? c.revenue), 0);

    setDashboardData({
      channels,
      funnel,
      trends,
      totalSpend,
      totalConversions,
      attributedRevenue,
      blendedRoas,
      avgCpa,
      prevTotalSpend,
      prevTotalRevenue,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { dashboardData, loading, refresh: fetchData };
}
