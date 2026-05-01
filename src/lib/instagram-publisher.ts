/**
 * Instagram Graph API — 카드뉴스 캐러셀 자동 발행
 *
 * 흐름 (Meta 공식 2단계 API):
 *   1. 각 슬라이드 이미지 → POST /{ig_user_id}/media (is_carousel_item=true)
 *      → N개 container_id 반환
 *   2. 각 컨테이너 FINISHED 폴링 (status_code 체크)
 *   3. POST /{ig_user_id}/media (media_type=CAROUSEL, children=[ids])
 *      → carousel_container_id
 *   4. carousel 컨테이너 FINISHED 폴링
 *   5. POST /{ig_user_id}/media_publish (creation_id=carousel_container_id)
 *      → 최종 ig_post_id
 *
 * 제약:
 *   - 캐러셀 아이템 2~10장 (Meta 2026 스펙)
 *   - 모든 image_url은 공개 URL이어야 함 (Supabase blog-assets 버킷 공개 읽기 허용됨)
 *   - 100 posts/24h, 200 API calls/hour
 *
 * 로그 prefix: [ig-publish]
 */

import { resolveMetaToken } from './meta-token-resolver';
import { supabaseAdmin, isSupabaseConfigured } from './supabase';
import { decrypt } from './encryption';

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

export interface PublishCarouselInput {
  igUserId: string;
  accessToken: string;
  imageUrls: string[];  // 2~10장
  caption: string;
}

export interface PublishResult {
  ok: boolean;
  postId?: string;
  error?: string;
  step?: string;  // 어느 단계에서 실패했는지
}

export function isInstagramConfigured(): boolean {
  // 동기 버전 — env 만 체크. 실 토큰 조회는 getInstagramConfig() async.
  return !!(
    (process.env.META_ACCESS_TOKEN || process.env.META_IG_USER_ID) &&
    process.env.META_IG_USER_ID
  );
}

/**
 * 토큰 해석 우선순위:
 *   1. tenantId 지정 시 → instagram_accounts 테이블 (테넌트별 계정)
 *   2. env META_ACCESS_TOKEN → DB system_secrets.META_ACCESS_TOKEN (플랫폼 공용 계정)
 */
export async function getInstagramConfig(
  tenantId?: string | null,
): Promise<{ igUserId: string; accessToken: string } | null> {
  if (tenantId && isSupabaseConfigured) {
    try {
      const { data } = await supabaseAdmin
        .from('instagram_accounts')
        .select('ig_user_id, access_token')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .maybeSingle();
      if (data?.ig_user_id && data?.access_token) {
        let token: string;
        try {
          token = decrypt(data.access_token);
        } catch {
          token = data.access_token; // 암호화 전 레거시 레코드 폴백
        }
        return { igUserId: data.ig_user_id, accessToken: token };
      }
    } catch (err) {
      console.warn('[ig-config] tenant 계정 조회 실패, 공용 계정으로 폴백:', err instanceof Error ? err.message : err);
    }
  }

  // 공용 계정 (env → DB system_secrets)
  const userId = process.env.META_IG_USER_ID;
  if (!userId) return null;
  const token = await resolveMetaToken('META_ACCESS_TOKEN');
  if (!token) return null;
  return { igUserId: userId, accessToken: token };
}

/**
 * 캐러셀 발행 (전체 흐름 오케스트레이션)
 */
export async function publishCarouselToInstagram(input: PublishCarouselInput): Promise<PublishResult> {
  const { igUserId, accessToken, imageUrls, caption } = input;

  if (imageUrls.length < 2 || imageUrls.length > 10) {
    return { ok: false, step: 'validate', error: `캐러셀은 2~10장만 가능 (현재 ${imageUrls.length}장)` };
  }

  try {
    // ── Step 1: 각 이미지 컨테이너 생성 ─────────────────────
    const childIds: string[] = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      console.log('[ig-publish] child-container-create', i + 1, url.slice(0, 60));
      const form = new URLSearchParams({
        image_url: url,
        is_carousel_item: 'true',
        access_token: accessToken,
      });
      const res = await fetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok || !data.id) {
        const msg = data?.error?.message || JSON.stringify(data);
        console.error('[ig-publish] child-container-fail', i + 1, msg);
        return { ok: false, step: `child_container_${i + 1}`, error: msg };
      }
      childIds.push(data.id);
      await sleep(300); // rate limit 방어 (200/hour)
    }

    // ── Step 2: 각 자식 컨테이너 FINISHED 폴링 ──────────────
    // PERF-01: sequential → parallel. 최악 대기 = N×90s → 90s (병렬).
    // 모든 자식 polling 끝나면 결과 합치고, 하나라도 실패면 전체 실패.
    const pollResults = await Promise.all(
      childIds.map((childId) => pollContainerStatus(childId, accessToken)),
    );
    for (let i = 0; i < pollResults.length; i++) {
      if (!pollResults[i].ok) {
        console.error('[ig-publish] child-poll-fail', i + 1, pollResults[i].error);
        return { ok: false, step: `child_poll_${i + 1}`, error: pollResults[i].error };
      }
    }

    // ── Step 3: 캐러셀 부모 컨테이너 생성 ───────────────────
    console.log('[ig-publish] carousel-container-create', childIds.length, '장');
    const carouselForm = new URLSearchParams({
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      caption,
      access_token: accessToken,
    });
    const carouselRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
      method: 'POST',
      body: carouselForm,
    });
    const carouselData = await carouselRes.json();
    if (!carouselRes.ok || !carouselData.id) {
      const msg = carouselData?.error?.message || JSON.stringify(carouselData);
      console.error('[ig-publish] carousel-container-fail', msg);
      return { ok: false, step: 'carousel_container', error: msg };
    }
    const carouselId = carouselData.id as string;

    // ── Step 4: 부모 컨테이너 FINISHED 폴링 ────────────────
    const parentPoll = await pollContainerStatus(carouselId, accessToken);
    if (!parentPoll.ok) {
      console.error('[ig-publish] carousel-poll-fail', parentPoll.error);
      return { ok: false, step: 'carousel_poll', error: parentPoll.error };
    }

    // ── Step 5: 최종 발행 ──────────────────────────────────
    console.log('[ig-publish] media-publish', carouselId);
    const publishForm = new URLSearchParams({
      creation_id: carouselId,
      access_token: accessToken,
    });
    const publishRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media_publish`, {
      method: 'POST',
      body: publishForm,
    });
    const publishData = await publishRes.json();
    if (!publishRes.ok || !publishData.id) {
      const msg = publishData?.error?.message || JSON.stringify(publishData);
      console.error('[ig-publish] media-publish-fail', msg);
      return { ok: false, step: 'media_publish', error: msg };
    }

    console.log('[ig-publish] success', publishData.id);
    return { ok: true, postId: publishData.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ig-publish] unexpected', msg);
    return { ok: false, step: 'unexpected', error: msg };
  }
}

/**
 * 컨테이너 FINISHED 상태 폴링
 * Meta 응답 status_code: IN_PROGRESS | FINISHED | ERROR | PUBLISHED | EXPIRED
 * 최대 18회 × 5초 = 90초 대기
 */
async function pollContainerStatus(
  containerId: string,
  accessToken: string,
  maxAttempts = 18,
  intervalMs = 5000,
): Promise<{ ok: boolean; error?: string }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(intervalMs);
    try {
      const res = await fetch(
        `${GRAPH_API_BASE}/${containerId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`,
      );
      const data = await res.json();
      const status = data.status_code as string | undefined;
      console.log('[ig-publish] poll', containerId, `attempt=${attempt}`, `status=${status}`);
      if (status === 'FINISHED') return { ok: true };
      if (status === 'ERROR' || status === 'EXPIRED') {
        return { ok: false, error: `컨테이너 상태 ${status}` };
      }
      // IN_PROGRESS → 계속 폴링
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[ig-publish] poll-error', containerId, msg);
      // 일시적 네트워크 오류는 재시도
    }
  }
  return { ok: false, error: `폴링 타임아웃 (${maxAttempts * intervalMs}ms)` };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 발행 전 quota 체크 (옵션 — 크론에서 일괄 처리 전 호출 권장)
 * 반환: 남은 quota (100이 최대, 0에 가까우면 스킵)
 */
export async function checkPublishingLimit(
  igUserId: string,
  accessToken: string,
): Promise<{ quotaUsed: number; quotaLimit: number } | null> {
  try {
    const res = await fetch(
      `${GRAPH_API_BASE}/${igUserId}/content_publishing_limit?fields=quota_usage,config&access_token=${encodeURIComponent(accessToken)}`,
    );
    const data = await res.json();
    const entry = Array.isArray(data?.data) ? data.data[0] : null;
    if (!entry) return null;
    return {
      quotaUsed: entry.quota_usage ?? 0,
      quotaLimit: entry.config?.quota_total ?? 100,
    };
  } catch (err) {
    console.warn('[ig-publish] quota-check-fail', err instanceof Error ? err.message : err);
    return null;
  }
}
