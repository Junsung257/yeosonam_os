import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export type ActionSeverity = 'critical' | 'high' | 'medium' | 'low';
export type ActionCategory = 'content' | 'social' | 'ads' | 'tracking' | 'ops';

export interface MarketingAssetGroup {
  product: {
    id: string;
    title: string;
    destination: string | null;
    status: string | null;
    price: number | null;
    ticketing_deadline: string | null;
    updated_at: string | null;
  };
  readiness_score: number;
  stages: {
    blog: {
      total: number;
      published: number;
      latest_slug: string | null;
      latest_published_at: string | null;
    };
    card_news: {
      total: number;
      confirmed: number;
      ig_published: number;
      ig_queued: number;
      ig_failed: number;
      threads_published: number;
    };
    ads: {
      campaigns: number;
      active_campaigns: number;
      creatives: number;
      deployed_creatives: number;
      total_spend_krw: number;
    };
    distribution: {
      scheduled: number;
      published: number;
      failed: number;
    };
    indexing: {
      latest_blog_slug: string | null;
      gsc_impressions: number;
      gsc_clicks: number;
      gsc_position: number | null;
      health_score: number;
      last_seen_date: string | null;
    };
  };
  flags: string[];
  next_actions: MarketingNextAction[];
}

export interface MarketingNextAction {
  id: string;
  product_id: string | null;
  title: string;
  reason: string;
  category: ActionCategory;
  severity: ActionSeverity;
  action_url: string;
  action_label: string;
  automation_level: 0 | 1 | 2 | 3;
}

type ProductRow = {
  id: string;
  title: string;
  destination: string | null;
  status: string | null;
  price: number | null;
  ticketing_deadline: string | null;
  updated_at: string | null;
};

type BlogRow = {
  id: string;
  product_id: string | null;
  status: string | null;
  slug: string | null;
  published_at: string | null;
};

type CardNewsRow = {
  id: string;
  package_id: string | null;
  status: string | null;
  ig_publish_status: string | null;
};

type DistributionRow = {
  id: string;
  product_id: string | null;
  status: string;
};

type CampaignRow = {
  id: string;
  package_id: string | null;
  status: string | null;
  total_spend_krw: number | null;
};

type AdCreativeRow = {
  id: string;
  product_id: string | null;
  status: string | null;
  meta_creative_id: string | null;
  google_ad_id: string | null;
  naver_ad_id: string | null;
};

type RankHistoryRow = {
  slug: string;
  date: string;
  impressions: number | null;
  clicks: number | null;
  position: number | null;
};

function byProduct<T extends { product_id?: string | null; package_id?: string | null }>(rows: T[], productId: string): T[] {
  return rows.filter((row) => (row.product_id ?? row.package_id) === productId);
}

function deadlineDays(value: string | null): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.ceil((time - Date.now()) / 86_400_000);
}

function deadlineReason(days: number) {
  if (days < 0) return `Ticketing deadline is overdue by ${Math.abs(days)} days. Paid and social recovery should be reviewed.`;
  if (days === 0) return 'Ticketing deadline is today. Paid and social acceleration should be reviewed.';
  return `Ticketing deadline is in ${days} days. Paid and social acceleration should be reviewed.`;
}

function scoreGroup(args: {
  hasBlog: boolean;
  hasCardNews: boolean;
  hasSocialPublish: boolean;
  hasCampaign: boolean;
  hasDeployedCreative: boolean;
  hasDistributionFailure: boolean;
  hasUrgentDeadline: boolean;
  indexingHealthScore: number;
}) {
  let score = 0;
  if (args.hasBlog) score += 20;
  if (args.hasCardNews) score += 18;
  if (args.hasSocialPublish) score += 18;
  if (args.hasCampaign) score += 16;
  if (args.hasDeployedCreative) score += 18;
  score += 10;
  score += Math.round(args.indexingHealthScore * 0.1);
  if (args.hasDistributionFailure) score -= 12;
  if (args.hasUrgentDeadline && !args.hasCampaign) score -= 10;
  return Math.max(0, Math.min(100, score));
}

function scoreGscHealth(rank: RankHistoryRow | null, hasPublishedBlog: boolean) {
  if (!hasPublishedBlog) return 0;
  if (!rank) return 20;
  const impressionScore = (rank.impressions ?? 0) > 0 ? 55 : 15;
  const clickScore = Math.min(25, Math.round((rank.clicks ?? 0) * 5));
  const positionScore = Math.max(0, Math.min(20, Math.round(20 - ((rank.position ?? 40) / 2))));
  return Math.max(0, Math.min(100, impressionScore + clickScore + positionScore));
}

function buildActions(group: Omit<MarketingAssetGroup, 'next_actions'>): MarketingNextAction[] {
  const p = group.product;
  const actions: MarketingNextAction[] = [];
  const id = (suffix: string) => `${p.id}:${suffix}`;
  const deadline = deadlineDays(p.ticketing_deadline);

  if (deadline != null && deadline <= 14 && group.stages.ads.active_campaigns === 0) {
    actions.push({
      id: id('deadline-no-active-ads'),
      product_id: p.id,
      title: deadline < 0
        ? 'Ticketing deadline is overdue, but no active ads are running'
        : 'Ticketing deadline is close, but no active ads are running',
      reason: deadlineReason(deadline),
      category: 'ads',
      severity: 'critical',
      action_url: `/admin/marketing/campaigns?package_id=${p.id}`,
      action_label: 'Prepare campaign',
      automation_level: 1,
    });
  }

  if (group.stages.blog.published === 0 && group.stages.blog.total === 0) {
    actions.push({
      id: id('missing-blog'),
      product_id: p.id,
      title: 'No published blog asset',
      reason: 'A blog page is the SEO and landing anchor for card news, Threads, and ads.',
      category: 'content',
      severity: 'high',
      action_url: `/admin/blog/queue?package_id=${p.id}`,
      action_label: 'Queue blog',
      automation_level: 1,
    });
  } else if (group.stages.blog.published === 0 && group.stages.blog.total > 0) {
    actions.push({
      id: id('blog-draft-not-published'),
      product_id: p.id,
      title: 'Blog asset exists but is not published',
      reason: 'A blog draft exists, but there is no published landing/SEO asset yet.',
      category: 'content',
      severity: 'medium',
      action_url: `/admin/blog/queue?package_id=${p.id}`,
      action_label: 'Review blog draft',
      automation_level: 2,
    });
  }

  if (group.stages.card_news.total === 0) {
    actions.push({
      id: id('missing-card-news'),
      product_id: p.id,
      title: 'No card news asset',
      reason: 'The product has no visual social asset for Instagram/Threads distribution.',
      category: 'social',
      severity: group.stages.blog.published > 0 ? 'high' : 'medium',
      action_url: `/admin/marketing/card-news/new?package_id=${p.id}`,
      action_label: 'Create card news',
      automation_level: 1,
    });
  } else if (group.stages.card_news.confirmed > 0 && group.stages.card_news.ig_published === 0 && group.stages.card_news.ig_queued === 0) {
    actions.push({
      id: id('confirmed-card-news-not-scheduled'),
      product_id: p.id,
      title: 'Confirmed card news is not scheduled',
      reason: 'Confirmed social creative exists, but Instagram publication is not queued or published.',
      category: 'social',
      severity: 'medium',
      action_url: `/admin/marketing/card-news?package_id=${p.id}`,
      action_label: 'Schedule publish',
      automation_level: 2,
    });
  }

  if (group.stages.ads.campaigns === 0) {
    actions.push({
      id: id('missing-campaign'),
      product_id: p.id,
      title: 'No ad campaign draft',
      reason: 'No Meta/Google/Naver campaign is attached to this product.',
      category: 'ads',
      severity: group.stages.blog.published > 0 || group.stages.card_news.total > 0 ? 'medium' : 'low',
      action_url: `/admin/marketing/campaigns?package_id=${p.id}`,
      action_label: 'Create campaign draft',
      automation_level: 1,
    });
  }

  if (group.stages.ads.campaigns > 0 && group.stages.ads.deployed_creatives === 0) {
    actions.push({
      id: id('campaign-no-deployed-creative'),
      product_id: p.id,
      title: 'Campaign exists without deployed creative',
      reason: 'A campaign is present, but no platform creative id is recorded yet.',
      category: 'ads',
      severity: 'high',
      action_url: `/admin/marketing/creatives?package_id=${p.id}`,
      action_label: 'Deploy creative',
      automation_level: 2,
    });
  }

  if (group.stages.distribution.failed > 0 || group.stages.card_news.ig_failed > 0) {
    actions.push({
      id: id('failed-distribution'),
      product_id: p.id,
      title: 'Distribution failure needs repair',
      reason: `Failed distribution rows: ${group.stages.distribution.failed}; IG failures: ${group.stages.card_news.ig_failed}.`,
      category: 'ops',
      severity: 'critical',
      action_url: `/admin/marketing/system-health`,
      action_label: 'Open health check',
      automation_level: 2,
    });
  }

  if (
    group.stages.blog.published > 0
    && group.stages.indexing.latest_blog_slug
    && group.stages.indexing.health_score < 35
  ) {
    actions.push({
      id: id('blog-gsc-low-signal'),
      product_id: p.id,
      title: 'Published blog has weak GSC signal',
      reason: 'The product has a published blog, but Search Console impressions/clicks are still weak or missing.',
      category: 'tracking',
      severity: 'medium',
      action_url: `/admin/blog/${group.stages.indexing.latest_blog_slug}`,
      action_label: 'Review SEO',
      automation_level: 2,
    });
  }

  return actions.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(severity: ActionSeverity) {
  return severity === 'critical' ? 4 : severity === 'high' ? 3 : severity === 'medium' ? 2 : 1;
}

export async function getMarketingAssetGroups(limit = 30): Promise<{ groups: MarketingAssetGroup[]; actions: MarketingNextAction[] }> {
  if (!isSupabaseConfigured) return { groups: [], actions: [] };

  const { data: products, error: productError } = await supabaseAdmin
    .from('travel_packages')
    .select('id, title, destination, status, price, ticketing_deadline, updated_at')
    .in('status', ['active', 'approved', 'available'])
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (productError) throw productError;
  const productRows = (products ?? []) as ProductRow[];
  const productIds = productRows.map((product) => product.id);
  if (productIds.length === 0) return { groups: [], actions: [] };

  const [blogsRes, cardsRes, distRes, campaignsRes, creativesRes] = await Promise.all([
    supabaseAdmin
      .from('content_creatives')
      .select('id, product_id, status, slug, published_at')
      .in('product_id', productIds),
    supabaseAdmin
      .from('card_news')
      .select('id, package_id, status, ig_publish_status')
      .in('package_id', productIds),
    supabaseAdmin
      .from('content_distributions')
      .select('id, product_id, status')
      .in('product_id', productIds),
    supabaseAdmin
      .from('ad_campaigns')
      .select('id, package_id, status, total_spend_krw')
      .in('package_id', productIds),
    supabaseAdmin
      .from('ad_creatives')
      .select('id, product_id, status, meta_creative_id, google_ad_id, naver_ad_id')
      .in('product_id', productIds),
  ]);

  for (const res of [blogsRes, cardsRes, distRes, campaignsRes, creativesRes]) {
    if (res.error) throw res.error;
  }

  const blogs = (blogsRes.data ?? []) as BlogRow[];
  const cards = (cardsRes.data ?? []) as CardNewsRow[];
  const distributions = (distRes.data ?? []) as DistributionRow[];
  const campaigns = (campaignsRes.data ?? []) as CampaignRow[];
  const creatives = (creativesRes.data ?? []) as AdCreativeRow[];
  const publishedSlugs = blogs
    .filter((blog) => blog.status === 'published' && blog.slug)
    .map((blog) => blog.slug as string);
  const rankBySlug = new Map<string, RankHistoryRow>();
  if (publishedSlugs.length > 0) {
    const { data: rankRows, error: rankError } = await supabaseAdmin
      .from('rank_history')
      .select('slug, date, impressions, clicks, position')
      .in('slug', publishedSlugs)
      .eq('query', '__page__')
      .eq('source', 'gsc-page')
      .order('date', { ascending: false });
    if (rankError && rankError.code !== '42P01') throw rankError;
    for (const row of (rankRows ?? []) as RankHistoryRow[]) {
      if (!rankBySlug.has(row.slug)) rankBySlug.set(row.slug, row);
    }
  }

  const groups = productRows.map((product) => {
    const productBlogs = byProduct(blogs, product.id);
    const productCards = byProduct(cards, product.id);
    const productDistributions = byProduct(distributions, product.id);
    const productCampaigns = byProduct(campaigns, product.id);
    const productCreatives = byProduct(creatives, product.id);
    const publishedBlogs = productBlogs
      .filter((blog) => blog.status === 'published')
      .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
    const deployedCreatives = productCreatives.filter((creative) =>
      Boolean(creative.meta_creative_id || creative.google_ad_id || creative.naver_ad_id),
    );
    const deadline = deadlineDays(product.ticketing_deadline);
    const latestSlug = publishedBlogs[0]?.slug ?? null;
    const latestRank = latestSlug ? rankBySlug.get(latestSlug) ?? null : null;
    const gscHealthScore = scoreGscHealth(latestRank, publishedBlogs.length > 0);

    const partial: Omit<MarketingAssetGroup, 'next_actions'> = {
      product,
      readiness_score: 0,
      stages: {
        blog: {
          total: productBlogs.length,
          published: publishedBlogs.length,
          latest_slug: publishedBlogs[0]?.slug ?? null,
          latest_published_at: publishedBlogs[0]?.published_at ?? null,
        },
        card_news: {
          total: productCards.length,
          confirmed: productCards.filter((card) => card.status?.toLowerCase() === 'confirmed').length,
          ig_published: productCards.filter((card) => card.ig_publish_status === 'published').length,
          ig_queued: productCards.filter((card) => card.ig_publish_status === 'queued' || card.ig_publish_status === 'publishing').length,
          ig_failed: productCards.filter((card) => card.ig_publish_status === 'failed').length,
          threads_published: 0,
        },
        ads: {
          campaigns: productCampaigns.length,
          active_campaigns: productCampaigns.filter((campaign) => campaign.status === 'ACTIVE' || campaign.status === 'active').length,
          creatives: productCreatives.length,
          deployed_creatives: deployedCreatives.length,
          total_spend_krw: productCampaigns.reduce((sum, campaign) => sum + (campaign.total_spend_krw ?? 0), 0),
        },
        distribution: {
          scheduled: productDistributions.filter((row) => row.status === 'scheduled').length,
          published: productDistributions.filter((row) => row.status === 'published').length,
          failed: productDistributions.filter((row) => row.status === 'failed').length,
        },
        indexing: {
          latest_blog_slug: latestSlug,
          gsc_impressions: latestRank?.impressions ?? 0,
          gsc_clicks: latestRank?.clicks ?? 0,
          gsc_position: latestRank?.position ?? null,
          health_score: gscHealthScore,
          last_seen_date: latestRank?.date ?? null,
        },
      },
      flags: [
        ...(deadline != null && deadline <= 14 ? ['deadline_soon'] : []),
        ...(productBlogs.length === 0 ? ['no_blog'] : []),
        ...(productCards.length === 0 ? ['no_card_news'] : []),
        ...(productCampaigns.length === 0 ? ['no_campaign'] : []),
        ...(productDistributions.some((row) => row.status === 'failed') ? ['distribution_failed'] : []),
      ],
    };

    partial.readiness_score = scoreGroup({
      hasBlog: partial.stages.blog.published > 0,
      hasCardNews: partial.stages.card_news.total > 0,
      hasSocialPublish: partial.stages.card_news.ig_published > 0 || partial.stages.card_news.threads_published > 0,
      hasCampaign: partial.stages.ads.campaigns > 0,
      hasDeployedCreative: partial.stages.ads.deployed_creatives > 0,
      hasDistributionFailure: partial.stages.distribution.failed > 0 || partial.stages.card_news.ig_failed > 0,
      hasUrgentDeadline: deadline != null && deadline <= 14,
      indexingHealthScore: partial.stages.indexing.health_score,
    });

    const group: MarketingAssetGroup = {
      ...partial,
      next_actions: buildActions(partial),
    };
    return group;
  });

  const actions = groups
    .flatMap((group) => group.next_actions)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 50);

  return { groups, actions };
}
