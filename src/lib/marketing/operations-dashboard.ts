export type MarketingChannelKey = 'google' | 'naver' | 'meta' | 'kakao';
export type MarketingChannelState = 'operating' | 'draft_only' | 'setup_needed' | 'blocked' | 'stale';
export type MarketingMetricState = 'collected' | 'not_collected' | 'stale';

export interface MarketingMetric {
  value: number | null;
  state: MarketingMetricState;
  label: string;
  description: string;
}

export interface MarketingDashboardInput {
  days: number;
  collectedAt: string;
  trafficCount: number;
  latestTrackingAt: string | null;
  traffic: TrafficRow[];
  engagements: EngagementRow[];
  leads: LeadRow[];
  bookings: BookingRow[];
  settledBookings: BookingRow[];
  campaigns: CampaignRow[];
  performance: PerformanceRow[];
  channelHealth: ChannelHealthRow[];
  accounts: AccountRow[];
  recommendations: RecommendationRow[];
  creatives: CreativeRow[];
  distributions: DistributionRow[];
}

export interface TrafficRow {
  source: string | null;
  medium: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  fbclid: string | null;
  n_keyword: string | null;
  created_at: string;
}

export interface EngagementRow {
  event_type: string;
  event_source: string | null;
  created_at: string;
}

export interface LeadRow {
  utm_source: string | null;
  channel: string | null;
  created_at: string | null;
  submitted_at: string | null;
}

export interface BookingRow {
  id: string;
  utm_source: string | null;
  channel_source: string | null;
  status: string | null;
  payment_status: string | null;
  margin: number | null;
  settlement_confirmed_at: string | null;
  created_at: string | null;
}

export interface CampaignRow {
  id: string;
  name: string;
  channel: string | null;
  status: string | null;
  daily_budget_krw: number | null;
  meta_campaign_id: string | null;
  naver_campaign_id: string | null;
  google_campaign_id: string | null;
  updated_at: string | null;
}

export interface PerformanceRow {
  campaign_id: string;
  snapshot_date: string;
  impressions: number | null;
  clicks: number | null;
  spend_krw: number | null;
  attributed_bookings: number | null;
  attributed_margin: number | null;
}

export interface ChannelHealthRow {
  platform: string;
  adapter_state: string;
  credentials_ready: boolean;
  permission_ready: boolean;
  campaign_ready: boolean;
  budget_ready: boolean;
  conversion_ready: boolean;
  live_publish_enabled: boolean;
  external_api_write: boolean;
  recommended_action: string;
  checked_at: string;
}

export interface AccountRow {
  platform: string;
  connection_status: string;
  external_account_id: string | null;
  external_campaign_id: string | null;
  last_probe_at: string | null;
  risk_status: string;
}

export interface RecommendationRow {
  id: string;
  severity: string;
  title: string;
  reason: string;
  action_url: string;
  action_label: string;
  status: string;
  updated_at: string;
}

export interface CreativeRow {
  status: string | null;
  channel: string;
  published_at: string | null;
  created_at: string | null;
}

export interface DistributionRow {
  platform: string;
  status: string;
  published_at: string | null;
  scheduled_for: string | null;
  updated_at: string | null;
  error_message: string | null;
}

const CHANNELS: Array<{ key: MarketingChannelKey; label: string; settingsHref: string }> = [
  { key: 'google', label: '구글 광고', settingsHref: '/admin/ad-os?channel=google' },
  { key: 'naver', label: '네이버 광고', settingsHref: '/admin/ad-os?channel=naver' },
  { key: 'meta', label: '메타 광고', settingsHref: '/admin/marketing/social-configs' },
  { key: 'kakao', label: '카카오 광고', settingsHref: '/admin/ad-os?channel=kakao' },
];

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function numberOrZero(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

export function normalizeMarketingChannel(value: string | null | undefined): MarketingChannelKey | 'other' {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized.includes('google') || normalized === 'g') return 'google';
  if (normalized.includes('naver') || normalized.includes('네이버')) return 'naver';
  if (
    normalized.includes('meta') ||
    normalized.includes('facebook') ||
    normalized.includes('instagram') ||
    normalized.includes('인스타')
  ) return 'meta';
  if (normalized.includes('kakao') || normalized.includes('카카오')) return 'kakao';
  return 'other';
}

function latestByPlatform<T extends { platform: string; checked_at?: string; last_probe_at?: string | null }>(
  rows: T[],
): Map<MarketingChannelKey, T> {
  const result = new Map<MarketingChannelKey, T>();
  const sorted = [...rows].sort((a, b) => {
    const aAt = a.checked_at ?? a.last_probe_at ?? '';
    const bAt = b.checked_at ?? b.last_probe_at ?? '';
    return bAt.localeCompare(aAt);
  });
  for (const row of sorted) {
    const key = normalizeMarketingChannel(row.platform);
    if (key !== 'other' && !result.has(key)) result.set(key, row);
  }
  return result;
}

function channelState(
  health: ChannelHealthRow | undefined,
  account: AccountRow | undefined,
  collectedAt: string,
): { state: MarketingChannelState; label: string; reason: string; nextAction: string } {
  if (!health) {
    return {
      state: 'setup_needed',
      label: '연결 필요',
      reason: '최근 연결 점검 기록이 없습니다.',
      nextAction: '광고 계정 연결 상태를 확인하세요.',
    };
  }

  const checkedAt = new Date(health.checked_at).getTime();
  const now = new Date(collectedAt).getTime();
  if (!Number.isFinite(checkedAt) || now - checkedAt > STALE_AFTER_MS) {
    return {
      state: 'stale',
      label: '점검 필요',
      reason: '채널 연결 점검이 하루 이상 갱신되지 않았습니다.',
      nextAction: '연결 점검을 다시 실행하세요.',
    };
  }

  if (!health.credentials_ready || !health.permission_ready) {
    return {
      state: 'blocked',
      label: '연결 막힘',
      reason: '계정 정보 또는 권한이 준비되지 않았습니다.',
      nextAction: health.recommended_action || '계정 정보와 권한을 확인하세요.',
    };
  }

  const hasExternalAccount = Boolean(account?.external_account_id);
  if (
    health.external_api_write &&
    health.live_publish_enabled &&
    health.campaign_ready &&
    hasExternalAccount
  ) {
    return {
      state: 'operating',
      label: '운영 중',
      reason: '외부 광고 계정과 실시간 발행이 확인되었습니다.',
      nextAction: '성과와 예산을 확인하세요.',
    };
  }

  if (health.campaign_ready) {
    return {
      state: 'draft_only',
      label: '초안만 가능',
      reason: '캠페인 준비는 됐지만 외부 광고 발행은 아직 꺼져 있습니다.',
      nextAction: health.recommended_action || '시험 전환과 승인 절차를 마치세요.',
    };
  }

  return {
    state: 'setup_needed',
    label: '설정 필요',
    reason: '실제 광고 캠페인이 연결되지 않았습니다.',
    nextAction: health.recommended_action || '광고 캠페인을 연결하세요.',
  };
}

function metric(
  label: string,
  value: number | null,
  state: MarketingMetricState,
  description: string,
): MarketingMetric {
  return { label, value, state, description };
}

function countByChannel<T>(
  rows: T[],
  readSource: (row: T) => string | null | undefined,
): Map<MarketingChannelKey, number> {
  const counts = new Map<MarketingChannelKey, number>();
  for (const row of rows) {
    const channel = normalizeMarketingChannel(readSource(row));
    if (channel === 'other') continue;
    counts.set(channel, (counts.get(channel) ?? 0) + 1);
  }
  return counts;
}

function plainRecommendation(item: RecommendationRow): RecommendationRow {
  const known: Record<string, Pick<RecommendationRow, 'title' | 'reason' | 'action_label'>> = {
    'No published blog asset': {
      title: '공개 블로그 글이 없습니다.',
      reason: '검색 유입과 상품 소개에 연결할 공개 블로그 글을 먼저 준비하세요.',
      action_label: '블로그 작성 시작',
    },
    'No ad campaign draft': {
      title: '광고 캠페인 초안이 없습니다.',
      reason: '이 상품에 연결된 구글·네이버·메타 광고 초안을 준비하세요.',
      action_label: '캠페인 초안 만들기',
    },
    'No card news asset': {
      title: '카드뉴스가 없습니다.',
      reason: '인스타그램과 Threads에 활용할 상품 카드뉴스를 준비하세요.',
      action_label: '카드뉴스 만들기',
    },
  };
  const replacement = known[item.title];
  if (!replacement) return item;
  return { ...item, ...replacement };
}

export function buildMarketingOperationsDashboard(input: MarketingDashboardInput) {
  const latestHealth = latestByPlatform(input.channelHealth);
  const latestAccounts = latestByPlatform(input.accounts);
  const campaignById = new Map(input.campaigns.map((campaign) => [campaign.id, campaign]));
  const performanceByChannel = new Map<
    MarketingChannelKey,
    { impressions: number; clicks: number; spend: number; bookings: number; margin: number; rows: number }
  >();

  for (const row of input.performance) {
    const campaign = campaignById.get(row.campaign_id);
    const channel = normalizeMarketingChannel(campaign?.channel);
    if (channel === 'other') continue;
    const current = performanceByChannel.get(channel) ?? {
      impressions: 0,
      clicks: 0,
      spend: 0,
      bookings: 0,
      margin: 0,
      rows: 0,
    };
    current.impressions += numberOrZero(row.impressions);
    current.clicks += numberOrZero(row.clicks);
    current.spend += numberOrZero(row.spend_krw);
    current.bookings += numberOrZero(row.attributed_bookings);
    current.margin += numberOrZero(row.attributed_margin);
    current.rows += 1;
    performanceByChannel.set(channel, current);
  }

  const activeBookings = input.bookings.filter((booking) => booking.status !== 'cancelled');
  const paidBookings = activeBookings.filter((booking) => booking.payment_status === '완납');
  const attributedBookings = activeBookings.filter((booking) =>
    normalizeMarketingChannel(booking.utm_source ?? booking.channel_source) !== 'other',
  );
  const bookingCounts = countByChannel(
    attributedBookings,
    (booking) => booking.utm_source ?? booking.channel_source,
  );
  const leadCounts = countByChannel(input.leads, (lead) => lead.utm_source ?? lead.channel);
  const campaignCounts = countByChannel(input.campaigns, (campaign) => campaign.channel);

  const channels = CHANNELS.map((channel) => {
    const health = latestHealth.get(channel.key);
    const account = latestAccounts.get(channel.key);
    const status = channelState(health, account, input.collectedAt);
    const performance = performanceByChannel.get(channel.key);
    return {
      channel: channel.key,
      channelLabel: channel.label,
      status: status.state,
      statusLabel: status.label,
      reason: status.reason,
      nextAction: status.nextAction,
      settingsHref: channel.settingsHref,
      lastCheckedAt: health?.checked_at ?? account?.last_probe_at ?? null,
      campaigns: campaignCounts.get(channel.key) ?? 0,
      inquiries: leadCounts.get(channel.key) ?? 0,
      conversions: bookingCounts.get(channel.key) ?? 0,
      spend: performance ? performance.spend : null,
      impressions: performance ? performance.impressions : null,
      clicks: performance ? performance.clicks : null,
      attributedMargin: performance ? performance.margin : null,
      performanceState: performance ? 'collected' as const : 'not_collected' as const,
    };
  });

  const totalSpend = input.performance.length > 0
    ? input.performance.reduce((sum, row) => sum + numberOrZero(row.spend_krw), 0)
    : null;
  const providerMargin = input.performance.length > 0
    ? input.performance.reduce((sum, row) => sum + numberOrZero(row.attributed_margin), 0)
    : null;
  const confirmedMargin = input.settledBookings
    .reduce((sum, booking) => sum + numberOrZero(booking.margin), 0);
  const costPerBooking = totalSpend === null || attributedBookings.length === 0
    ? null
    : totalSpend / attributedBookings.length;
  const marginReturnRate = totalSpend === null || totalSpend <= 0 || providerMargin === null
    ? null
    : (providerMargin / totalSpend) * 100;

  const latestTrackingAt = input.latestTrackingAt;
  const latestProviderAt = input.performance
    .map((row) => row.snapshot_date)
    .sort()
    .at(-1) ?? null;
  const staleChannels = channels.filter((channel) => channel.status === 'stale');
  const blockedChannels = channels.filter((channel) =>
    channel.status === 'blocked' || channel.status === 'setup_needed',
  );
  const unresolvedRecommendations = input.recommendations
    .filter((item) => item.status === 'open' || item.status === 'pending')
    .map(plainRecommendation)
    .map((item) => ({
      ...item,
      action_url: item.action_url.startsWith('/admin/')
        ? item.action_url
        : '/admin/marketing/command-center',
    }))
    .slice(0, 5);

  const issues = [
    ...(input.performance.length === 0 ? [{
      id: 'provider-performance-missing',
      priority: '긴급',
      title: '광고비와 노출·클릭을 아직 수집하지 못하고 있습니다.',
      detail: '광고사 성과 자료가 0건이라 비용 대비 성과를 계산할 수 없습니다.',
      actionLabel: '채널 연결 확인',
      actionHref: '/admin/marketing/system-health',
    }] : []),
    ...staleChannels.slice(0, 1).map((channel) => ({
      id: `stale-${channel.channel}`,
      priority: '긴급',
      title: `${channel.channelLabel} 점검 기록이 오래됐습니다.`,
      detail: channel.reason,
      actionLabel: '연결 다시 점검',
      actionHref: channel.settingsHref,
    })),
    ...blockedChannels.slice(0, 1).map((channel) => ({
      id: `blocked-${channel.channel}`,
      priority: '중요',
      title: `${channel.channelLabel} 운영을 시작할 수 없습니다.`,
      detail: channel.nextAction,
      actionLabel: '설정 열기',
      actionHref: channel.settingsHref,
    })),
    ...(latestTrackingAt === null ? [{
      id: 'tracking-empty',
      priority: '긴급',
      title: '사이트 방문 기록이 들어오지 않습니다.',
      detail: '유입 추적 저장과 데이터베이스 연결을 확인해야 합니다.',
      actionLabel: '시스템 상태 확인',
      actionHref: '/admin/marketing/system-health',
    }] : []),
  ].slice(0, 3);

  const trackedVisits = input.trafficCount;
  const productViews = input.engagements.filter((row) =>
    row.event_type === 'product_view' || row.event_type === 'page_view',
  ).length;
  const checkoutStarts = input.engagements.filter((row) => row.event_type === 'checkout_start').length;
  const funnelCounts = [
    { label: '추적 방문', count: trackedVisits },
    { label: '상품 조회', count: productViews },
    { label: '문의 접수', count: input.leads.length },
    { label: '예약', count: activeBookings.length },
    { label: '완납', count: paidBookings.length },
  ];
  const funnel = funnelCounts.map((step, index) => ({
    ...step,
    rate: index === 0
      ? (step.count > 0 ? 100 : 0)
      : funnelCounts[index - 1].count > 0
        ? (step.count / funnelCounts[index - 1].count) * 100
        : 0,
  }));

  const publishedCreatives = input.creatives.filter((creative) => creative.status === 'published').length;
  const scheduledDistributions = input.distributions.filter((item) => item.status === 'scheduled').length;
  const failedDistributions = input.distributions.filter((item) => item.status === 'failed').length;

  return {
    state: issues.some((issue) => issue.priority === '긴급') ? 'partial' as const : 'ready' as const,
    period: {
      days: input.days,
      timezone: 'Asia/Seoul',
    },
    freshness: {
      collectedAt: input.collectedAt,
      latestTrackingAt,
      latestProviderAt,
    },
    kpis: {
      spend: metric(
        '광고비',
        totalSpend,
        totalSpend === null ? 'not_collected' : 'collected',
        totalSpend === null ? '광고사 성과 연동이 필요합니다.' : '광고사에서 확인된 지출 합계입니다.',
      ),
      inquiries: metric('문의', input.leads.length, 'collected', '선택한 기간에 접수된 문의입니다.'),
      bookings: metric('마케팅 연결 예약', attributedBookings.length, 'collected', '광고 채널이 연결된 예약입니다.'),
      confirmedMargin: metric(
        '정산 확인 마진',
        confirmedMargin,
        'collected',
        '정산 확인일이 기록된 예약의 마진만 합산합니다.',
      ),
      costPerBooking: metric(
        '예약당 광고비',
        costPerBooking,
        totalSpend === null ? 'not_collected' : 'collected',
        costPerBooking === null ? '광고비와 연결 예약이 모두 있어야 계산됩니다.' : '광고비 ÷ 마케팅 연결 예약입니다.',
      ),
      marginReturnRate: metric(
        '마진 회수율',
        marginReturnRate,
        totalSpend === null ? 'not_collected' : 'collected',
        '광고 귀속 마진 ÷ 광고비입니다.',
      ),
    },
    channels,
    funnel,
    issues,
    recommendations: unresolvedRecommendations,
    campaigns: {
      total: input.campaigns.length,
      active: input.campaigns.filter((campaign) => campaign.status?.toLowerCase() === 'active').length,
      draft: input.campaigns.filter((campaign) => campaign.status?.toLowerCase() === 'draft').length,
      rows: input.campaigns.slice(0, 8),
    },
    content: {
      total: input.creatives.length,
      published: publishedCreatives,
      scheduled: scheduledDistributions,
      failed: failedDistributions,
    },
    totalSpend: totalSpend ?? 0,
    totalConversions: attributedBookings.length,
    attributedRevenue: 0,
    blendedRoas: marginReturnRate ?? 0,
    avgCpa: costPerBooking ?? 0,
    trends: [],
  };
}

export type MarketingOperationsDashboard = ReturnType<typeof buildMarketingOperationsDashboard>;
