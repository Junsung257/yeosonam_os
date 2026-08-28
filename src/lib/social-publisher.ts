/**
 * Social Publisher — 소셜 미디어 자동 발행 라이브러리
 *
 * 플랫폼별 라우팅 + content_distributions DB 상태 관리.
 *
 * Instagram / Facebook / Threads: Meta Graph API v18.0 직접 호출
 * Twitter/X: Twitter API v2 직접 호출
 * Naver Cafe: Naver Cafe API v1 직접 호출
 */
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase';
import {
  resolveOAuthToken,
  resolvePlatformOAuthToken,
  type OAuthProvider,
} from '@/lib/marketing-pipeline/token-resolver';
import { getSecret } from '@/lib/secret-registry';
import {
  getThreadsConfig,
  publishToThreads as publishToThreadsCore,
} from '@/lib/threads-publisher';
import { isUuid } from '@/lib/uuid';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SocialPlatform = 'instagram' | 'facebook' | 'threads' | 'twitter' | 'naver_cafe';

export interface PublishRequest {
  contentDistributionId: string;
  platform: SocialPlatform;
  tenantId?: string;
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
  /** External request may have been accepted even though the response failed. */
  requiresReconciliation?: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const META_GRAPH_BASE = 'https://graph.facebook.com/v18.0';
const TWITTER_API_BASE = 'https://api.twitter.com/2';
const PUBLISH_LEASE_MS = 10 * 60 * 1000;

type PublishQueueRow = {
  id: string;
  tenant_id: string | null;
  platform: string;
  payload: Record<string, unknown> | null;
  product_id: string | null;
};

async function resolvePublishingToken(
  tenantId: string | undefined,
  provider: OAuthProvider,
) {
  return tenantId
    ? resolveOAuthToken(tenantId, provider)
    : resolvePlatformOAuthToken(provider);
}

function resolvePublishingAccountId(
  token: { metadata?: Record<string, unknown> },
  tenantId: string | undefined,
  metadataKey: string,
  platformSecretKey: 'INSTAGRAM_BUSINESS_ACCOUNT_ID' | 'META_PAGE_ID' | 'THREADS_USER_ID' | 'NAVER_CAFE_ID',
): string | null {
  if (!tenantId) return getSecret(platformSecretKey);
  const value = token.metadata?.[metadataKey];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
  const limit = Math.max(1, Math.min(opts?.limit ?? 10, 100));
  const tenantId = opts?.tenantId?.trim();
  if (opts?.tenantId !== undefined && (!tenantId || !isUuid(tenantId))) {
    return { published: 0, failed: 0, results: [] };
  }

  // ── 1. 승인된 콘텐츠 조회 ──────────────────────────────────────────────
  // publishing lease가 만료된 행은 외부 게시 결과가 불명확할 수 있으므로
  // 자동 재취득하지 않는다. 운영 reconcile 후 approved로 되돌린 경우에만
  // 다시 처리해 duplicate external post를 방지한다.
  let approvedQuery = supabaseAdmin
    .from('content_distributions')
    .select('id, tenant_id, platform, payload, product_id')
    .eq('status', 'approved')
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (opts?.platform) {
    approvedQuery = approvedQuery.eq('platform', opts.platform);
  }
  if (tenantId) {
    approvedQuery = approvedQuery.eq('tenant_id', tenantId);
  }

  const { data: approvedRows, error: approvedErr } = await approvedQuery;

  if (approvedErr) {
    console.error('[social-publisher] 승인 콘텐츠 조회 실패:', approvedErr);
    return { published: 0, failed: 0, results: [] };
  }

  const rows = (approvedRows ?? []) as unknown as PublishQueueRow[];
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

    // 여러 worker가 동시에 같은 approved row를 읽어도, 이 조건부 UPDATE 중
    // 하나만 publishing lease를 획득하도록 한다.
    const claimToken = randomUUID();
    const claimExpiresAt = new Date(Date.now() + PUBLISH_LEASE_MS).toISOString();
    let claimQuery = supabaseAdmin
      .from('content_distributions')
      .update({
        status: 'publishing',
        publish_claim_token: claimToken,
        publish_lease_expires_at: claimExpiresAt,
        publish_claimed_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (row.tenant_id) claimQuery = claimQuery.eq('tenant_id', row.tenant_id);
    else claimQuery = claimQuery.is('tenant_id', null);
    claimQuery = claimQuery.eq('status', 'approved');
    const { data: claimed, error: claimErr } = await claimQuery.select('id').maybeSingle();
    if (claimErr || !claimed) continue;

    const result = await publishToSocial({
      contentDistributionId: row.id,
      platform,
      tenantId: typeof row.tenant_id === 'string' ? row.tenant_id.trim() : undefined,
      caption,
      imageUrls: payload?.imageUrls,
    });

    // ── 4. DB 상태 업데이트 ────────────────────────────────────────────
    if (result.success) {
      let updateQuery = supabaseAdmin
        .from('content_distributions')
        .update({
          status: 'published',
          external_id: result.externalPostId ?? null,
          published_at: result.publishedAt,
          publish_claim_token: null,
          publish_lease_expires_at: null,
          publish_claimed_at: null,
        })
        .eq('id', row.id);
      updateQuery = updateQuery.eq('status', 'publishing').eq('publish_claim_token', claimToken);
      if (row.tenant_id) updateQuery = updateQuery.eq('tenant_id', row.tenant_id);
      else updateQuery = updateQuery.is('tenant_id', null);
      const { error: updateErr } = await updateQuery;

      if (updateErr) {
        console.error(`[social-publisher] DB 업데이트 실패 (published): row=${row.id}`, updateErr);
      }

      published++;
    } else {
      let currentQuery = supabaseAdmin
        .from('content_distributions')
        .select('retry_count')
        .eq('id', row.id)
        .eq('status', 'publishing')
        .eq('publish_claim_token', claimToken)
        .limit(1);
      if (row.tenant_id) currentQuery = currentQuery.eq('tenant_id', row.tenant_id);
      else currentQuery = currentQuery.is('tenant_id', null);
      const { data: current } = await currentQuery;

      const retryCount = ((current?.[0] as { retry_count?: number } | undefined)?.retry_count ?? 0) + 1;
      const nextStatus = result.requiresReconciliation
        ? 'needs_reconcile'
        : retryCount >= 3
          ? 'failed'
          : 'approved';

      let updateQuery = supabaseAdmin
        .from('content_distributions')
        .update({
          status: nextStatus,
          retry_count: retryCount,
          error_message: result.error ?? null,
          publish_claim_token: null,
          publish_lease_expires_at: null,
          publish_claimed_at: null,
        })
        .eq('id', row.id);
      updateQuery = updateQuery.eq('status', 'publishing').eq('publish_claim_token', claimToken);
      if (row.tenant_id) updateQuery = updateQuery.eq('tenant_id', row.tenant_id);
      else updateQuery = updateQuery.is('tenant_id', null);
      const { error: updateErr } = await updateQuery;

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
    const token = await resolvePublishingToken(request.tenantId, 'meta');
    if (!token) {
      return { platform: 'instagram', success: false, publishedAt: now, error: 'Meta OAuth 토큰 없음' };
    }

    const igUserId = resolvePublishingAccountId(
      token,
      request.tenantId,
      'instagram_business_account_id',
      'INSTAGRAM_BUSINESS_ACCOUNT_ID',
    );
    if (!igUserId) {
      return { platform: 'instagram', success: false, publishedAt: now, error: request.tenantId ? '테넌트 Instagram 계정 ID 미등록' : 'INSTAGRAM_BUSINESS_ACCOUNT_ID 미설정' };
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
      requiresReconciliation: true,
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
    const token = await resolvePublishingToken(request.tenantId, 'meta');
    if (!token) {
      return { platform: 'facebook', success: false, publishedAt: now, error: 'Meta OAuth 토큰 없음' };
    }

    const pageId = resolvePublishingAccountId(
      token,
      request.tenantId,
      'facebook_page_id',
      'META_PAGE_ID',
    );
    if (!pageId) {
      return { platform: 'facebook', success: false, publishedAt: now, error: request.tenantId ? '테넌트 Facebook Page ID 미등록' : 'META_PAGE_ID 미설정' };
    }

    const accessToken = token.accessToken;

    // Facebook Feed 게시
    const feedBody = new URLSearchParams({
      message: request.caption,
      access_token: accessToken,
    });

    // 이미지가 있으면 첨부
    if (request.imageUrls?.length) {
      // Facebook Feed 이미지 첨부는 media_fbid가 아닌 url 배열 사용
      feedBody.append('attached_media', JSON.stringify(
        request.imageUrls.map(url => ({ media_fbid: url }))
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
      requiresReconciliation: true,
    };
  }
}

/**
 * Threads API 발행 — threads-publisher.ts 의 publishToThreads 로 위임
 *
 * Flow:
 *   1. Threads OAuth 토큰 조회
 *   2. threads-publisher.ts 의 publishToThreads (container 생성 + 폴링 + publish)
 *   3. 결과를 PublishResult 로 변환
 */
async function publishToThreads(request: PublishRequest): Promise<PublishResult> {
  const now = new Date().toISOString();

  try {
    const platformThreadsConfig = request.tenantId ? null : await getThreadsConfig();
    const token = platformThreadsConfig
      ? { accessToken: platformThreadsConfig.accessToken }
      : await resolvePublishingToken(request.tenantId, 'meta');
    if (!token) {
      return { platform: 'threads', success: false, publishedAt: now, error: 'Meta OAuth 토큰 없음' };
    }

    const threadsUserId = platformThreadsConfig?.threadsUserId ?? resolvePublishingAccountId(
      token,
      request.tenantId,
      'threads_user_id',
      'THREADS_USER_ID',
    );
    if (!threadsUserId) {
      return { platform: 'threads', success: false, publishedAt: now, error: request.tenantId ? '테넌트 Threads 사용자 ID 미등록' : 'THREADS_USER_ID 미설정' };
    }

    const accessToken = token.accessToken;

    // threads-publisher.ts 의 저수준 함수로 위임 (이미지+캐러셀+폴링 포함)
    const result = await publishToThreadsCore({
      threadsUserId,
      accessToken,
      text: request.caption,
      imageUrls: request.imageUrls && request.imageUrls.length > 0 ? request.imageUrls : undefined,
    });

    if (!result.ok) {
      return {
        platform: 'threads',
        success: false,
        publishedAt: now,
        error: result.error ?? `Threads 발행 실패 (step: ${result.step})`,
        requiresReconciliation: result.step !== 'validate',
      };
    }

    console.log(`[social-publisher] [THREADS] 발행 완료: threadId=${result.postId}, text=${request.caption.slice(0, 50)}...`);

    return {
      platform: 'threads',
      success: true,
      externalPostId: result.postId!,
      publishedAt: now,
    };
  } catch (err) {
    return {
      platform: 'threads',
      success: false,
      publishedAt: now,
      error: err instanceof Error ? err.message : String(err),
      requiresReconciliation: true,
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
    const token = await resolvePublishingToken(request.tenantId, 'twitter');
    if (!token) {
      // 테넌트 발행은 공용 bearer로 우회하지 않는다. 공용 bearer는
      // 명시적인 platform-scoped 작업에서만 허용한다.
      if (request.tenantId) {
        return { platform: 'twitter', success: false, publishedAt: now, error: '테넌트 Twitter OAuth 토큰 없음' };
      }

      // Twitter OAuth 없으면 명시적인 platform-scoped 작업에서만 bearer 시도
      const bearerToken = getSecret('TWITTER_BEARER_TOKEN');
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

    // OAuth 1.0a user-context 서명이 아직 구현되지 않았으므로 가짜
    // external id를 반환하지 않는다. 외부 발행이 확인된 경우에만
    // content_distributions를 published로 전환해야 한다.
    return {
      platform: 'twitter',
      success: false,
      publishedAt: now,
      error: 'Twitter user-context publisher is not configured',
    };
  } catch (err) {
    return {
      platform: 'twitter',
      success: false,
      publishedAt: now,
      error: err instanceof Error ? err.message : String(err),
      requiresReconciliation: true,
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
    const token = await resolvePublishingToken(request.tenantId, 'naver');
    if (!token) {
      return { platform: 'naver_cafe', success: false, publishedAt: now, error: 'Naver OAuth 토큰 없음' };
    }

    const cafeId = resolvePublishingAccountId(
      token,
      request.tenantId,
      'naver_cafe_id',
      'NAVER_CAFE_ID',
    );
    if (!cafeId) {
      return { platform: 'naver_cafe', success: false, publishedAt: now, error: request.tenantId ? '테넌트 Naver Cafe ID 미등록' : 'NAVER_CAFE_ID 미설정' };
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
      requiresReconciliation: true,
    };
  }
}

// ─── Health Check Helpers ────────────────────────────────────────────────────

async function checkMetaTokenHealth(
  platform: SocialPlatform,
  tenantId?: string,
): Promise<{ ok: boolean; message: string }> {
  const token = tenantId
    ? await resolveOAuthToken(tenantId, 'meta')
    : await resolvePlatformOAuthToken('meta');
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
  const token = tenantId
    ? await resolveOAuthToken(tenantId, 'naver')
    : await resolvePlatformOAuthToken('naver');
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
  const token = tenantId
    ? await resolveOAuthToken(tenantId, 'twitter')
    : await resolvePlatformOAuthToken('twitter');
  const bearerToken = tenantId ? null : getSecret('TWITTER_BEARER_TOKEN');

  if (!token && !bearerToken) {
    return { ok: false, message: 'Twitter OAuth 토큰 및 Bearer Token 없음' };
  }

  return { ok: true, message: token ? 'Twitter OAuth 연결됨' : 'Twitter Bearer Token 연결됨' };
}
