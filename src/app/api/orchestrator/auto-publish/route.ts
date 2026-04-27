/**
 * One-Stop Auto-Publish Orchestrator
 *
 * POST /api/orchestrator/auto-publish
 * Body: {
 *   product_id: UUID,
 *   tenant_id?: UUID,
 *   platforms?: Platform[],
 *   dryRun?: boolean,
 *   publishNow?: boolean,    // Best Time 무시 즉시 발행
 *   triggerCardNewsVariants?: boolean
 * }
 *
 * 멱등성: 5분 내 같은 product_id 재트리거 시 duplicate_warning 응답에 표시.
 * 응답 status:
 *   201 — 정상 (distribution 1건 이상 생성)
 *   207 — 모든 agent 실패 (ok:false)
 *   404 — 상품 없음
 *   503 — DB/AI 키 미설정
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
  publishNow?: boolean;
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
  const publishNow = body.publishNow ?? false;

  // 0) 멱등성 가드 — 같은 product_id 5분 내 트리거 이력 조회 (중복 발행 방지 경고용)
  let duplicateWarning: { recent_count: number; last_at: string } | null = null;
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from('content_distributions')
      .select('id, created_at')
      .eq('product_id', body.product_id)
      .gte('created_at', fiveMinAgo)
      .order('created_at', { ascending: false });
    if (recent && recent.length > 0) {
      duplicateWarning = {
        recent_count: recent.length,
        last_at: (recent[0] as { created_at: string }).created_at,
      };
    }
  } catch { /* 멱등성 체크 실패해도 발행은 진행 */ }

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

  // 3) 에이전트 병렬 실행 + 발행 슬롯 사전 계산
  const slotPromises = platforms.map((p) => {
    if (publishNow) {
      // 즉시 발행: 다음 cron 실행을 보장하기 위해 1분 뒤로 (publish-scheduled 주기 = 1h)
      return Promise.resolve({
        scheduledFor: new Date(Date.now() + 60 * 1000),
        source: 'now' as const,
      });
    }
    return recommendPublishSlot({
      platform: p === 'blog_body' ? 'blog_body' : p,
      tenantId,
    }).catch(() => ({
      scheduledFor: nextHour(),
      source: 'fallback_default' as const,
      reason: 'rpc fail',
    }));
  });

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

  let insertedDistributions: Array<{ id: string; platform: string; scheduled_for: string | null; payload: Record<string, unknown> }> = [];
  if (distRows.length > 0) {
    const { data: insRows, error: insErr } = await supabaseAdmin
      .from('content_distributions')
      .insert(distRows)
      .select('id, platform, scheduled_for, payload');
    if (insErr) {
      return NextResponse.json({
        error: `content_distributions INSERT 실패: ${insErr.message}`,
        agentResults: agentResults.map(r => ({ platform: r.platform, ok: !r.error, error: r.error })),
      }, { status: 500 });
    }
    insertedDistributions = (insRows ?? []) as Array<{ id: string; platform: string; scheduled_for: string | null; payload: Record<string, unknown> }>;
  }

  // 모든 에이전트가 실패한 경우 207 (다중 상태) + ok:false
  if (insertedDistributions.length === 0 && agentResults.length > 0) {
    return NextResponse.json({
      ok: false,
      error: '모든 에이전트 실패',
      agent_failures: agentResults.map((r) => ({ platform: r.platform, error: r.error })),
      duplicate_warning: duplicateWarning,
      brief_h1: brief.h1,
      elapsed_ms: Date.now() - t0,
    }, { status: 207 });
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

  // 6) 카드뉴스 5변형 백그라운드 트리거.
  // Note: Next 14.2 의 `after()` 가 unstable 이라 fire-and-forget 사용.
  // Vercel Fluid Compute 환경에서는 dangling promise 가 안전하게 완료됨.
  // Traditional serverless 환경에서 끊길 가능성을 대비해 응답 후에도 실행 시도.
  let cardNewsVariantTrigger: { triggered: boolean; group_id?: string; reason?: string } = { triggered: false };
  if (body.triggerCardNewsVariants !== false && !dryRun) {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
      const rawText = [
        product.title,
        product.product_summary ?? '',
        ...(product.product_highlights as string[] ?? []),
      ].filter(Boolean).join('\n\n');
      const variantPromise = fetch(`${baseUrl}/api/card-news/generate-variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText,
          productMeta: { title: product.title, destination: product.destination },
          package_id: product.id,
          count: 5,
          skipCritic: false,
        }),
      });
      // 응답 차단 X. 단 실패 로깅은 보장.
      variantPromise
        .then((r) => { if (!r.ok) console.warn('[orchestrator] 카드뉴스 변형 트리거 응답 비정상:', r.status); })
        .catch((e) => console.warn('[orchestrator] 카드뉴스 변형 트리거 실패:', e instanceof Error ? e.message : e));
      cardNewsVariantTrigger = { triggered: true };
    } catch (e) {
      cardNewsVariantTrigger = { triggered: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    publishNow,
    product_id: product.id,
    product_title: product.title,
    tenant_id: tenantId,
    elapsed_ms: Date.now() - t0,
    distributions: insertedDistributions.map((d) => ({
      id: d.id,
      platform: d.platform,
      scheduled_for: d.scheduled_for,
      slot_source: slotByPlatform.get(d.platform)?.source ?? 'unknown',
      payload: d.payload,
    })),
    blog_queue_id: blogQueueId,
    blog_scheduled_for: slotByPlatform.get('blog_body')?.scheduledFor.toISOString() ?? null,
    card_news_variants: cardNewsVariantTrigger,
    agent_failures: agentResults.filter((r) => r.error).map((r) => ({ platform: r.platform, error: r.error })),
    duplicate_warning: duplicateWarning,
    brief_h1: brief.h1,
  }, { status: 201 });
}

function nextHour(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}
