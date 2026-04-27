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
 * 폴백 — `after` 이후 가장 가까운 평일(월~금) 19:00 KST 반환.
 *
 * 구현: Intl.DateTimeFormat 으로 KST 시각 포맷 → 요일·시각 판정 →
 * 19시 미달이면 오늘, 지났으면 +1일. 토(6)/일(0) 이면 다음 평일.
 * KST 19:00 은 UTC 10:00 (DST 없음, KST 고정 +9).
 */
function nextWeekday19KST(after: Date): Date {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  // KST 자정 기준의 yyyy-mm-dd 와 시간을 한 번에 추출
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  });
  const parts = fmt.formatToParts(after).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const kstHour = parseInt(parts.hour, 10);
  const kstMinute = parseInt(parts.minute, 10);
  const today19InUtc = new Date(`${parts.year}-${parts.month}-${parts.day}T19:00:00+09:00`);

  // 오늘 19시가 아직 안 지났으면 오늘 19시 후보, 아니면 +1일
  let candidate = (kstHour > 19 || (kstHour === 19 && kstMinute > 0))
    ? new Date(today19InUtc.getTime() + ONE_DAY_MS)
    : today19InUtc;

  // 평일 보장 (KST 기준 요일 판정)
  for (let i = 0; i < 7; i += 1) {
    const dow = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' })
      .format(candidate);
    if (dow !== 'Sat' && dow !== 'Sun') break;
    candidate = new Date(candidate.getTime() + ONE_DAY_MS);
  }
  return candidate;
}
