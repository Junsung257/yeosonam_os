/**
 * Best Time to Post 엔진 — Buffer 패턴 자체 구현.
 *
 * post_engagement_snapshots 시계열을 기반으로 플랫폼·요일·시간대별
 * 평균 engagement 점수를 계산해 최적 발행 시각을 추천한다.
 *
 * - DB view  : best_publish_slots
 * - DB RPC   : recommend_publish_slot(platform, tenant_id, after, horizon_hours)
 * - 데이터 부족(<5 표본) 시 자동 신뢰도 보정 + 평일 19:00 KST 폴백
 *
 * 외부 SaaS 0원, Supabase RPC 한 번 호출.
 */
import { supabaseAdmin, isSupabaseConfigured } from './supabase';

export type Platform =
  | 'instagram'
  | 'instagram_caption'
  | 'instagram_carousel'
  | 'threads'
  | 'threads_post'
  | 'meta_ads'
  | 'kakao_channel'
  | 'google_ads_rsa'
  | 'blog_body';

const PLATFORM_NORMALIZE: Record<string, string> = {
  instagram_caption: 'instagram',
  instagram_carousel: 'instagram',
  threads_post: 'threads',
};

export interface BestTimeOptions {
  platform: Platform;
  tenantId?: string | null;
  /** 최소 이 시각 이후 발행. default = now() */
  after?: Date;
  /** 검토 범위 (시간). default = 72h */
  horizonHours?: number;
}

export interface BestTimeResult {
  scheduledFor: Date;
  source: 'data_driven' | 'fallback_default';
  /** 표본 부족·DB 미설정 등 폴백 사유 */
  reason?: string;
}

/**
 * 단일 추천 발행 시각.
 * DB RPC 우선, 실패/미설정 시 평일 19:00 KST 폴백.
 */
export async function recommendPublishSlot(opts: BestTimeOptions): Promise<BestTimeResult> {
  const platform = PLATFORM_NORMALIZE[opts.platform] ?? opts.platform;
  const after = opts.after ?? new Date();
  const horizon = opts.horizonHours ?? 72;

  if (!isSupabaseConfigured) {
    return { scheduledFor: nextWeekday19KST(after), source: 'fallback_default', reason: 'DB 미설정' };
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('recommend_publish_slot', {
      p_platform: platform,
      p_tenant_id: opts.tenantId ?? null,
      p_after: after.toISOString(),
      p_horizon_hours: horizon,
    });
    if (error) {
      return {
        scheduledFor: nextWeekday19KST(after),
        source: 'fallback_default',
        reason: `RPC error: ${error.message}`,
      };
    }
    if (!data) {
      return { scheduledFor: nextWeekday19KST(after), source: 'fallback_default', reason: 'no data' };
    }
    return { scheduledFor: new Date(data as string), source: 'data_driven' };
  } catch (e) {
    return {
      scheduledFor: nextWeekday19KST(after),
      source: 'fallback_default',
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * N건 동시 발행 시 충돌 방지 — 1시간 간격으로 분산.
 */
export async function recommendPublishSlots(
  count: number,
  opts: BestTimeOptions,
): Promise<BestTimeResult[]> {
  const slots: BestTimeResult[] = [];
  let cursor = opts.after ?? new Date();
  for (let i = 0; i < count; i += 1) {
    const slot = await recommendPublishSlot({ ...opts, after: cursor });
    slots.push(slot);
    // 다음 후보는 직전 slot + 1h 이후
    cursor = new Date(slot.scheduledFor.getTime() + 60 * 60 * 1000);
  }
  return slots;
}

/**
 * 폴백 — 다음 평일(월~금) 19:00 KST.
 * KST = UTC+9. Date 는 UTC 보존.
 */
function nextWeekday19KST(after: Date): Date {
  // KST 기준 19:00
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(after.getTime() + kstOffset);
  const candidate = new Date(kstNow);
  candidate.setUTCHours(19, 0, 0, 0);
  if (candidate <= kstNow) candidate.setUTCDate(candidate.getUTCDate() + 1);
  while ([0, 6].includes(candidate.getUTCDay())) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return new Date(candidate.getTime() - kstOffset);
}
