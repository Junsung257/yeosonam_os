/**
 * Social Publisher — 소셜 미디어 자동 발행 라이브러리
 *
 * 플랫폼별 라우팅 + content_distributions DB 상태 관리.
 * 실제 HTTP API 호출은 stub 상태 (TODO: 실제 Meta/Naver API 연동 필요).
 */
import { supabaseAdmin } from '@/lib/supabase';
import { resolveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SocialPlatform = 'instagram' | 'facebook' | 'threads' | 'twitter' | 'naver_cafe';

export interface PublishRequest {
  contentDistributionId: string;
  platform: SocialPlatform;
  imageUrls?: string[];
  caption: string;
  scheduledAt?: string;
}

export interface PublishResult {
  platform: SocialPlatform;
  success: boolean;
  externalPostId?: string;
  publishedAt: string;
  error?: string;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** 단일 소셜 발행 — 플랫폼 라우팅 + DB 상태 관리 */
export async function publishToSocial(request: PublishRequest): Promise<PublishResult> {
  switch (request.platform) {
    case 'instagram':
      return publishToInstagram(request);
    case 'facebook':
      return publishToFacebook(request);
    case 'threads':
      return publishToThreads(request);
    case 'twitter':
      return publishToTwitter(request);
    case 'naver_cafe':
      return publishToNaverCafe(request);
    default:
      return {
        platform: request.platform,
        success: false,
        publishedAt: new Date().toISOString(),
        error: `Unsupported platform: ${request.platform}`,
      };
  }
}

/** 승인된 content_distributions 조회 후 일괄 발행 */
export async function processPublishQueue(opts?: {
  platform?: SocialPlatform;
  tenantId?: string;
  limit?: number;
}): Promise<{ published: number; failed: number; results: PublishResult[] }> {
  const limit = opts?.limit ?? 10;

  // ── 1. 승인된 콘텐츠 조회 ──────────────────────────────────────────────
  let query = supabaseAdmin
    .from('content_distributions')
    .select('id, platform, payload, product_id')
    .eq('status', 'approved')
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (opts?.platform) {
    query = query.eq('platform', opts.platform);
  }

  const { data: rows, error: fetchErr } = await query;

  if (fetchErr) {
    console.error('[social-publisher] 승인 콘텐츠 조회 실패:', fetchErr);
    return { published: 0, failed: 0, results: [] };
  }

  if (!rows?.length) {
    return { published: 0, failed: 0, results: [] };
  }

  // ── 2. 플랫폼별 매핑 (content_distributions.platform → SocialPlatform) ──
  const platformMap: Record<string, SocialPlatform> = {
    instagram_caption: 'instagram',
    instagram_story: 'instagram',
    threads_post: 'threads',
    naver_blog: 'naver_cafe',
  };

  // ── 3. 발행 실행 ──────────────────────────────────────────────────────
  const results: PublishResult[] = [];
  let published = 0;
  let failed = 0;

  for (const row of rows) {
    const platform = platformMap[row.platform];
    if (!platform) {
      // 매핑되지 않은 플랫폼은 건너뜀 (예: blog_body, meta_ads)
      continue;
    }

    const payload = row.payload as { caption?: string; imageUrls?: string[] } | undefined;
    const caption = payload?.caption ?? '';

    const result = await publishToSocial({
      contentDistributionId: row.id,
      platform,
      caption,
      imageUrls: payload?.imageUrls,
    });

    // ── 4. DB 상태 업데이트 ────────────────────────────────────────────
    if (result.success) {
      const { error: updateErr } = await supabaseAdmin
        .from('content_distributions')
        .update({
          status: 'published',
          external_id: result.externalPostId ?? null,
          published_at: result.publishedAt,
        })
        .eq('id', row.id);

      if (updateErr) {
        console.error(`[social-publisher] DB 업데이트 실패 (published): row=${row.id}`, updateErr);
      }

      published++;
    } else {
      // 기존 retry_count 읽기
      const { data: current } = await supabaseAdmin
        .from('content_distributions')
        .select('retry_count')
        .eq('id', row.id)
        .limit(1);

      const retryCount = ((current?.[0] as { retry_count?: number } | undefined)?.retry_count ?? 0) + 1;

      const { error: updateErr } = await supabaseAdmin
        .from('content_distributions')
        .update({
          status: retryCount >= 3 ? 'failed' : 'approved', // 재시도 가능 시 approved 유지
          retry_count: retryCount,
          error_message: result.error ?? null,
        })
        .eq('id', row.id);

      if (updateErr) {
        console.error(`[social-publisher] DB 업데이트 실패 (failed): row=${row.id}`, updateErr);
      }

      failed++;
    }

    results.push(result);
  }

  return { published, failed, results };
}

/** 플랫폼 API 헬스 체크 */
export async function checkPlatformHealth(
  platform: SocialPlatform,
  tenantId?: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    // 플랫폼별 검증
    switch (platform) {
      case 'instagram':
      case 'facebook':
      case 'threads':
        return checkMetaTokenHealth(platform, tenantId);
      case 'naver_cafe':
        return checkNaverTokenHealth(tenantId);
      case 'twitter':
        return { ok: false, message: 'Twitter API not yet implemented' };
      default:
        return { ok: false, message: `Unknown platform: ${platform}` };
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Platform Implementations ────────────────────────────────────────────────

/**
 * Instagram Graph API 발행
 *
 * Flow:
 *   1. POST /{ig-user-id}/media  (image_url + caption) → creation_id
 *   2. POST /{ig-user-id}/media-publish (creation_id) → media_id
 *
 * TODO: 실제 Meta Graph API 연동 필요
 */
async function publishToInstagram(request: PublishRequest): Promise<PublishResult> {
  const now = new Date().toISOString();

  try {
    const token = await resolveOAuthToken('', 'meta');
    if (!token) {
      return { platform: 'instagram', success: false, publishedAt: now, error: 'Meta OAuth 토큰 없음' };
    }

    // TODO: 실제 Meta Graph API 호출
    // const igUserId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    // const createRes = await fetch(`https://graph.facebook.com/v18.0/${igUserId}/media`, {
    //   method: 'POST',
    //   headers: { Authorization: `Bearer ${token.accessToken}` },
    //   body: JSON.stringify({
    //     image_url: request.imageUrls?.[0],
    //     caption: request.caption,
    //   }),
    // });
    // const { id: creationId } = await createRes.json();
    // const publishRes = await fetch(`https://graph.facebook.com/v18.0/${igUserId}/media_publish`, {
    //   method: 'POST',
    //   headers: { Authorization: `Bearer ${token.accessToken}` },
    //   body: JSON.stringify({ creation_id: creationId }),
    // });
    // const { id: mediaId } = await publishRes.json();

    console.log(`[social-publisher] [INSTAGRAM] 발행 stub: caption=${request.caption.slice(0, 50)}... token_expires=${token.expiresAt?.toISOString() ?? 'unknown'}`);

    return {
      platform: 'instagram',
      success: true,
      externalPostId: `stub_ig_${Date.now()}`,
      publishedAt: now,
    };
  } catch (err) {
    return {
      platform: 'instagram',
      success: false,
      publishedAt: now,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Facebook Graph API 발행
 *
 * TODO: 실제 Meta Graph API 연동 필요
 */
async function publishToFacebook(request: PublishRequest): Promise<PublishResult> {
  const now = new Date().toISOString();

  try {
    const token = await resolveOAuthToken('', 'meta');
    if (!token) {
      return { platform: 'facebook', success: false, publishedAt: now, error: 'Meta OAuth 토큰 없음' };
    }

    // TODO: 실제 Meta Graph API 호출
    // POST /{page-id}/feed

    console.log(`[social-publisher] [FACEBOOK] 발행 stub: caption=${request.caption.slice(0, 50)}...`);

    return {
      platform: 'facebook',
      success: true,
      externalPostId: `stub_fb_${Date.now()}`,
      publishedAt: now,
    };
  } catch (err) {
    return {
      platform: 'facebook',
      success: false,
      publishedAt: now,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Threads API 발행
 *
 * Flow: Instagram과 동일한 Meta Graph API 사용
 * TODO: 실제 Meta Threads API 연동 필요
 */
async function publishToThreads(request: PublishRequest): Promise<PublishResult> {
  const now = new Date().toISOString();

  try {
    const token = await resolveOAuthToken('', 'meta');
    if (!token) {
      return { platform: 'threads', success: false, publishedAt: now, error: 'Meta OAuth 토큰 없음' };
    }

    // TODO: 실제 Threads API 호출
    // POST /{threads-user-id}/threads
    // POST /{threads-user-id}/threads/publish

    console.log(`[social-publisher] [THREADS] 발행 stub: caption=${request.caption.slice(0, 50)}...`);

    return {
      platform: 'threads',
      success: true,
      externalPostId: `stub_threads_${Date.now()}`,
      publishedAt: now,
    };
  } catch (err) {
    return {
      platform: 'threads',
      success: false,
      publishedAt: now,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Twitter / X API 발행
 *
 * TODO: 실제 Twitter API v2 연동 필요
 */
async function publishToTwitter(request: PublishRequest): Promise<PublishResult> {
  const now = new Date().toISOString();

  // TODO: 실제 Twitter API 호출
  // const token = await resolveOAuthToken('', 'twitter');
  // POST /2/tweets { text, media }

  console.log(`[social-publisher] [TWITTER] 발행 stub: caption=${request.caption.slice(0, 50)}...`);

  return {
    platform: 'twitter',
    success: true,
    externalPostId: `stub_tw_${Date.now()}`,
    publishedAt: now,
  };
}

/**
 * Naver Cafe API 발행
 *
 * TODO: 실제 Naver Cafe API 연동 필요
 */
async function publishToNaverCafe(request: PublishRequest): Promise<PublishResult> {
  const now = new Date().toISOString();

  try {
    const token = await resolveOAuthToken('', 'naver');
    if (!token) {
      return { platform: 'naver_cafe', success: false, publishedAt: now, error: 'Naver OAuth 토큰 없음' };
    }

    // TODO: 실제 Naver Cafe API 호출
    // POST /v1/cafe/{cafe-id}/articles
    // Authorization: Bearer {access_token}

    console.log(`[social-publisher] [NAVER_CAFE] 발행 stub: caption=${request.caption.slice(0, 50)}...`);

    return {
      platform: 'naver_cafe',
      success: true,
      externalPostId: `stub_nc_${Date.now()}`,
      publishedAt: now,
    };
  } catch (err) {
    return {
      platform: 'naver_cafe',
      success: false,
      publishedAt: now,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Health Check Helpers ────────────────────────────────────────────────────

async function checkMetaTokenHealth(
  platform: SocialPlatform,
  tenantId?: string,
): Promise<{ ok: boolean; message: string }> {
  const token = await resolveOAuthToken(tenantId ?? '', 'meta');
  if (!token) {
    return { ok: false, message: 'Meta OAuth 토큰 없음 — 소셜 미디어 연동 필요' };
  }

  const expiresAt = token.expiresAt;
  if (expiresAt && expiresAt.getTime() < Date.now()) {
    return { ok: false, message: `Meta OAuth 토큰 만료 (${expiresAt.toISOString()})` };
  }

  const daysLeft = expiresAt
    ? Math.round((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : undefined;

  return {
    ok: true,
    message: daysLeft !== undefined
      ? `${platform} OAuth 연결됨, ${daysLeft}일 후 만료`
      : `${platform} OAuth 연결됨`,
  };
}

async function checkNaverTokenHealth(
  tenantId?: string,
): Promise<{ ok: boolean; message: string }> {
  const token = await resolveOAuthToken(tenantId ?? '', 'naver');
  if (!token) {
    return { ok: false, message: 'Naver OAuth 토큰 없음 — 네이버 연동 필요' };
  }

  const expiresAt = token.expiresAt;
  if (expiresAt && expiresAt.getTime() < Date.now()) {
    return { ok: false, message: `Naver OAuth 토큰 만료 (${expiresAt.toISOString()})` };
  }

  return { ok: true, message: 'Naver OAuth 연결됨' };
}
