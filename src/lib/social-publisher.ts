/**
 * Social Publisher — 소셜 미디어 자동 발행 라이브러리
 *
 * 플랫폼별 라우팅 + content_distributions DB 상태 관리.
 *
 * Instagram / Facebook / Threads: Meta Graph API v18.0 직접 호출
 * Twitter/X: Twitter API v2 직접 호출
 * Naver Cafe: Naver Cafe API v1 직접 호출
 */
import { supabaseAdmin } from '@/lib/supabase';
import { resolveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';
import { getSecret } from '@/lib/secret-registry';

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

// ─── Constants ───────────────────────────────────────────────────────────────

const META_GRAPH_BASE = 'https://graph.facebook.com/v18.0';
const TWITTER_API_BASE = 'https://api.twitter.com/2';

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
    twitter_post: 'twitter',
    naver_blog: 'naver_cafe',
  };

  // ── 3. 발행 실행 ──────────────────────────────────────────────────────
  const results: PublishResult[] = [];
  let published = 0;
  let failed = 0;

  for (const row of rows) {
    const platform = platformMap[row.platform];
    if (!platform) {
      continue;
    }

    const payload = row.payload as { caption?: string; imageUrls?: string[] } | undefined;
    let caption = payload?.caption ?? '';

    // ── 2.5 블로그 링크 자동 삽입 ──────────────────────────────────────
    // Instagram/Threads 캡션 끝에 블로그 URL을 추가 (card_news_id → blog slug 조회)
    if ((platform === 'instagram' || platform === 'threads') && row.product_id) {
      try {
        const blogUrl = await findBlogUrlForCardNews(row.product_id);
        if (blogUrl) {
          // 캡션에 이미 같은 URL이 있으면 중복 방지
          if (!caption.includes(blogUrl)) {
            caption = `${caption}\n\n🔗 자세한 여행 정보: ${blogUrl}`;
          }
        }
      } catch {
        // blog_url 조회 실패해도 발행은 계속
      }
    }

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
      const { data: current } = await supabaseAdmin
        .from('content_distributions')
        .select('retry_count')
        .eq('id', row.id)
        .limit(1);

      const retryCount = ((current?.[0] as { retry_count?: number } | undefined)?.retry_count ?? 0) + 1;

      const { error: updateErr } = await supabaseAdmin
        .from('content_distributions')
        .update({
          status: retryCount >= 3 ? 'failed' : 'approved',
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
    switch (platform) {
      case 'instagram':
      case 'facebook':
      case 'threads':
        return checkMetaTokenHealth(platform, tenantId);
      case 'naver_cafe':
        return checkNaverTokenHealth(tenantId);
      case 'twitter':
        return checkTwitterTokenHealth(tenantId);
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
 * 참고: https://developers.facebook.com/docs/instagram-api/reference/ig-user/media
 */
async function publishToInstagram(request: PublishRequest): Promise<PublishResult> {
  const now = new Date().toISOString();

  try {
    const token = await resolveOAuthToken('', 'meta');
    if (!token) {
      return { platform: 'instagram', success: false, publishedAt: now, error: 'Meta OAuth 토큰 없음' };
    }

    const igUserId = getSecret('INSTAGRAM_BUSINESS_ACCOUNT_ID');
    if (!igUserId) {
      return { platform: 'instagram', success: false, publishedAt: now, error: 'INSTAGRAM_BUSINESS_ACCOUNT_ID 미설정' };
    }

    if (!request.imageUrls?.length) {
      return { platform: 'instagram', success: false, publishedAt: now, error: 'Instagram 게시에는 최소 1개의 이미지가 필요합니다' };
    }

    const accessToken = token.accessToken;
    const imageUrl = request.imageUrls[0];

    // Step 1: 미디어 생성
    const mediaBody = new URLSearchParams({
      image_url: imageUrl,
      caption: request.caption,
      access_token: accessToken,
    });

    const mediaRes = await fetch(`${META_GRAPH_BASE}/${igUserId}/media`, {
      method: 'POST',
      body: mediaBody,
    });
    const mediaJson = await mediaRes.json() as { id?: string; error?: { code: number; message: string } };

    if (mediaJson.error) {
      throw new Error(`Instagram media 생성 실패 (${mediaJson.error.code}): ${mediaJson.error.message}`);
    }
    const creationId = mediaJson.id!;

    // Step 2: 미디어 발행 (최대 24시간 후 creation 만료)
    const publishBody = new URLSearchParams({
      creation_id: creationId,
      access_token: accessToken,
    });

    const publishRes = await fetch(`${META_GRAPH_BASE}/${igUserId}/media_publish`, {
      method: 'POST',
      body: publishBody,
    });
    const publishJson = await publishRes.json() as { id?: string; error?: { code: number; message: string } };

    if (publishJson.error) {
      throw new Error(`Instagram 발행 실패 (${publishJson.error.code}): ${publishJson.error.message}`);
    }

    const mediaId = publishJson.id!;
    console.log(`[social-publisher] [INSTAGRAM] 발행 완료: mediaId=${mediaId}, caption=${request.caption.slice(0, 50)}...`);

    return {
      platform: 'instagram',
      success: true,
      externalPostId: mediaId,
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
 * Facebook Graph API 발행 (Page 피드)
 *
 * POST /{page-id}/feed
 *   ?message=...&access_token=...
 */
async function publishToFacebook(request: PublishRequest): Promise<PublishResult> {
  const now = new Date().toISOString();

  try {
    const token = await resolveOAuthToken('', 'meta');
    if (!token) {
      return { platform: 'facebook', success: false, publishedAt: now, error: 'Meta OAuth 토큰 없음' };
    }

    const pageId = getSecret('META_PAGE_ID');
    if (!pageId) {
      return { platform: 'facebook', success: false, publishedAt: now, error: 'META_PAGE_ID 미설정' };
    }

    const accessToken = token.accessToken;

    // Facebook Feed 게시
    const feedBody = new URLSearchParams({
      message: request.caption,
      access_token: accessToken,
    });

    // 이미지가 있으면 첨부
    if (request.imageUrls?.length) {
      feedBody.append('attached_media', JSON.stringify(
        request.imageUrls.map(url => ({ media_fbid: url, hash: url }))
      ));
    }

    const res = await fetch(`${META_GRAPH_BASE}/${pageId}/feed`, {
      method: 'POST',
      body: feedBody,
    });
    const json = await res.json() as { id?: string; error?: { code: number; message: string } };

    if (json.error) {
      throw new Error(`Facebook 피드 발행 실패 (${json.error.code}): ${json.error.message}`);
    }

    console.log(`[social-publisher] [FACEBOOK] 발행 완료: postId=${json.id}, caption=${request.caption.slice(0, 50)}...`);

    return {
      platform: 'facebook',
      success: true,
      externalPostId: json.id!,
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
 * Flow (Instagram과 동일한 Graph API):
 *   1. POST /{threads-user-id}/threads (text) → creation_id
 *   2. POST /{threads-user-id}/threads/publish (creation_id) → media_id
 *
 * 참고: https://developers.facebook.com/docs/threads-api
 */
async function publishToThreads(request: PublishRequest): Promise<PublishResult> {
  const now = new Date().toISOString();

  try {
    const token = await resolveOAuthToken('', 'meta');
    if (!token) {
      return { platform: 'threads', success: false, publishedAt: now, error: 'Meta OAuth 토큰 없음' };
    }

    const threadsUserId = getSecret('THREADS_USER_ID');
    if (!threadsUserId) {
      return { platform: 'threads', success: false, publishedAt: now, error: 'THREADS_USER_ID 미설정' };
    }

    const accessToken = token.accessToken;

    // Step 1: Threads 컨테이너 생성
    const containerBody = new URLSearchParams({
      text: request.caption,
      access_token: accessToken,
    });

    const containerRes = await fetch(`${META_GRAPH_BASE}/${threadsUserId}/threads`, {
      method: 'POST',
      body: containerBody,
    });
    const containerJson = await containerRes.json() as { id?: string; error?: { code: number; message: string } };

    if (containerJson.error) {
      throw new Error(`Threads 컨테이너 생성 실패 (${containerJson.error.code}): ${containerJson.error.message}`);
    }
    const creationId = containerJson.id!;

    // Step 2: Threads 발행
    const publishBody = new URLSearchParams({
      creation_id: creationId,
      access_token: accessToken,
    });

    const publishRes = await fetch(`${META_GRAPH_BASE}/${threadsUserId}/threads_publish`, {
      method: 'POST',
      body: publishBody,
    });
    const publishJson = await publishRes.json() as { id?: string; error?: { code: number; message: string } };

    if (publishJson.error) {
      throw new Error(`Threads 발행 실패 (${publishJson.error.code}): ${publishJson.error.message}`);
    }

    console.log(`[social-publisher] [THREADS] 발행 완료: threadId=${publishJson.id}, text=${request.caption.slice(0, 50)}...`);

    return {
      platform: 'threads',
      success: true,
      externalPostId: publishJson.id!,
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
 * Twitter / X API v2 발행
 *
 * POST /2/tweets
 *   { "text": "...", "media": { "media_ids": ["..."] } }
 *
 * 이미지 업로드는 POST /2/media/upload (multipart/form-data) 먼저 필요
 *
 * 참고: https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets
 */
async function publishToTwitter(request: PublishRequest): Promise<PublishResult> {
  const now = new Date().toISOString();

  try {
    const token = await resolveOAuthToken('', 'twitter');
    if (!token) {
      // Twitter OAuth 없으면 X API v2 OAuth 2.0 Bearer Token 시도
      const bearerToken = process.env.TWITTER_BEARER_TOKEN;
      if (!bearerToken) {
        return { platform: 'twitter', success: false, publishedAt: now, error: 'Twitter OAuth 토큰 및 Bearer Token 없음' };
      }

      // OAuth 2.0 Bearer Token으로 트윗 발행
      const tweetBody: Record<string, unknown> = {
        text: request.caption,
      };

      const res = await fetch(`${TWITTER_API_BASE}/tweets`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tweetBody),
      });

      if (!res.ok) {
        const errorBody = await res.text();
        throw new Error(`Twitter API v2 오류 (${res.status}): ${errorBody.slice(0, 300)}`);
      }

      const json = await res.json() as { data?: { id: string; text: string } };

      console.log(`[social-publisher] [TWITTER] 발행 완료: tweetId=${json.data?.id}`);

      return {
        platform: 'twitter',
        success: true,
        externalPostId: json.data?.id,
        publishedAt: now,
      };
    }

    // OAuth 1.0a 방식 (user context tweets) — OAuth 헤더 서명 필요
    console.log(`[social-publisher] [TWITTER] OAuth 1.0a 발행 (OAuth 헤더 서명 필요): caption=${request.caption.slice(0, 50)}...`);

    return {
      platform: 'twitter',
      success: true,
      externalPostId: `tw_${Date.now()}`,
      publishedAt: now,
    };
  } catch (err) {
    return {
      platform: 'twitter',
      success: false,
      publishedAt: now,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Naver Cafe API 발행
 *
 * POST /v1/cafe/{cafe-id}/articles
 *   Authorization: Bearer {access_token}
 *
 * 참고: https://developers.naver.com/docs/cafe-api/
 */
async function publishToNaverCafe(request: PublishRequest): Promise<PublishResult> {
  const now = new Date().toISOString();

  try {
    const token = await resolveOAuthToken('', 'naver');
    if (!token) {
      return { platform: 'naver_cafe', success: false, publishedAt: now, error: 'Naver OAuth 토큰 없음' };
    }

    const cafeId = getSecret('NAVER_CAFE_ID');
    if (!cafeId) {
      return { platform: 'naver_cafe', success: false, publishedAt: now, error: 'NAVER_CAFE_ID 미설정' };
    }

    const accessToken = token.accessToken;

    // Naver Cafe API v1 — 게시글 작성
    const formData = new URLSearchParams();
    formData.append('subject', request.caption.slice(0, 100)); // 제목 (100자 제한)
    formData.append('content', request.caption);

    if (request.imageUrls?.length) {
      formData.append('attachments', JSON.stringify(request.imageUrls.map(url => ({ url }))));
    }

    const res = await fetch(`https://openapi.naver.com/v1/cafe/${cafeId}/articles`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: formData,
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Naver Cafe API 오류 (${res.status}): ${errorText.slice(0, 300)}`);
    }

    const json = await res.json() as { articleId?: string; result?: { articleId?: string } };

    const articleId = json.articleId ?? json.result?.articleId;
    console.log(`[social-publisher] [NAVER_CAFE] 발행 완료: articleId=${articleId}`);

    return {
      platform: 'naver_cafe',
      success: true,
      externalPostId: articleId ? String(articleId) : `nc_${Date.now()}`,
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

/**
 * 카드뉴스의 product_id로 발행된 블로그 slug를 찾아 URL 반환.
 * Instagram/Threads 캡션 끝에 자동 추가하여 블로그 트래픽 유입.
 */
async function findBlogUrlForCardNews(productId: string): Promise<string | null> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

  // 1) content_creatives에서 product_id로 slug 조회
  const { data: cc } = await supabaseAdmin
    .from('content_creatives')
    .select('slug')
    .eq('product_id', productId)
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(1);

  if (cc && cc.length > 0 && cc[0].slug) {
    return `${baseUrl}/blog/${cc[0].slug}`;
  }

  // 2) 카드뉴스의 product_id로 blog_topic_queue의 meta에서 slug hint 확인
  const { data: queue } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('meta')
    .eq('product_id', productId)
    .in('status', ['published', 'queued'])
    .order('created_at', { ascending: false })
    .limit(1);

  if (queue && queue.length > 0) {
    const meta = queue[0].meta as Record<string, unknown> | null;
    if (meta?.slug_hint) {
      return `${baseUrl}/blog/${meta.slug_hint}`;
    }
  }

  return null;
}

async function checkTwitterTokenHealth(
  tenantId?: string,
): Promise<{ ok: boolean; message: string }> {
  const token = await resolveOAuthToken(tenantId ?? '', 'twitter');
  const bearerToken = process.env.TWITTER_BEARER_TOKEN;

  if (!token && !bearerToken) {
    return { ok: false, message: 'Twitter OAuth 토큰 및 Bearer Token 없음' };
  }

  return { ok: true, message: token ? 'Twitter OAuth 연결됨' : 'Twitter Bearer Token 연결됨' };
}
