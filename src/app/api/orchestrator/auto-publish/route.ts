/**
 * One-Stop Auto-Publish Orchestrator
 *
 * POST /api/orchestrator/auto-publish
 * Body: { product_id: UUID, tenant_id?: UUID, platforms?: Platform[], dryRun?: boolean }
 *
 * 동작 (사용자 1회 트리거 → 끝까지 자동):
 *   1. travel_packages 로드 + ContentBrief 생성 (product 모드)
 *   2. 5종 에이전트 병렬 호출:
 *      - instagram_caption
 *      - threads_post
 *      - meta_ads
 *      - kakao_channel
 *      - google_ads_rsa
 *   3. 각 결과를 content_distributions 에 status='scheduled' 로 INSERT
 *      scheduled_for = recommend_publish_slot RPC (Best Time to Post)
 *   4. blog_topic_queue 에 product 토픽 추가 (다음 blog-publisher 사이클이 처리)
 *   5. 카드뉴스 5변형 생성 트리거 (generate-variants 위임, 백그라운드)
 *   6. 응답: 모든 distribution_id + scheduled_at 표 (사용자가 한 화면 확인)
 *
 * 멀티테넌시:
 *   - tenant_id 가 모든 INSERT 행에 전파됨
 *   - 미지정 시 NULL = 여소남 본사
 *
 * 외부 SaaS 의존성: 0 (Gemini + Supabase + 자체 cron 만 사용)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { generateContentBrief } from '@/lib/content-pipeline/content-brief';
import { generateInstagramCaption } from '@/lib/content-pipeline/agents/instagram-caption';
import { generateThreadsPost } from '@/lib/content-pipeline/agents/threads-post';
import { generateMetaAds } from '@/lib/content-pipeline/agents/meta-ads';
import { generateKakaoChannelMessage } from '@/lib/content-pipeline/agents/kakao-channel';
import { generateGoogleAdsRSA } from '@/lib/content-pipeline/agents/google-ads-rsa';
import { recommendPublishSlot } from '@/lib/best-time-engine';

export const runtime = 'nodejs';
export const maxDuration = 300;

type Platform =
  | 'instagram_caption'
  | 'threads_post'
  | 'meta_ads'
  | 'kakao_channel'
  | 'google_ads_rsa'
  | 'blog_body';

const DEFAULT_PLATFORMS: Platform[] = [
  'instagram_caption',
  'threads_post',
  'meta_ads',
  'kakao_channel',
  'google_ads_rsa',
  'blog_body',
];

interface RequestBody {
  product_id: string;
  tenant_id?: string | null;
  platforms?: Platform[];
  dryRun?: boolean;
  triggerCardNewsVariants?: boolean;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  if (!process.env.GOOGLE_AI_API_KEY) {
    return NextResponse.json({ error: 'GOOGLE_AI_API_KEY 미설정' }, { status: 503 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 });
  }

  if (!body.product_id) {
    return NextResponse.json({ error: 'product_id 필요' }, { status: 400 });
  }

  const t0 = Date.now();
  const tenantId = body.tenant_id ?? null;
  const platforms = body.platforms?.length ? body.platforms : DEFAULT_PLATFORMS;
  const dryRun = body.dryRun ?? false;

  // 1) 상품 로드 (실 스키마: price, photos/photo_urls — base_price/hero_image_url 없음)
  const { data: pkg, error: pkgErr } = await supabaseAdmin
    .from('travel_packages')
    .select('id, title, destination, duration, nights, price, airline, departure_airport, product_summary, product_highlights, special_notes, inclusions, photos, photo_urls, itinerary_data')
    .eq('id', body.product_id)
    .limit(1);

  if (pkgErr || !pkg?.[0]) {
    return NextResponse.json({ error: `상품 조회 실패: ${pkgErr?.message ?? 'not found'}` }, { status: 404 });
  }
  const product = pkg[0];
  const productInput = {
    title: product.title,
    destination: product.destination ?? undefined,
    duration: product.duration ?? undefined,
    nights: product.nights ?? undefined,
    price: product.price ?? undefined,
    airline: product.airline ?? undefined,
    departure_airport: product.departure_airport ?? undefined,
    product_summary: product.product_summary ?? undefined,
    product_highlights: (product.product_highlights as string[]) ?? undefined,
    special_notes: product.special_notes ?? undefined,
    inclusions: (product.inclusions as string[]) ?? undefined,
  };

  // 2) ContentBrief 1회 생성 (모든 에이전트 공통 입력)
  let brief;
  try {
    brief = await generateContentBrief({ mode: 'product', product: productInput, slideCount: 6 });
  } catch (err) {
    return NextResponse.json(
      { error: `ContentBrief 생성 실패: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  // 3) 에이전트 병렬 실행 + Best Time slot 사전 계산
  const slotPromises = platforms.map((p) =>
    recommendPublishSlot({
      platform: p === 'blog_body' ? 'blog_body' : p,
      tenantId,
    }).catch(() => ({ scheduledFor: nextHour(), source: 'fallback_default' as const, reason: 'rpc fail' })),
  );

  const agentJobs: Array<Promise<{ platform: Platform; payload: Record<string, unknown> | null; error?: string }>> = [];

  if (platforms.includes('instagram_caption')) {
    agentJobs.push(
      generateInstagramCaption({ brief, product: productInput })
        .then((p) => ({ platform: 'instagram_caption' as Platform, payload: p as unknown as Record<string, unknown> }))
        .catch((e) => ({ platform: 'instagram_caption' as Platform, payload: null, error: e instanceof Error ? e.message : String(e) })),
    );
  }
  if (platforms.includes('threads_post')) {
    agentJobs.push(
      generateThreadsPost({ brief, product: productInput })
        .then((p) => ({ platform: 'threads_post' as Platform, payload: p as unknown as Record<string, unknown> }))
        .catch((e) => ({ platform: 'threads_post' as Platform, payload: null, error: e instanceof Error ? e.message : String(e) })),
    );
  }
  if (platforms.includes('meta_ads')) {
    agentJobs.push(
      generateMetaAds({ brief, product: productInput })
        .then((p) => ({ platform: 'meta_ads' as Platform, payload: p as unknown as Record<string, unknown> }))
        .catch((e) => ({ platform: 'meta_ads' as Platform, payload: null, error: e instanceof Error ? e.message : String(e) })),
    );
  }
  if (platforms.includes('kakao_channel')) {
    agentJobs.push(
      generateKakaoChannelMessage({ brief, product: productInput })
        .then((p) => ({ platform: 'kakao_channel' as Platform, payload: p as unknown as Record<string, unknown> }))
        .catch((e) => ({ platform: 'kakao_channel' as Platform, payload: null, error: e instanceof Error ? e.message : String(e) })),
    );
  }
  if (platforms.includes('google_ads_rsa')) {
    agentJobs.push(
      generateGoogleAdsRSA({ brief, product: productInput })
        .then((p) => ({ platform: 'google_ads_rsa' as Platform, payload: p as unknown as Record<string, unknown> }))
        .catch((e) => ({ platform: 'google_ads_rsa' as Platform, payload: null, error: e instanceof Error ? e.message : String(e) })),
    );
  }

  const [agentResults, slots] = await Promise.all([Promise.all(agentJobs), Promise.all(slotPromises)]);
  const slotByPlatform = new Map<string, { scheduledFor: Date; source: string }>();
  platforms.forEach((p, i) => slotByPlatform.set(p, slots[i]));

  // 4) content_distributions INSERT (블로그는 별도 큐 — 5단계에서)
  const distRows = agentResults
    .filter((r) => r.payload && !r.error)
    .map((r) => ({
      tenant_id: tenantId,
      product_id: product.id,
      platform: r.platform,
      payload: r.payload!,
      status: dryRun ? 'draft' : 'scheduled',
      scheduled_for: dryRun ? null : (slotByPlatform.get(r.platform)?.scheduledFor.toISOString() ?? new Date(Date.now() + 60 * 60 * 1000).toISOString()),
      generation_agent: `${r.platform}-orchestrator-v1`,
      generation_config: { brief_h1: brief.h1, slot_source: slotByPlatform.get(r.platform)?.source ?? 'unknown' },
    }));

  let insertedDistributions: Array<{ id: string; platform: string; scheduled_for: string | null }> = [];
  if (distRows.length > 0) {
    const { data: insRows, error: insErr } = await supabaseAdmin
      .from('content_distributions')
      .insert(distRows)
      .select('id, platform, scheduled_for');
    if (insErr) {
      return NextResponse.json({
        error: `content_distributions INSERT 실패: ${insErr.message}`,
        agentResults: agentResults.map(r => ({ platform: r.platform, ok: !r.error, error: r.error })),
      }, { status: 500 });
    }
    insertedDistributions = (insRows ?? []) as Array<{ id: string; platform: string; scheduled_for: string | null }>;
  }

  // 5) 블로그 토픽 큐 (blog-publisher 매시간 사이클이 처리)
  let blogQueueId: string | null = null;
  if (platforms.includes('blog_body') && !dryRun) {
    try {
      const blogSlot = slotByPlatform.get('blog_body')?.scheduledFor ?? new Date(Date.now() + 30 * 60 * 1000);
      const { data: bq } = await supabaseAdmin
        .from('blog_topic_queue')
        .insert({
          tenant_id: tenantId,
          topic: `${product.destination ?? ''} ${product.title}`.trim(),
          destination: product.destination,
          category: 'product_intro',
          angle_type: 'value',
          product_id: product.id,
          source: 'product',
          status: 'queued',
          priority: 90,
          target_publish_at: blogSlot.toISOString(),
          meta: { triggered_by: 'auto-publish-orchestrator' },
        })
        .select('id')
        .single();
      blogQueueId = bq?.id ?? null;
    } catch {
      /* 블로그 큐는 실패해도 다른 플랫폼 발행은 진행 */
    }
  }

  // 6) 카드뉴스 5변형 백그라운드 트리거 (옵션, 응답 차단 X)
  let cardNewsVariantTrigger: { triggered: boolean; group_id?: string; reason?: string } = { triggered: false };
  if (body.triggerCardNewsVariants !== false && !dryRun) {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
      // fire-and-forget. 본 응답은 차단하지 않음.
      const rawText = [
        product.title,
        product.product_summary ?? '',
        ...(product.product_highlights as string[] ?? []),
      ].filter(Boolean).join('\n\n');
      fetch(`${baseUrl}/api/card-news/generate-variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText,
          productMeta: { title: product.title, destination: product.destination },
          package_id: product.id,
          count: 5,
          skipCritic: false,
        }),
      }).catch(() => { /* fire-and-forget */ });
      cardNewsVariantTrigger = { triggered: true };
    } catch (e) {
      cardNewsVariantTrigger = { triggered: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    product_id: product.id,
    product_title: product.title,
    tenant_id: tenantId,
    elapsed_ms: Date.now() - t0,
    distributions: insertedDistributions.map((d) => ({
      id: d.id,
      platform: d.platform,
      scheduled_for: d.scheduled_for,
      slot_source: slotByPlatform.get(d.platform)?.source ?? 'unknown',
    })),
    blog_queue_id: blogQueueId,
    blog_scheduled_for: slotByPlatform.get('blog_body')?.scheduledFor.toISOString() ?? null,
    card_news_variants: cardNewsVariantTrigger,
    agent_failures: agentResults.filter((r) => r.error).map((r) => ({ platform: r.platform, error: r.error })),
    brief_h1: brief.h1,
  }, { status: 201 });
}

function nextHour(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}
