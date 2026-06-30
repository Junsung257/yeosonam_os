import { useCallback, useEffect, useState } from 'react';

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

export type MarketingDashboardStatus = 'ready' | 'empty' | 'degraded' | 'disabled';

const EMPTY_MARKETING_DASHBOARD_DATA: MarketingDashboardData = {
  channels: [],
  funnel: [],
  trends: [],
  totalSpend: 0,
  totalConversions: 0,
  attributedRevenue: 0,
  blendedRoas: 0,
  avgCpa: 0,
  prevTotalSpend: 0,
  prevTotalRevenue: 0,
};

export function useMarketingGap(dataEnabled: boolean): {
  dashboardData: MarketingDashboardData | null;
  loading: boolean;
  status: MarketingDashboardStatus;
  message: string | null;
  degraded: boolean;
  refresh: () => void;
} {
  const [dashboardData, setDashboardData] = useState<MarketingDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<MarketingDashboardStatus>('empty');
  const [message, setMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!dataEnabled) {
      setDashboardData(EMPTY_MARKETING_DASHBOARD_DATA);
      setStatus('disabled');
      setMessage('Marketing dashboard data loading is disabled.');
      setLoading(false);
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch('/api/admin/marketing/dashboard', { signal: controller.signal });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setDashboardData(EMPTY_MARKETING_DASHBOARD_DATA);
        setStatus('degraded');
        setMessage(json.error ?? `Marketing dashboard API returned HTTP ${res.status}.`);
        return;
      }

      if (json.data) {
        const hasRows = Array.isArray(json.data.channels) && json.data.channels.length > 0;
        setDashboardData(json.data);
        setStatus(json.degraded || json.mock ? 'degraded' : hasRows ? 'ready' : 'empty');
        setMessage(json.message ?? (hasRows ? null : 'No marketing performance rows are available yet.'));
        return;
      }

      setDashboardData(EMPTY_MARKETING_DASHBOARD_DATA);
      setStatus(json.degraded || json.mock ? 'degraded' : 'empty');
      setMessage(json.message ?? 'No marketing performance rows are available yet.');
    } catch (err) {
      setDashboardData(EMPTY_MARKETING_DASHBOARD_DATA);
      setStatus('degraded');
      setMessage(err instanceof DOMException && err.name === 'AbortError'
        ? 'Marketing dashboard API timed out.'
        : 'Marketing dashboard API is unavailable.');
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }, [dataEnabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    dashboardData,
    loading,
    status,
    message,
    degraded: status === 'degraded',
    refresh: fetchData,
  };
}
