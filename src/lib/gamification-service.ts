/**
 * 게이미피케이션 서비스
 *
 * 기능:
 *   - 마일스톤 보상 (누적 결제액 구간별)
 *   - 뱃지 시스템 (획득/조회)
 *   - 출석 체크 / 스트릭 (Phase 3-3)
 *   - 시즌별 챌린지 (Phase 3-4)
 */
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { calcExpiresAt, getEffectiveValidityMonths } from '@/lib/mileage-expiration';

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface CustomerBadge {
  id: string;
  customer_id: string;
  badge_type: string;
  badge_label: string | null;
  badge_description: string | null;
  earned_at: string;
}

export interface MilestoneConfig {
  threshold: number;      // 누적 결제액 기준
  label: string;           // 표시명
  bonusMileage: number;    // 보너스 마일리지
  badgeType?: string;      // 연동 뱃지 타입 (선택)
  badgeLabel?: string;     // 뱃지 표시명
  badgeDesc?: string;      // 뱃지 설명
}

export interface MileageMilestone {
  threshold: number;
  label: string;
  bonusMileage: number;
  achieved: boolean;
  achievedAt?: string;
}

export interface StreakInfo {
  currentStreak: number;       // 연속 출석일
  longestStreak: number;       // 최장 연속 출석일
  lastCheckin: string | null;  // 마지막 출석 일자 (YYYY-MM-DD)
  todayChecked: boolean;       // 오늘 출석 여부
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  condition_type: string;    // booking_count, new_destination, review_photo, referral
  condition_value: number;
  reward_mileage: number;
  reward_badge_type?: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
}

// ── 마일스톤 설정 ────────────────────────────────────────────────────────────

export const MILESTONES: MilestoneConfig[] = [
  { threshold: 1_000_000,  label: '첫 100만원 돌파',    bonusMileage: 1000,  badgeType: 'milestone_1m',    badgeLabel: '100만 클럽',     badgeDesc: '누적 결제 100만원 달성' },
  { threshold: 3_000_000,  label: '300만원 돌파',       bonusMileage: 3000,  badgeType: 'milestone_3m',    badgeLabel: '300만 클럽',     badgeDesc: '누적 결제 300만원 달성' },
  { threshold: 5_000_000,  label: '500만원 돌파',       bonusMileage: 5000,  badgeType: 'milestone_5m',    badgeLabel: '500만 클럽',     badgeDesc: '누적 결제 500만원 달성' },
  { threshold: 10_000_000, label: '1000만원 돌파 (VVIP)', bonusMileage: 10000, badgeType: 'milestone_10m',   badgeLabel: '1000만 클럽',    badgeDesc: '누적 결제 1000만원 달성' },
  { threshold: 30_000_000, label: '3000만원 돌파',       bonusMileage: 30000, badgeType: 'milestone_30m',   badgeLabel: '3000만 클럽',    badgeDesc: '누적 결제 3000만원 달성' },
];

// ── 뱃지 정의 ────────────────────────────────────────────────────────────────

export const BADGE_DEFINITIONS: Record<string, { label: string; description: string; icon: string }> = {
  // 마일스톤
  milestone_1m:  { label: '100만 클럽',     description: '누적 결제 100만원 달성',     icon: '🥉' },
  milestone_3m:  { label: '300만 클럽',     description: '누적 결제 300만원 달성',     icon: '🥈' },
  milestone_5m:  { label: '500만 클럽',     description: '누적 결제 500만원 달성',     icon: '🥇' },
  milestone_10m: { label: '1000만 클럽',    description: '누적 결제 1000만원 달성',    icon: '💎' },
  milestone_30m: { label: '3000만 클럽',    description: '누적 결제 3000만원 달성',    icon: '👑' },
  // 예약 관련
  first_booking:   { label: '첫 예약',      description: '첫 여행 예약 완료',          icon: '🎉' },
  triple_booking:  { label: '3회 예약',     description: '3번째 여행 예약',            icon: '🌟' },
  ten_booking:     { label: '10회 예약',    description: '10번째 여행 예약',           icon: '🏆' },
  review_writer:   { label: '리뷰 작성자',  description: '여행 리뷰 작성',             icon: '✍️' },
  vvip_achieved:   { label: 'VVIP 달성',    description: 'VVIP 등급 달성',             icon: '💎' },
  six_month_streak:{ label: '6개월 연속',   description: '6개월 연속 예약',           icon: '🔥' },
  // 출석/스트릭
  streak_7:        { label: '7일 연속',     description: '7일 연속 출석 체크',         icon: '⭐' },
  streak_30:       { label: '30일 연속',    description: '30일 연속 출석 체크',        icon: '🔥' },
  streak_100:      { label: '100일 연속',   description: '100일 연속 출석 체크',       icon: '⚡' },
  // 챌린지
  summer_champion: { label: '여름 챌피언',  description: '여름 휴가 챌린지 완료',       icon: '🏖️' },
  explorer:        { label: '탐험가',       description: '신규 여행지 도전 완료',      icon: '🗺️' },
  ambassador:      { label: '홍보대사',     description: '친구 초대 챌린지 완료',      icon: '🤝' },
};

// ── 마일스톤 체크 (보상 지급) ────────────────────────────────────────────────

/**
 * 누적 결제액 기준으로 새로 달성한 마일스톤을 확인하고 보상을 지급
 * @returns 달성한 마일스톤 정보 배열
 */
export async function checkAndAwardMilestones(userId: string, totalSpent: number): Promise<MileageMilestone[]> {
  if (!isSupabaseConfigured) return [];

  const achieved: MileageMilestone[] = [];
  const earnedBadges = await getCustomerBadges(userId);
  const earnedBadgeTypes = new Set(earnedBadges.map(b => b.badge_type));

  for (const ms of MILESTONES) {
    if (totalSpent < ms.threshold) continue; // 달성하지 못한 마일스톤은 스킵

    // 이미 뱃지 획득했으면 스킵 (중복 지급 방지)
    if (ms.badgeType && earnedBadgeTypes.has(ms.badgeType)) {
      achieved.push({ threshold: ms.threshold, label: ms.label, bonusMileage: 0, achieved: true });
      continue;
    }

    // 보너스 마일리지 지급 + 뱃지 부여
    if (ms.bonusMileage > 0) {
      const { data: tx, error: txError } = await supabaseAdmin.from('mileage_transactions').insert({
        user_id: userId,
        amount: ms.bonusMileage,
        type: 'EARNED',
        margin_impact: 0,
        base_net_profit: 0,
        mileage_rate: 0,
        memo: `🎉 마일스톤 달성: ${ms.label}`,
      }).select('id').single();
      if (!txError && tx) {
        // 만료일 설정
        const validityMonths = await getEffectiveValidityMonths();
        const expiresAt = calcExpiresAt(new Date(), validityMonths);
        await supabaseAdmin.from('mileage_transactions').update({ expires_at: expiresAt.toISOString() }).eq('id', tx.id);

        // 고객 mileage 업데이트
        await supabaseAdmin.rpc('increment_customer_mileage', {
          p_user_id: userId,
          p_amount: ms.bonusMileage,
        });
      }
    }

    // 뱃지 부여
    if (ms.badgeType) {
      await supabaseAdmin.from('customer_badges').upsert({
        customer_id: userId,
        badge_type: ms.badgeType,
        badge_label: ms.badgeLabel ?? null,
        badge_description: ms.badgeDesc ?? null,
      }, { onConflict: 'customer_id,badge_type' });
    }

    achieved.push({ threshold: ms.threshold, label: ms.label, bonusMileage: ms.bonusMileage, achieved: true, achievedAt: new Date().toISOString() });
  }

  return achieved;
}

// ── 뱃지 조회 ─────────────────────────────────────────────────────────────────

export async function getCustomerBadges(userId: string): Promise<CustomerBadge[]> {
  if (!isSupabaseConfigured) return [];

  const { data } = await supabaseAdmin
    .from('customer_badges')
    .select('*')
    .eq('customer_id', userId)
    .order('earned_at', { ascending: false });

  return (data ?? []) as CustomerBadge[];
}

// ── 특정 뱃지 부여 (일반용) ──────────────────────────────────────────────────

export async function awardBadge(
  userId: string,
  badgeType: string,
  badgeLabel?: string,
  badgeDescription?: string,
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const def = BADGE_DEFINITIONS[badgeType];
  const { error } = await supabaseAdmin.from('customer_badges').upsert({
    customer_id: userId,
    badge_type: badgeType,
    badge_label: badgeLabel ?? def?.label ?? null,
    badge_description: badgeDescription ?? def?.description ?? null,
  }, { onConflict: 'customer_id,badge_type' });

  return !error;
}

// ── 첫 예약 뱃지 체크 ─────────────────────────────────────────────────────────

export async function checkFirstBookingBadge(userId: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const { count } = await supabaseAdmin
    .from('bookings')
    .select('*', { count: 'exact', head: true })
    .eq('customer_id', userId);

  if (count === 1) {
    return awardBadge(userId, 'first_booking');
  }
  return false;
}

// ── N회 예약 뱃지 체크 ───────────────────────────────────────────────────────

export async function checkBookingCountBadge(userId: string, targetCount: number, badgeType: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const { count } = await supabaseAdmin
    .from('bookings')
    .select('*', { count: 'exact', head: true })
    .eq('customer_id', userId);

  if (count !== null && count >= targetCount) {
    const badgeKey = badgeType || `booking_${targetCount}`;
    return awardBadge(userId, badgeKey);
  }
  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
// 3-3. 출석 체크 / 스트릭
// ═════════════════════════════════════════════════════════════════════════════

const CHECKIN_REWARD = 10;    // 일일 출석 보너스 (10P)
const STREAK_7_BONUS = 50;    // 7일 연속 보너스
const STREAK_30_BONUS = 200;  // 30일 연속 보너스

// 출석 체크 메모 식별자 (getStreakInfo / doCheckin 간 일치 필요)
const MEMO_CHECKIN = '출석 체크';

export async function getStreakInfo(userId: string): Promise<StreakInfo> {
  if (!isSupabaseConfigured) {
    return { currentStreak: 0, longestStreak: 0, lastCheckin: null, todayChecked: false };
  }

  // streak 데이터는 mileage_transactions의 checkin 타입으로 관리
  const { data: checkins } = await supabaseAdmin
    .from('mileage_transactions')
    .select('created_at')
    .eq('user_id', userId)
    .eq('type', 'EARNED')
    .eq('memo', MEMO_CHECKIN)
    .order('created_at', { ascending: false })
    .limit(100);

  const dates: string[] = [];
  const seen = new Set<string>();
  for (const c of (checkins ?? []) as Array<{ created_at: string }>) {
    const day = c.created_at.slice(0, 10);
    if (!seen.has(day)) {
      dates.push(day);
      seen.add(day);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayChecked = dates.length > 0 && dates[0] === today;

  // 연속 출석 계산
  let currentStreak = 0;
  if (todayChecked || dates[0] === getYesterday()) {
    currentStreak = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]);
      const curr = new Date(dates[i]);
      const diffDays = (prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24);
      if (Math.abs(diffDays - 1) < 0.1) {
        currentStreak++;
      } else {
        break;
      }
    }
  }

  // 최장 연속 출석 계산
  let longestStreak = 0;
  let tempStreak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]);
    const curr = new Date(dates[i]);
    const diffDays = (prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24);
    if (Math.abs(diffDays - 1) < 0.1) {
      tempStreak++;
    } else {
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 1;
    }
  }
  longestStreak = Math.max(longestStreak, tempStreak, currentStreak);

  return {
    currentStreak,
    longestStreak,
    lastCheckin: dates[0] ?? null,
    todayChecked,
  };
}

function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function doCheckin(userId: string): Promise<{
  reward: number;
  streak: StreakInfo;
  bonusAwarded: boolean;
  newBadges: string[];
}> {
  if (!isSupabaseConfigured) {
    return { reward: 0, streak: { currentStreak: 0, longestStreak: 0, lastCheckin: null, todayChecked: false }, bonusAwarded: false, newBadges: [] };
  }

  const streak = await getStreakInfo(userId);
  if (streak.todayChecked) {
    return { reward: 0, streak, bonusAwarded: false, newBadges: [] };
  }

  // 기본 보상 지급
  const { data: checkinTx, error: txError } = await supabaseAdmin.from('mileage_transactions').insert({
    user_id: userId,
    amount: CHECKIN_REWARD,
    type: 'EARNED',
    margin_impact: 0,
    base_net_profit: 0,
    mileage_rate: 0,
    memo: MEMO_CHECKIN,
  }).select('id').single();

  if (txError || !checkinTx) {
    return { reward: 0, streak, bonusAwarded: false, newBadges: [] };
  }

  // 만료일 설정
  const validityMonths = await getEffectiveValidityMonths();
  const expiresAt = calcExpiresAt(new Date(), validityMonths);
  await supabaseAdmin.from('mileage_transactions').update({ expires_at: expiresAt.toISOString() }).eq('id', (checkinTx as any).id);

  // 고객 mileage 업데이트
  await supabaseAdmin.rpc('increment_customer_mileage', {
    p_user_id: userId,
    p_amount: CHECKIN_REWARD,
  });

  // 새 streak 정보
  const newStreak = await getStreakInfo(userId);
  const newBadges: string[] = [];
  let bonusAwarded = false;

  // 7일 연속 보너스
  if (newStreak.currentStreak === 7) {
    const { data: bonusTx } = await supabaseAdmin.from('mileage_transactions').insert({
      user_id: userId, amount: STREAK_7_BONUS, type: 'EARNED',
      margin_impact: 0, base_net_profit: 0, mileage_rate: 0,
      memo: '🔥 7일 연속 출석 보너스',
    }).select('id').single();
    if (bonusTx) {
      const validityMonths = await getEffectiveValidityMonths();
      const expiresAt = calcExpiresAt(new Date(), validityMonths);
      await supabaseAdmin.from('mileage_transactions').update({ expires_at: expiresAt.toISOString() }).eq('id', (bonusTx as any).id);
    }
    await supabaseAdmin.rpc('increment_customer_mileage', { p_user_id: userId, p_amount: STREAK_7_BONUS });
    await awardBadge(userId, 'streak_7');
    bonusAwarded = true;
    newBadges.push('streak_7');
  }

  // 30일 연속 보너스
  if (newStreak.currentStreak === 30) {
    const { data: bonusTx } = await supabaseAdmin.from('mileage_transactions').insert({
      user_id: userId, amount: STREAK_30_BONUS, type: 'EARNED',
      margin_impact: 0, base_net_profit: 0, mileage_rate: 0,
      memo: '⚡ 30일 연속 출석 보너스',
    }).select('id').single();
    if (bonusTx) {
      const validityMonths = await getEffectiveValidityMonths();
      const expiresAt = calcExpiresAt(new Date(), validityMonths);
      await supabaseAdmin.from('mileage_transactions').update({ expires_at: expiresAt.toISOString() }).eq('id', (bonusTx as any).id);
    }
    await supabaseAdmin.rpc('increment_customer_mileage', { p_user_id: userId, p_amount: STREAK_30_BONUS });
    await awardBadge(userId, 'streak_30');
    newBadges.push('streak_30');
  }

  // 100일 연속 뱃지
  if (newStreak.currentStreak === 100) {
    await awardBadge(userId, 'streak_100');
    newBadges.push('streak_100');
  }

  return { reward: CHECKIN_REWARD, streak: newStreak, bonusAwarded, newBadges };
}

// ═════════════════════════════════════════════════════════════════════════════
// 3-4. 시즌별 챌린지
// ═════════════════════════════════════════════════════════════════════════════

export async function getActiveChallenges(): Promise<Challenge[]> {
  if (!isSupabaseConfigured) return [];

  const now = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from('mileage_challenges')
    .select('*')
    .lte('starts_at', now)
    .gte('ends_at', now)
    .order('starts_at', { ascending: false });

  return (data ?? []).map((c: Record<string, unknown>) => ({
    ...c,
    is_active: true,
  })) as Challenge[];
}

