/**
 * 여소남 OS — Booking Tasks Runner
 * ============================================================================
 * 모든 룰을 통합 실행하는 오케스트레이터.
 *
 * 실행 순서 (순서 자체가 설계 — 바꾸면 Alert Fatigue 유발):
 *   1. wake_snoozed_tasks()  — Snooze 만기 도래한 것들을 open 으로 복귀
 *   2. 각 룰별:
 *      (a) evaluateStale   — 조건 해소된 기존 open Task 를 auto_resolved 처리
 *                            (먼저 정리해야 Alert Fatigue 없음)
 *      (b) detect          — 신규 예외 감지
 *          → cooldown 검사 (최근 N일 내 resolved 있으면 skip)
 *          → fingerprint UNIQUE INSERT (동시성/재실행 안전)
 *
 * 10년 운영 기준 설계 원칙:
 *   - 한 룰이 터져도 다른 룰은 계속 (try/catch per rule)
 *   - 모든 detect 는 SQL 수준 LIMIT/필터로 1차 압축 (메모리 폭발 방지)
 *   - 크론 타임아웃(60s) 내 완료 — 전체 시간 + 룰별 시간 로그
 *   - 멱등성 3중 방어: fingerprint UNIQUE / 활성 UNIQUE / cooldown 체크
 */

import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import type {
  TaskRule,
  DetectedTask,
  RuleContext,
  RuleRunResult,
  RunnerResult,
  BookingTask,
} from '@/types/booking-tasks';

// ─── Fingerprint 생성 ─────────────────────────────────────────────────────────
/**
 * 멱등성 키. 기본은 일별 bucket — 같은 날 같은 룰이 같은 예약을 2번 감지해도
 * UNIQUE 위반으로 두 번째는 차단된다.
 *
 * 룰이 `fingerprintSalt` 를 제공하면 (예: 주별 bucket) 해시가 달라져
 * 그 주기마다 새 Task 를 만들 수 있다.
 */
function makeFingerprint(
  bookingId: string,
  taskType: string,
  now: Date,
  salt?: string,
): string {
  const dateBucket = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const raw = [bookingId, taskType, salt ?? dateBucket].join('|');
  return crypto.createHash('md5').update(raw).digest('hex');
}

// ─── Cooldown 체크 ────────────────────────────────────────────────────────────
async function isInCooldown(
  bookingId: string,
  taskType: string,
  cooldownDays: number,
  now: Date,
): Promise<boolean> {
  if (cooldownDays <= 0) return false;
  const since = new Date(now.getTime() - cooldownDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin.rpc('get_recent_resolved_task', {
    p_booking_id: bookingId,
    p_task_type:  taskType,
    p_since:      since,
  });
  if (error) {
    console.warn('[booking-tasks/cooldown] RPC 실패', { bookingId, taskType, error: error.message });
    // 안전 쪽으로: cooldown 조회 실패 시 생성 허용 (false positive 가 false negative 보다 나음)
    return false;
  }
  return data !== null && data !== undefined;
}

// ─── 단일 Task INSERT (중복 시 silently skip) ─────────────────────────────────
interface InsertOutcome {
  inserted: boolean;
  duplicate: boolean;
  error?: string;
}

async function insertTask(
  rule: TaskRule,
  seed: DetectedTask,
  now: Date,
): Promise<InsertOutcome> {
  const priority = seed.priorityOverride ?? rule.priority;
  const fingerprint = makeFingerprint(seed.bookingId, rule.taskType, now, seed.fingerprintSalt);

  const { error } = await supabaseAdmin
    .from('booking_tasks')
    .insert({
      booking_id: seed.bookingId,
      task_type:  rule.taskType,
      priority,
      title:      seed.title,
      context:    seed.context ?? {},
      status:     'open',
      fingerprint,
      created_by: `system:rule:${rule.id}`,
    });

  if (!error) return { inserted: true, duplicate: false };

  // Postgres unique violation (23505) = 멱등성 정상 작동 — 에러 아님
  const msg = String(error.message || '');
  const code = (error as { code?: string }).code;
  if (code === '23505' || msg.includes('duplicate key') || msg.includes('uq_booking_tasks')) {
    return { inserted: false, duplicate: true };
  }

  return { inserted: false, duplicate: false, error: msg };
}

// ─── 룰별 open Task 조회 (evaluateStale 입력) ─────────────────────────────────
async function fetchOpenTasksForRule(taskType: string): Promise<BookingTask[]> {
  const { data, error } = await supabaseAdmin
    .from('booking_tasks')
    .select('*')
    .eq('task_type', taskType)
    .eq('status', 'open')
    .limit(500); // 안전 상한

  if (error) {
    console.warn('[booking-tasks/evaluateStale] open 조회 실패', { taskType, error: error.message });
    return [];
  }
  return (data ?? []) as unknown as BookingTask[];
}

// ─── 단일 룰 실행 ─────────────────────────────────────────────────────────────
export async function runRule(rule: TaskRule, ctx: RuleContext): Promise<RuleRunResult> {
  const start = Date.now();
  const result: RuleRunResult = {
    ruleId: rule.id,
    detected: 0,
    inserted: 0,
    cooldownSkipped: 0,
    duplicateSkipped: 0,
    autoResolved: 0,
    durationMs: 0,
    errors: [],
  };

  // (a) evaluateStale 먼저 — Alert Fatigue 제거가 최우선
  try {
    const openTasks = await fetchOpenTasksForRule(rule.taskType);
    if (openTasks.length > 0) {
      const decisions = await rule.evaluateStale(openTasks, ctx);
      for (const d of decisions) {
        const { error } = await supabaseAdmin
          .from('booking_tasks')
          .update({
            status:              'auto_resolved',
            resolved_at:         new Date().toISOString(),
            resolved_by:         'system:evaluate_stale',
            resolution:          'auto',
            auto_resolve_reason: d.reason,
            updated_at:          new Date().toISOString(),
          })
          .eq('id', d.taskId)
          .eq('status', 'open'); // race 방어: 사람이 먼저 닫았으면 건드리지 않음

        if (error) {
          result.errors.push(`auto_resolve ${d.taskId}: ${error.message}`);
        } else {
          result.autoResolved++;
        }
      }
    }
  } catch (e) {
    result.errors.push(`evaluateStale: ${e instanceof Error ? e.message : String(e)}`);
  }

  // (b) detect — 신규 감지
  try {
    const seeds = await rule.detect(ctx);
    result.detected = seeds.length;

    for (const seed of seeds) {
      try {
        const cooldown = await isInCooldown(seed.bookingId, rule.taskType, rule.cooldownDays, ctx.now);
        if (cooldown) {
          result.cooldownSkipped++;
          continue;
        }
        const outcome = await insertTask(rule, seed, ctx.now);
        if (outcome.inserted) result.inserted++;
        else if (outcome.duplicate) result.duplicateSkipped++;
        else if (outcome.error) result.errors.push(`insert ${seed.bookingId}: ${outcome.error}`);
      } catch (e) {
        result.errors.push(`detect-item ${seed.bookingId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch (e) {
    result.errors.push(`detect: ${e instanceof Error ? e.message : String(e)}`);
  }

  result.durationMs = Date.now() - start;
  return result;
}

// ─── 전체 러너 (크론에서 호출) ────────────────────────────────────────────────
export async function runAllRules(
  rules: TaskRule[],
  options: { isForce?: boolean; now?: Date } = {},
): Promise<RunnerResult> {
  const now = options.now ?? new Date();
  const runId = crypto.randomUUID();
  const ctx: RuleContext = { now, isForce: Boolean(options.isForce), runId };
  const start = Date.now();

  // [1] Snooze 만기 깨우기 (룰과 무관한 공통 단계)
  let wokenFromSnooze = 0;
  try {
    const { data, error } = await supabaseAdmin.rpc('wake_snoozed_tasks');
    if (error) {
      console.warn('[booking-tasks/runner] wake_snoozed_tasks 실패', error.message);
    } else if (typeof data === 'number') {
      wokenFromSnooze = data;
    }
  } catch (e) {
    console.warn('[booking-tasks/runner] wake_snoozed_tasks 예외', e);
  }

  // [2] 룰별 실행 — 한 룰이 터져도 다른 룰은 계속
  const results: RuleRunResult[] = [];
  for (const rule of rules) {
    try {
      const r = await runRule(rule, ctx);
      results.push(r);
    } catch (e) {
      results.push({
        ruleId: rule.id,
        detected: 0, inserted: 0, cooldownSkipped: 0, duplicateSkipped: 0, autoResolved: 0,
        durationMs: 0,
        errors: [`rule crashed: ${e instanceof Error ? e.message : String(e)}`],
      });
    }
  }

  const totalDurationMs = Date.now() - start;

  return { wokenFromSnooze, rules: results, totalDurationMs, runId };
}
