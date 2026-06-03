import { publishToMetaAds } from '@/lib/content-pipeline/publishers/meta-ads-publisher';
import {
  evaluateThreadsDistribution,
  getThreadsMainText,
  type ThreadsGateResult,
} from '@/lib/content-pipeline/threads-automation';
import { supabaseAdmin } from '@/lib/supabase';
import { getThreadsConfig, publishToThreads } from '@/lib/threads-publisher';

export interface ScheduledDistributionRow {
  id: string;
  product_id: string | null;
  card_news_id: string | null;
  blog_post_id: string | null;
  platform: string;
  payload: Record<string, unknown>;
  scheduled_for: string | null;
  engagement: Record<string, unknown>;
  tenant_id: string | null;
  retry_count?: number | null;
  max_retries?: number | null;
}

export interface DistributionPublishResult {
  status: 'published' | 'failed' | 'skipped';
  external_id?: string;
  external_url?: string;
  verification_status?: 'verified' | 'pending' | 'failed';
  verification_error?: string;
  error?: string;
  reason?: string;
  predicted_er?: number;
}

export interface PublishDistributionOptions {
  precomputedGate?: ThreadsGateResult;
  skipStatusUpdate?: boolean;
}

export async function publishDistribution(
  row: ScheduledDistributionRow,
  options: PublishDistributionOptions = {},
): Promise<DistributionPublishResult> {
  const result = await publishDistributionProvider(row, options);

  if (!options.skipStatusUpdate) {
    await persistDistributionPublishResult(row, result);
  }

  return result;
}

export async function persistDistributionPublishResult(
  row: ScheduledDistributionRow,
  result: DistributionPublishResult,
): Promise<void> {
  const engagement = {
    ...(row.engagement ?? {}),
    ...(typeof result.predicted_er === 'number' ? { predicted_er: result.predicted_er } : {}),
    ...(result.verification_status ? { verification_status: result.verification_status } : {}),
    ...(result.verification_error ? { verification_error: result.verification_error } : {}),
  };

  if (result.status === 'published') {
    await supabaseAdmin
      .from('content_distributions')
      .update({
        status: 'published',
        published_at: new Date().toISOString(),
        external_id: result.external_id ?? null,
        external_url: result.external_url ?? null,
        retry_count: 0,
        error_message: null,
        engagement,
      })
      .eq('id', row.id);
    return;
  }

  if (result.status === 'skipped') {
    await supabaseAdmin
      .from('content_distributions')
      .update({
        error_message: result.reason ?? 'Skipped',
        engagement,
      })
      .eq('id', row.id);
    return;
  }

  const retryCount = (row.retry_count ?? 0) + 1;
  const maxRetries = row.max_retries ?? 3;
  const newStatus = retryCount >= maxRetries ? 'failed' : 'scheduled';

  await supabaseAdmin
    .from('content_distributions')
    .update({
      status: newStatus,
      retry_count: retryCount,
      error_message: result.error ?? 'Publish failed',
      engagement: {
        ...engagement,
        last_error: result.error ?? 'Publish failed',
      },
      ...(retryCount < maxRetries
        ? { scheduled_for: new Date(Date.now() + 30 * 60 * 1000).toISOString() }
        : {}),
    })
    .eq('id', row.id);
}

async function publishDistributionProvider(
  row: ScheduledDistributionRow,
  options: PublishDistributionOptions,
): Promise<DistributionPublishResult> {
  const payload = row.payload;

  if (row.platform === 'meta_ads') {
    const landingUrl = row.product_id
      ? `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeosonam.com'}/packages/${row.product_id}`
      : (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeosonam.com');
    const result = await publishToMetaAds({
      primary_texts: (payload.primary_texts as string[]) ?? [],
      headlines: (payload.headlines as string[]) ?? [],
      descriptions: (payload.descriptions as string[]) ?? [],
      cta_button: (payload.cta_button as string) ?? 'LEARN_MORE',
      landing_url: landingUrl,
    });
    if (result.status === 'error') return { status: 'failed', error: result.error };
    return {
      status: 'published',
      external_id: result.campaign_id,
      external_url: result.external_url,
    };
  }

  if (row.platform === 'instagram_caption') {
    if (!row.card_news_id) {
      return { status: 'skipped', reason: 'card_news_id missing; caption-only Instagram publish is not supported' };
    }
    try {
      const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
      const res = await fetch(`${base}/api/card-news/${row.card_news_id}/publish-instagram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption_override: (payload.caption as string) ?? undefined }),
      });
      const data = await res.json();
      if (!res.ok) return { status: 'failed', error: data.error ?? 'Instagram publish failed' };
      return {
        status: 'published',
        external_id: data.ig_post_id ?? undefined,
        external_url: data.permalink ?? undefined,
      };
    } catch (err) {
      return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (row.platform === 'threads_post') {
    const threadsPayload = payload as Record<string, unknown>;
    const text = getThreadsMainText(threadsPayload);
    const imageUrls = (threadsPayload.image_urls as string[] | undefined) ||
      (threadsPayload.media_urls as string[] | undefined);

    if (!text.trim()) {
      return { status: 'failed', error: 'Threads body is empty' };
    }

    try {
      const gate = options.precomputedGate ?? await evaluateThreadsDistribution({
        distributionId: row.id,
        payload: threadsPayload,
        scheduledFor: row.scheduled_for,
      });
      if (!gate.approved) {
        return {
          status: 'failed',
          error: `Threads critic gate: ${gate.reason ?? 'rejected'}`,
          predicted_er: gate.predicted_er,
        };
      }

      const cfg = await getThreadsConfig();
      if (!cfg) {
        return { status: 'failed', error: 'Threads config missing', predicted_er: gate.predicted_er };
      }

      const replyThreads = (threadsPayload.thread as string[] | undefined)?.filter(Boolean);
      const result = await publishToThreads({
        threadsUserId: cfg.threadsUserId,
        accessToken: cfg.accessToken,
        text,
        imageUrls: Array.isArray(imageUrls) && imageUrls.length > 0 ? imageUrls : undefined,
        replyThreads: replyThreads && replyThreads.length > 0 ? replyThreads : undefined,
      });
      if (!result.ok) {
        return {
          status: 'failed',
          error: result.error ?? 'Threads publish failed',
          predicted_er: gate.predicted_er,
        };
      }
      return {
        status: 'published',
        external_id: result.postId,
        external_url: result.permalink,
        verification_status: result.verified ? 'verified' : 'pending',
        verification_error: result.verificationError,
        predicted_er: gate.predicted_er,
      };
    } catch (err) {
      return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (row.platform === 'kakao_channel' || row.platform === 'google_ads_rsa') {
    return { status: 'skipped', reason: `${row.platform} auto publish is not configured yet` };
  }

  if (row.platform === 'blog_body') {
    if (row.blog_post_id) {
      const { data: existing } = await supabaseAdmin
        .from('content_creatives')
        .select('id, slug, status')
        .eq('id', row.blog_post_id)
        .limit(1);
      const existingRow = existing?.[0];
      if (existingRow) {
        if (existingRow.status !== 'published') {
          await supabaseAdmin
            .from('content_creatives')
            .update({ status: 'published', published_at: new Date().toISOString() })
            .eq('id', row.blog_post_id);
        }
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://yeosonam.com';
        return {
          status: 'published',
          external_id: row.blog_post_id,
          external_url: `${baseUrl}/blog/${existingRow.slug}`,
        };
      }
    }

    try {
      const queuePayload = (row.payload ?? {}) as Record<string, unknown>;
      await supabaseAdmin.from('blog_topic_queue').insert({
        tenant_id: row.tenant_id,
        topic: (queuePayload.topic as string) ?? '자동 생성 블로그',
        destination: (queuePayload.destination as string) ?? null,
        category: (queuePayload.category as string) ?? null,
        angle_type: (queuePayload.angle_type as string) ?? 'value',
        product_id: row.product_id,
        card_news_id: row.card_news_id,
        source: row.card_news_id ? 'card_news' : (row.product_id ? 'product' : 'distribution'),
        status: 'queued',
        priority: 80,
        target_publish_at: new Date().toISOString(),
        meta: { from_distribution_id: row.id, ...queuePayload },
      });
      return { status: 'published', external_id: 'queued_to_blog_publisher' };
    } catch (e) {
      return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  return { status: 'skipped', reason: `Unsupported platform: ${row.platform}` };
}
