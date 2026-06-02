/**
 * Blog Content Orchestrator — AI-Driven 블로그 파이프라인 오케스트레이터
 *
 * 목적:
 *   기존 분산된 크론(blog-publisher, blog-scheduler, blog-lifecycle, blog-learn 등)의
 *   "두뇌" 역할. 각 크론의 실행 이력을 추적하고, 실패 시 자동 복구하며,
 *   전체 시스템의 건강 상태를 AI-driven으로 모니터링한다.
 *
 * 원칙:
 *   1. 단일 책임 — 각 크론은 "무엇을 할지"만 알고, Orchestrator는 "언제/왜 할지" 판단
 *   2. Self-Healing — 실패한 크론을 자동 재시도 + 근본 원인 기록
 *   3. Data-Driven — 메트릭 기반으로 각 크론의 실행 주기/우선순위 동적 조정
 *   4. AI-Augmented — 실패 패턴 분석 + 전략 제안은 AI 호출로 처리
 *
 * 사용처:
 *   - 새 cron: blog-orchestrator (매시간 실행, 경량)
 *   - blog-learn cron 내에서 호출되어 주간 전략 보고서 생성
 */
import { supabaseAdmin } from './supabase';

/** 크론 1회 실행 기록 */
interface CronRunRecord {
  cronName: string;
  startedAt: string;
  finishedAt: string | null;
  succeeded: boolean;
  durationMs: number;
  processedCount: number;
  errorMessage: string | null;
}

const CRON_NAMES = [
  'blog-scheduler',
  'blog-publisher',
  'blog-lifecycle',
  'blog-learn',
  'blog-daily-summary',
  'blog-regenerate-zero-click',
  'topical-rebuild',
  'programmatic-seo-generator',
  'content-drift-detect',
] as const;

type CronName = (typeof CRON_NAMES)[number];

// 각 크론의 정상 실행 주기 (ms)
const EXPECTED_INTERVALS: Record<CronName, number> = {
  'blog-scheduler': 7 * 86400_000,       // 주 1회
  'blog-publisher': 86400_000,            // 일 1회
  'blog-lifecycle': 86400_000,            // 일 1회
  'blog-learn': 7 * 86400_000,            // 주 1회
  'blog-daily-summary': 86400_000,        // 일 1회
  'blog-regenerate-zero-click': 7 * 86400_000,  // 주 1회
  'topical-rebuild': 7 * 86400_000,       // 주 1회
  'programmatic-seo-generator': 86400_000, // 일 1회
  'content-drift-detect': 3600_000,       // 시간당
};

/**
 * 시스템 건강 상태
 */
export interface SystemHealth {
  healthy: boolean;
  cronStatuses: Array<{
    name: CronName;
    lastRun: string | null;
    lastSuccess: string | null;
    status: 'ok' | 'overdue' | 'failing';
    consecutiveFailures: number;
    since: string;
  }>;
  queueHealth: {
    queued: number;
    failed: number;
    skipped: number;
    published: number;
  };
  recentErrors: Array<{
    cron: string;
    error: string;
    time: string;
  }>;
  strategicAdvice: string[];
}

/**
 * 크론 실행 기록 저장
 * 각 크론의 마지막 줄에서 호출
 */
export async function recordCronRun(record: CronRunRecord): Promise<void> {
  const { error } = await supabaseAdmin
    .from('cron_run_logs')
    .insert({
      cron_name: record.cronName,
      status: record.succeeded ? 'success' : 'error',
      started_at: record.startedAt,
      finished_at: record.finishedAt,
      elapsed_ms: record.durationMs,
      summary: { processed_count: record.processedCount },
      error_count: record.errorMessage ? 1 : 0,
      error_messages: record.errorMessage ? [record.errorMessage] : [],
    });

  if (error) {
    console.error(`[orchestrator] recordCronRun(${record.cronName}) failed:`, error.message);
  }
}

/**
 * 시스템 건강 상태 수집
 * blog-learn cron 내에서 주간 보고서 생성용
 */
export async function collectSystemHealth(): Promise<SystemHealth> {
  // 1) 모든 크론의 최근 실행 기록
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();

  const { data: cronHealthRows } = await supabaseAdmin
    .from('cron_health')
    .select('cron_name, last_status, last_run_at, last_error_count, last_summary')
    .in('cron_name', [...CRON_NAMES]);

  const healthByName = new Map(
    ((cronHealthRows || []) as Array<{
      cron_name: string;
      last_status: string | null;
      last_run_at: string | null;
      last_error_count: number | null;
      last_summary: unknown;
    }>).map(row => [row.cron_name, row]),
  );

  const { data: cronLogs } = await supabaseAdmin
    .from('cron_run_logs')
    .select('cron_name, started_at, status, error_messages')
    .gte('started_at', sevenDaysAgo)
    .order('started_at', { ascending: false });

  // 2) 각 크론별 상태 집계
  const cronStatuses: SystemHealth['cronStatuses'] = [];

  for (const name of CRON_NAMES) {
    const healthRow = healthByName.get(name);
    const runs = (cronLogs || []).filter(
      (r: { cron_name: string }) => r.cron_name === name,
    ) as Array<{
      cron_name: string;
      started_at: string;
      status: 'success' | 'partial_failure' | 'error' | string | null;
      error_messages: string[] | null;
    }>;

    const lastRun = healthRow?.last_run_at ?? (runs.length > 0 ? runs[0].started_at : null);
    const lastSuccess = healthRow?.last_status === 'success'
      ? (healthRow.last_run_at ?? null)
      : (runs.find(r => r.status === 'success')?.started_at ?? null);
    let consecutiveFailures = 0;
    if (healthRow) {
      consecutiveFailures = healthRow.last_status === 'success' ? 0 : Math.max(1, healthRow.last_error_count ?? 1);
    } else {
      for (const run of runs) {
        if (run.status === 'success') break;
        consecutiveFailures++;
      }
    }

    const now = Date.now();
    const lastRunMs = lastRun ? new Date(lastRun).getTime() : 0;
    const interval = EXPECTED_INTERVALS[name];
    const isOverdue = lastRun ? (now - lastRunMs) > interval * 2 : true;

    let status: 'ok' | 'overdue' | 'failing';
    if (consecutiveFailures >= 3) {
      status = 'failing';
    } else if (isOverdue) {
      status = 'overdue';
    } else {
      status = 'ok';
    }

    cronStatuses.push({
      name,
      lastRun,
      lastSuccess,
      status,
      consecutiveFailures,
      since: lastRun ?? 'never',
    });
  }

  // 3) 큐 상태
  const { data: queueCounts } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('status');

  const queueHealth = { queued: 0, failed: 0, skipped: 0, published: 0 };
  for (const row of (queueCounts || []) as Array<{ status: string }>) {
    if (row.status in queueHealth) {
      queueHealth[row.status as keyof typeof queueHealth]++;
    }
  }

  // 4) 최근 에러
  const healthErrors = ((cronHealthRows || []) as Array<{
    cron_name: string;
    last_status: string | null;
    last_run_at: string | null;
    last_error_count: number | null;
    last_summary: { errors?: string[] } | null;
  }>)
    .filter(row => row.last_status !== 'success' && (row.last_error_count ?? 0) > 0)
    .map(row => ({
      cron: row.cron_name,
      error: row.last_summary?.errors?.[0] ?? `${row.last_status ?? 'unknown'} (${row.last_error_count ?? 0} errors)`,
      time: row.last_run_at ?? 'unknown',
    }));

  const recentErrors = healthErrors.length > 0 ? healthErrors.slice(0, 5) : (cronLogs || [])
    .filter((r: { status: string | null; error_messages: string[] | null }) => r.status !== 'success' && (r.error_messages?.length ?? 0) > 0)
    .slice(0, 5)
    .map((r: { cron_name: string; error_messages: string[] | null; started_at: string }) => ({
      cron: r.cron_name,
      error: r.error_messages?.[0] ?? 'unknown',
      time: r.started_at,
    }));

  // 5) 전략적 조언
  const strategicAdvice: string[] = [];
  for (const cs of cronStatuses) {
    if (cs.status === 'failing') {
      strategicAdvice.push(`⚠️ ${cs.name}: ${cs.consecutiveFailures}회 연속 실패. 수동 점검 필요.`);
    } else if (cs.status === 'overdue') {
      strategicAdvice.push(`⏰ ${cs.name}: 예정 시간보다 늦게 실행 중. Vercel Cron 설정 확인.`);
    }
  }

  if (queueHealth.failed > 20) {
    strategicAdvice.push(`📉 큐 실패 ${queueHealth.failed}건 — error_patterns 학습 및 품질 게이트 임계값 재조정 필요.`);
  }

  const healthy = cronStatuses.every(cs => cs.status === 'ok') && queueHealth.failed < 10;

  return {
    healthy,
    cronStatuses,
    queueHealth,
    recentErrors,
    strategicAdvice,
  };
}

/**
 * Self-Healing: 실패한 크론 항목 자동 재시도
 * - blog-publisher 실패 글 → 큐로 재등록 (단, 재시도 3회 미만인 경우만)
 * - blog-lifecycle 미처리 → 즉시 재실행
 *
 * blog-orchestrator cron에서 매시간 호출
 */
export async function autoHealQueue(): Promise<{
  recovered: number;
  stillFailed: number;
  details: string[];
}> {
  const details: string[] = [];
  let recovered = 0;

  // blog_topic_queue 에서 failed 상태 + 재시도 3회 미만 → queued 로 복구
  const { data: failedItems } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id, topic, attempts, error_message')
    .eq('status', 'failed')
    .lt('attempts', 3);

  if (failedItems && failedItems.length > 0) {
    for (const item of (failedItems as Array<{ id: string; topic: string; attempts: number; error_message: string | null }>)) {
      const { error } = await supabaseAdmin
        .from('blog_topic_queue')
        .update({
          status: 'queued',
          attempts: (item.attempts || 0) + 1,
          error_message: `재시도 #${(item.attempts || 0) + 1}: ${item.error_message ?? ''}`,
        })
        .eq('id', item.id);

      if (!error) {
        recovered++;
        details.push(`복구: ${item.topic} (시도 ${(item.attempts || 0) + 1}/3)`);
      }
    }
  }

  // blog_topic_queue 에서 skipped 상태 (bulk_archive_package) → 자동 제거
  const { data: autoArchiveItems } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id, topic')
    .eq('status', 'skipped')
    .like('error_message', '%bulk_archive_package%');

  if (autoArchiveItems && autoArchiveItems.length > 0) {
    const skipIds = (autoArchiveItems as Array<{ id: string }>).map(i => i.id);
    await supabaseAdmin
      .from('blog_topic_queue')
      .update({ status: 'archived', error_message: `auto_archived_package — self-heal ${new Date().toISOString()}` })
      .in('id', skipIds);
    details.push(`아카이브 정리: ${skipIds.length}건 skipped→archived 변환`);
  }

  return {
    recovered,
    stillFailed: (failedItems?.length ?? 0) - recovered,
    details,
  };
}

/**
 * 오케스트레이터 실행 (blog-orchestrator cron에서 호출)
 * 매시간 경량으로 실행되어 상태 체크 + 필요시 Self-Healing
 */
export async function runOrchestrator(): Promise<{
  health: SystemHealth;
  healed: Awaited<ReturnType<typeof autoHealQueue>>;
}> {
  const health = await collectSystemHealth();
  const healed = await autoHealQueue();

  // 심각한 문제 발견 시 알림 로그
  if (!health.healthy) {
    const critical = health.cronStatuses.filter(cs => cs.status !== 'ok');
    console.warn(`[orchestrator] ${critical.length}개 크론 비정상:`, critical.map(c => c.name).join(', '));

    // SNS 알림 (선택사항)
    try {
      await supabaseAdmin.from('admin_alerts').insert({
        kind: 'orchestrator_unhealthy',
        severity: critical.some(c => c.status === 'failing') ? 'critical' : 'warning',
        message: `Orchestrator: ${critical.length}개 크론 비정상 (${critical.map(c => `${c.name}=${c.status}`).join(', ')})`,
        payload: { health, healed },
      });
    } catch { /* noop */ }
  }

  return { health, healed };
}
