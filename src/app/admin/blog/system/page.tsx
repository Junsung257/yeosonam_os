'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { fmtDateTime } from '@/lib/admin-utils';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { Activity, AlertTriangle, ArrowLeft, Calendar, CheckCircle2, Clock as ClockIcon, Flame, PenLine, RefreshCw, Search } from 'lucide-react';

type CronHealthRow = Record<string, unknown>;
type OpsLevel = 'healthy' | 'watch' | 'risk' | 'blocked';

interface BlogSystemPayload {
  blog_cron_health: CronHealthRow[];
  blog_failures_24h: Array<{
    cron_name: string;
    status: string;
    started_at: string;
    elapsed_ms: number | null;
    error_count: number | null;
    error_messages: string[] | null;
  }>;
  blog_success_rate_7d_percent: Record<string, number>;
  blog_queue_counts: Record<string, number>;
  indexing_recent: Array<{
    url: string;
    google_status: string;
    google_error: string | null;
    indexnow_status: string;
    indexnow_error: string | null;
    reported_at: string;
  }>;
  hints: { cron_secret_configured: boolean; base_url_for_cron_fetch: string | null };
  generated_at: string;
}

interface BlogOpsSummary {
  level: OpsLevel;
  publish: {
    published_today: number;
    daily_target: number;
    configured_daily_target?: number;
    effective_daily_target?: number;
    daily_publish_cap?: number;
    autopublish_mode?: 'draft_only' | 'reviewed_only' | 'live';
    requested_autopublish_mode?: 'draft_only' | 'reviewed_only' | 'live';
    public_publication_enabled?: boolean;
    remaining_today: number;
    level: string;
  };
  queue: {
    counts: Record<string, number>;
    failure_groups?: Record<string, number>;
    active_count: number;
    overdue_queued: number;
    stale_generating: number;
    published_state_mismatch?: number;
    published_state_mismatch_sample?: Array<{
      queue_id: string;
      topic: string | null;
      primary_keyword: string | null;
      article_status: string | null;
      slug: string | null;
      title: string | null;
      published_at: string | null;
    }>;
    level: string;
  };
  indexing: {
    active_jobs: number;
    recent_failures: number;
    failure_buckets?: Record<string, number>;
    outbox_coverage?: {
      checked_count?: number;
      covered_count?: number;
      missing_count?: number;
      coverage_rate?: number;
    };
    google_unknown_urls?: number;
    google_indexed_reports?: number;
    inspected_reports?: number;
    indexnow_success_rate: number | null;
    level: string;
  };
  quality?: {
    recent_checked?: number;
    non_slug_failures?: number;
    slug_only_failures?: number;
    failure_buckets?: Record<string, number>;
    engine_category_scorecard?: {
      checked_count?: number;
      perfect_count?: number;
      below_100_count?: number;
      average_score?: number;
      failed_category_buckets?: Record<string, number>;
    };
  };
  health_sections?: Record<string, {
    level: OpsLevel;
    failed: boolean;
    checks: string[];
  }>;
  cron: {
    unhealthy_count: number;
    core: Array<{
      cron_name: string;
      last_status: string;
      last_run_at: string | null;
      last_elapsed_ms: number | null;
      last_error_count: number | null;
      last_summary: Record<string, unknown> | null;
    }>;
  };
  contract: { passed: boolean; failed_checks: string[] };
  runtime_schema?: {
    fullyReady: boolean;
    publishReady: boolean;
    deliveryReady: boolean;
    measurementReady: boolean;
    missing: string[];
  };
}

const STATUS_LABELS: Record<string, string> = {
  queued: '대기',
  generating: '생성 중',
  published: '큐 발행 완료',
  failed: '실패',
  skipped: '숨김/제외',
  ok: '성공',
  success: '정상',
  partial_failure: '부분 실패',
  error: '실패',
};

const CHECK_LABELS: Record<string, string> = {
  autopublish_mode_draft_only: '자동발행 안전정지',
  daily_publish_sla: '오늘 발행 목표 미달',
  queue_failures_or_stale_generation: '큐 실패 또는 생성 정체',
  published_state_mismatch: '발행 완료/실제 글 상태 불일치',
  cron_health: '자동 실행 작업 이상',
  recent_quality_gate: '최근 글 품질 점검 필요',
  indexing_outbox_missing: '색인 작업 누락',
  publish_preflight_blocked: '발행 전 점검 차단',
  canary_candidates_unavailable: 'Canary 후보 부족',
  current_day_publisher_failure: '오늘 발행자 실패',
  google_url_unknown: '구글 미인지 URL 존재',
};

const HEALTH_SECTION_LABELS: Record<string, { label: string; description: string }> = {
  publish: { label: '발행', description: '오늘 목표와 실제 발행 수' },
  queue: { label: '큐', description: '재시도·대기·중단 후보' },
  quality: { label: '글 품질', description: '브리프·본문·SEO·이미지 증거' },
  indexing: { label: '색인', description: 'outbox·검색 제출·Google 인지' },
  cron: { label: '자동 실행', description: '스케줄러와 워커 상태' },
};

const OPS_BUCKET_LABELS: Record<string, string> = {
  active_jobs: '대기 작업',
  body_missing: '본문 누락',
  content_brief_missing: '브리프 누락',
  google_unknown_urls: 'Google 미인지',
  image_missing: '이미지 증거 누락',
  indexing_failures: '색인 계열 실패',
  metadata_missing: 'SEO 메타 누락',
  non_slug_failures: '비slug 실패',
  outbox_missing: '색인 작업 누락',
  provider_failures: '검색 제출 실패',
  quality_gate_missing: '품질 게이트 누락',
  readability_score_missing: '읽기 점수 누락',
  reader_task_completion: '고객 질문 해결',
  customer_language: '고객 언어',
  naturalness: 'AI 티 억제',
  evidence_faithfulness: '근거 충실도',
  sales_pressure_control: '판매 압박 제어',
  product_decision_helpfulness: '상품 판단 도움',
  seo_score_missing: 'SEO 점수 누락',
  slug_failures: 'slug 실패',
  slug_only_failures: 'slug-only 정리',
  stuck_queue_rows: '멈춘 큐',
};

const CORE_CRON_COPY: Record<string, { label: string; description: string }> = {
  'blog-daily-summary': { label: '일일 발행 요약', description: '하루 발행 목표와 실패 원인을 정리합니다.' },
  'blog-indexing-worker': { label: '색인 작업 처리', description: '구글/네이버 색인 요청 큐를 처리합니다.' },
  'blog-orchestrator': { label: '자동 발행 총괄', description: '후보 발굴, 큐 보충, 발행 흐름을 조율합니다.' },
  'blog-publisher': { label: '글 발행자', description: '품질 점검을 통과한 큐를 실제 글로 발행합니다.' },
  'blog-generate': { label: '야간 글 생성', description: 'DeepSeek로 후보를 생성·재작성하고 공개 승인 원장에 적재합니다.' },
  'blog-publication-controller': { label: '주간 공개 제어', description: '모델 호출 없이 승인된 초안만 공개합니다.' },
  'blog-scheduler': { label: '발행 일정 정리', description: '오늘 처리할 큐와 발행 슬롯을 맞춥니다.' },
  'gsc-index-rank': { label: '구글 색인/순위 확인', description: '구글 기준 색인과 노출 상태를 확인합니다.' },
  'rank-tracking': { label: '순위 추적', description: '발행 글의 검색 노출 변화를 추적합니다.' },
  'serp-rank-snapshot': { label: '검색 결과 스냅샷', description: '검색 결과 위치를 표본으로 확인합니다.' },
  'topical-rebuild': { label: '토픽 권위 재계산', description: '허브 글과 세부 글 연결을 다시 계산합니다.' },
  'trend-topic-miner': { label: '트렌드 토픽 발굴', description: '검색/소셜 후보를 발행 큐 후보로 만듭니다.' },
};

function labelStatus(status: string | null | undefined) {
  if (!status) return '-';
  return STATUS_LABELS[status] || status;
}

function labelCheck(check: string) {
  return CHECK_LABELS[check] || check;
}

function labelBucket(bucket: string) {
  return OPS_BUCKET_LABELS[bucket] || bucket;
}

function sectionTone(level: OpsLevel | string | undefined) {
  if (level === 'blocked' || level === 'risk') return 'text-danger';
  if (level === 'watch') return 'text-warning';
  return 'text-success';
}

function sectionBadgeClass(level: OpsLevel | string | undefined) {
  if (level === 'blocked' || level === 'risk') return 'bg-danger-light text-danger';
  if (level === 'watch') return 'bg-status-warningBg text-status-warningFg';
  return 'bg-status-successBg text-status-successFg';
}

function topBuckets(buckets: Record<string, number> | undefined | null, limit = 4) {
  return Object.entries(buckets || {})
    .filter(([, value]) => Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, limit);
}

function cronCopy(name: string) {
  return CORE_CRON_COPY[name] || { label: name, description: '블로그 자동화 작업입니다.' };
}

function indexingBridgeLevel(ops: BlogOpsSummary): OpsLevel {
  const publishBlocked = ops.publish.remaining_today > 0 && ops.health_sections?.publish?.level === 'risk';
  const missingOutbox = Number(ops.indexing.outbox_coverage?.missing_count || 0) > 0;
  const providerIssue = ops.indexing.recent_failures > 0 || Number(ops.indexing.google_unknown_urls || 0) > 0;
  if (publishBlocked || missingOutbox || providerIssue) return 'risk';
  if (ops.indexing.active_jobs > 0 || ops.publish.remaining_today > 0) return 'watch';
  return 'healthy';
}

function indexingBridgeMessage(ops: BlogOpsSummary): string {
  const missing = Number(ops.indexing.outbox_coverage?.missing_count || 0);
  if (ops.publish.remaining_today > 0 && ops.health_sections?.publish?.level === 'risk') {
    return '발행 목표가 먼저 막혀 있어 색인 단계로 넘어갈 새 글이 부족합니다.';
  }
  if (missing > 0) {
    return `최근 공개 글 ${missing}개가 색인 작업과 연결되지 않았습니다.`;
  }
  if (ops.indexing.recent_failures > 0) {
    return `색인 제공자 응답 실패 ${ops.indexing.recent_failures}건을 확인해야 합니다.`;
  }
  if (Number(ops.indexing.google_unknown_urls || 0) > 0) {
    return `Google 미인지 URL ${ops.indexing.google_unknown_urls}건은 노출 문제로 분리해서 봐야 합니다.`;
  }
  if (ops.indexing.active_jobs > 0) {
    return `발행 후 색인 대기 작업 ${ops.indexing.active_jobs}건이 처리 중입니다.`;
  }
  return '발행된 글이 색인 outbox와 정상 연결되어 있습니다.';
}

function humanizeCronError(error: string) {
  return error
    .replace('블로그 일일 발행 SLA 미달', '블로그 일일 발행 기준 미달')
    .replace(/published=(\d+)/g, '발행 $1편')
    .replace(/min=(\d+)/g, '최소 $1편')
    .replace('블로그 검색 제출 상태 점검 필요', '블로그 검색 반영 상태 점검 필요')
    .replace(/google_actual_index_low:(\d+)%/g, '구글 실제 색인 낮음 $1%')
    .replace(/google_actual_index_low/g, '구글 실제 색인 낮음')
    .replace(/IndexNow/g, '네이버 수집 알림')
    .replace(/GSC/g, '구글 서치콘솔')
    .replace(/Pillar/g, '허브 글')
    .replace(/partial_failure/g, '부분 실패')
    .replace(/status=overdue/g, '상태 지연')
    .replace(/status=failing/g, '상태 실패 중')
    .replace(/consecutive_failures=(\d+)/g, '연속 실패 $1회')
    .replace(/intent\/design quality/g, '의도/구성 품질')
    .replace(/intent quality/g, '의도 품질')
    .replace(/topic fit/g, '토픽 적합도')
    .replace(/editorial quality/g, '편집 품질')
    .replace(/missing_intent_contract/g, '의도 기준 누락')
    .replace(/missing_topic/g, '주제 누락')
    .replace(/weak_travel_intent/g, '여행 의도 약함')
    .replace(/checklist_shape_invalid/g, '체크리스트 구조 오류')
    .replace(/excessive_highlights/g, '형광펜 과다')
    .replace(/internal_links_cta/g, '내부 링크/상담 버튼')
    .replace(/critical=none/g, '핵심 오류 없음')
    .replace(/content_creatives_angle_type_check/g, '글 발행 각도 형식 검사')
    .replace(/content_creatives/g, '글 데이터')
    .replace(/sitemap/g, '사이트맵')
    .replace(/pending/g, '대기')
    .replace(/published/g, '발행 완료');
}

function extractCronErrors(row: any) {
  const summary = row?.last_summary;
  if (!summary || typeof summary !== 'object') return [];
  const errors = Array.isArray(summary.errors) ? summary.errors : [];
  return errors
    .map((error: unknown) => String(error || '').trim())
    .filter(Boolean)
    .map(humanizeCronError)
    .slice(0, 3);
}

export default function BlogSystemPage() {
  const [data, setData] = useState<BlogSystemPayload | null>(null);
  const [ops, setOps] = useState<BlogOpsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  /** 수동 실행(발행자 등) 응답 — 새로고침 전까지 유지 */
  const [actionLog, setActionLog] = useState<string | null>(null);
  /** 대시보드 API 로드 실패 메시지 */
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const cacheBust = Date.now();
      const [res, opsRes] = await Promise.all([
        fetch(`/api/ops/blog-system?ts=${cacheBust}`, { cache: 'no-store' }),
        fetch(`/api/admin/blog/ops-summary?ts=${cacheBust}`, { cache: 'no-store' }),
      ]);
      const json = await res.json();
      const opsJson = await opsRes.json().catch(() => null);
      if (!res.ok) {
        setData(null);
        setLoadError(`API 오류: ${json.error || res.statusText}`);
      } else {
        setData(json as BlogSystemPayload);
      }
      if (opsRes.ok && opsJson?.ok !== false) setOps(opsJson as BlogOpsSummary);
    } catch (e) {
      setData(null);
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const trigger = async (action: string) => {
    setRunning(action);
    try {
      const res = await fetch('/api/blog/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      setActionLog(JSON.stringify(json, null, 2).slice(0, 4000));
      await load();
    } catch (e) {
      setActionLog('실패: ' + (e as Error).message);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader
        title="블로그 자동화 상태"
        subtitle={
          <>자동 글 생성, 발행, 색인 요청, 검색 확인이 어디에서 막혔는지 한 화면에서 봅니다. 세부 일정은 배포 설정의 <code className="text-admin-2xs bg-admin-surface-2 px-1.5 py-0.5 rounded-admin-xs font-mono">vercel.json</code> 과 연결됩니다.</>
        }
        actions={
          <>
            <Link href="/admin/ops">
              <Button variant="secondary" size="sm">
                <ClockIcon size={14} />
                전체 크론
              </Button>
            </Link>
            <Link href="/admin/blog/queue">
              <Button variant="secondary" size="sm">
                <Calendar size={14} />
                자동 발행 큐
              </Button>
            </Link>
            <Link href="/admin/blog">
              <Button variant="secondary" size="sm">
                <ArrowLeft size={14} />
                블로그 홈
              </Button>
            </Link>
            <Button variant="primary" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              새로고침
            </Button>
          </>
        }
      />

      {ops && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            [
              '오늘 발행',
              ops.publish.public_publication_enabled === false
                ? '안전정지'
                : `${ops.publish.published_today}/${ops.publish.daily_target}`,
              ops.publish.public_publication_enabled === false
                ? `모드 ${ops.publish.autopublish_mode || 'draft_only'} · 생성물은 공개하지 않음`
                : ops.publish.remaining_today ? `남은 ${ops.publish.remaining_today}편` : '목표 달성',
              Activity,
              ops.publish.public_publication_enabled === false || ops.publish.remaining_today ? 'text-danger' : 'text-success',
            ],
            ['큐 문제', `${ops.queue.counts.failed || 0}`, `지연 ${ops.queue.overdue_queued} · 정체 ${ops.queue.stale_generating}`, AlertTriangle, (ops.queue.counts.failed || 0) ? 'text-danger' : 'text-success'],
            ['발행 불일치', `${ops.queue.published_state_mismatch || 0}`, '큐 완료와 실제 글 상태 비교', AlertTriangle, (ops.queue.published_state_mismatch || 0) ? 'text-danger' : 'text-success'],
            ['색인 작업', `${ops.indexing.active_jobs}`, ops.indexing.google_unknown_urls ? `구글 미인지 ${ops.indexing.google_unknown_urls}건` : '대기 작업 기준', Search, ops.indexing.active_jobs || ops.indexing.google_unknown_urls ? 'text-warning' : 'text-success'],
            ['계약 상태', ops.contract.passed ? '통과' : '점검', ops.contract.failed_checks.map(labelCheck).join(', ') || '핵심 계약 정상', CheckCircle2, ops.contract.passed ? 'text-success' : 'text-danger'],
          ].map(([label, value, hint, Icon, tone]) => (
            <div key={String(label)} className="admin-card p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-admin-xs font-semibold uppercase tracking-wider text-admin-muted">{String(label)}</p>
                <Icon size={15} className="text-admin-muted-2" />
              </div>
              <p className={`mt-2 text-admin-display font-bold admin-num ${tone}`}>{String(value)}</p>
              <p className="mt-1 text-admin-xs leading-5 text-admin-muted">{String(hint)}</p>
            </div>
          ))}
        </section>
      )}

      {ops && (
        <section className="grid gap-3 md:grid-cols-2">
          <div className="admin-card p-4">
            <h2 className="text-admin-sm font-semibold text-admin-text">자동발행 실효 정책</h2>
            <p className="mt-2 text-admin-xs leading-5 text-admin-muted">
              DB 정책 {ops.publish.configured_daily_target ?? '-'}편 · 환경 상한 {ops.publish.daily_publish_cap ?? '-'}편 · 실효 상한 {ops.publish.effective_daily_target ?? '-'}편
            </p>
            <p className={`mt-1 text-admin-xs font-semibold ${ops.publish.public_publication_enabled ? 'text-success' : 'text-danger'}`}>
              {ops.publish.public_publication_enabled
                ? `${ops.publish.autopublish_mode || 'live'} 모드로 공개 발행 가능`
                : `${ops.publish.autopublish_mode || 'draft_only'} 모드로 공개 발행 중지`}
            </p>
          </div>
          <div className="admin-card p-4">
            <h2 className="text-admin-sm font-semibold text-admin-text">V3 운영 DB 준비상태</h2>
            <p className={`mt-2 text-admin-xs font-semibold ${ops.runtime_schema?.fullyReady ? 'text-success' : 'text-danger'}`}>
              {ops.runtime_schema?.fullyReady ? '발행·공개·측정 스키마 준비 완료' : '필수 스키마 누락으로 live 전환 금지'}
            </p>
            {!ops.runtime_schema?.fullyReady && (
              <p className="mt-1 break-words text-admin-2xs leading-5 text-admin-muted">
                누락: {ops.runtime_schema?.missing?.join(', ') || '준비상태를 불러오지 못했습니다.'}
              </p>
            )}
          </div>
        </section>
      )}

      {ops?.health_sections ? (
        <section className="admin-card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-admin-h3 text-admin-text">운영 건강도 분해</h2>
              <p className="mt-1 text-admin-xs text-admin-muted">발행, 큐, 글 품질, 색인, 자동 실행을 따로 보고 전체 상태를 판단합니다.</p>
            </div>
            <span className={`rounded-admin-xs px-2 py-1 text-admin-2xs font-semibold ${sectionBadgeClass(ops.level)}`}>
              {ops.level}
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-5">
            {Object.entries(ops.health_sections).map(([key, section]) => {
              const copy = HEALTH_SECTION_LABELS[key] || { label: key, description: '' };
              return (
                <div key={key} className="rounded-admin-sm border border-admin-border bg-admin-surface px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-admin-xs font-semibold text-admin-text">{copy.label}</p>
                    <span className={`rounded-admin-xs px-2 py-0.5 text-admin-2xs font-semibold ${sectionBadgeClass(section.level)}`}>
                      {section.level}
                    </span>
                  </div>
                  <p className="mt-1 text-admin-2xs leading-4 text-admin-muted">{copy.description}</p>
                  <p className={`mt-2 text-admin-xs font-semibold ${sectionTone(section.level)}`}>
                    {section.failed ? `${section.checks.length || 1}개 확인 필요` : '정상'}
                  </p>
                  {section.checks.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {section.checks.slice(0, 3).map((check) => (
                        <span key={check} className="rounded-admin-xs bg-admin-surface-2 px-2 py-0.5 text-admin-2xs text-admin-muted">
                          {labelCheck(check)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {ops ? (
        <section className="admin-card p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-admin-h3 text-admin-text">발행·색인 연결</h2>
              <p className="mt-1 text-admin-xs text-admin-muted">글 발행 성공과 검색 반영 준비 상태를 한 번에 비교합니다.</p>
            </div>
            <span className={`w-fit rounded-admin-xs px-2 py-1 text-admin-2xs font-semibold ${sectionBadgeClass(indexingBridgeLevel(ops))}`}>
              {indexingBridgeLevel(ops)}
            </span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-admin-sm border border-admin-border bg-admin-surface px-3 py-3">
              <p className="text-admin-2xs font-semibold uppercase tracking-wider text-admin-muted">Published</p>
              <p className="mt-1 text-admin-h2 font-bold text-admin-text admin-num">{ops.publish.published_today}/{ops.publish.daily_target}</p>
              <p className="mt-1 text-admin-2xs text-admin-muted">오늘 목표 기준</p>
            </div>
            <div className="rounded-admin-sm border border-admin-border bg-admin-surface px-3 py-3">
              <p className="text-admin-2xs font-semibold uppercase tracking-wider text-admin-muted">Outbox</p>
              <p className={`mt-1 text-admin-h2 font-bold admin-num ${(ops.indexing.outbox_coverage?.missing_count || 0) > 0 ? 'text-danger' : 'text-success'}`}>
                {ops.indexing.outbox_coverage?.coverage_rate ?? 0}%
              </p>
              <p className="mt-1 text-admin-2xs text-admin-muted">
                누락 {ops.indexing.outbox_coverage?.missing_count || 0} / 확인 {ops.indexing.outbox_coverage?.checked_count || 0}
              </p>
            </div>
            <div className="rounded-admin-sm border border-admin-border bg-admin-surface px-3 py-3">
              <p className="text-admin-2xs font-semibold uppercase tracking-wider text-admin-muted">Provider</p>
              <p className={`mt-1 text-admin-h2 font-bold admin-num ${ops.indexing.recent_failures > 0 ? 'text-danger' : 'text-success'}`}>
                {ops.indexing.recent_failures}
              </p>
              <p className="mt-1 text-admin-2xs text-admin-muted">최근 색인 요청 실패</p>
            </div>
            <div className="rounded-admin-sm border border-admin-border bg-admin-surface px-3 py-3">
              <p className="text-admin-2xs font-semibold uppercase tracking-wider text-admin-muted">Google</p>
              <p className={`mt-1 text-admin-h2 font-bold admin-num ${(ops.indexing.google_unknown_urls || 0) > 0 ? 'text-warning' : 'text-success'}`}>
                {ops.indexing.google_unknown_urls || 0}
              </p>
              <p className="mt-1 text-admin-2xs text-admin-muted">미인지 URL 표본</p>
            </div>
          </div>
          <p className={`mt-3 text-admin-xs font-semibold ${sectionTone(indexingBridgeLevel(ops))}`}>
            {indexingBridgeMessage(ops)}
          </p>
        </section>
      ) : null}

      {ops ? (
        <section className="grid gap-3 lg:grid-cols-3">
          <div className="admin-card p-4">
            <h2 className="text-admin-sm font-semibold text-admin-text">큐 실패 분류</h2>
            <p className="mt-1 text-admin-xs text-admin-muted">slug, 비slug, 색인, 멈춘 큐를 분리해서 봅니다.</p>
            <div className="mt-3 space-y-2">
              {topBuckets(ops.queue.failure_groups).length === 0 ? (
                <p className="text-admin-xs text-success">확인 필요한 큐 실패가 없습니다.</p>
              ) : topBuckets(ops.queue.failure_groups).map(([bucket, count]) => (
                <div key={bucket} className="flex items-center justify-between gap-3 text-admin-xs">
                  <span className="text-admin-muted">{labelBucket(bucket)}</span>
                  <span className="font-semibold admin-num text-admin-text">{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="admin-card p-4">
            <h2 className="text-admin-sm font-semibold text-admin-text">최근 글 품질</h2>
            <p className="mt-1 text-admin-xs text-admin-muted">본문 품질, URL 정리, 카테고리별 100점 점수표를 분리합니다.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-admin-sm bg-admin-surface-2 p-3">
                <p className="text-admin-2xs text-admin-muted">비slug 실패</p>
                <p className={`mt-1 text-admin-h3 font-bold admin-num ${(ops.quality?.non_slug_failures || 0) > 0 ? 'text-danger' : 'text-success'}`}>
                  {ops.quality?.non_slug_failures || 0}
                </p>
              </div>
              <div className="rounded-admin-sm bg-admin-surface-2 p-3">
                <p className="text-admin-2xs text-admin-muted">slug-only</p>
                <p className={`mt-1 text-admin-h3 font-bold admin-num ${(ops.quality?.slug_only_failures || 0) > 0 ? 'text-warning' : 'text-success'}`}>
                  {ops.quality?.slug_only_failures || 0}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-admin-sm bg-admin-surface-2 p-3">
                <p className="text-admin-2xs text-admin-muted">카테고리 평균</p>
                <p className={`mt-1 text-admin-h3 font-bold admin-num ${(ops.quality?.engine_category_scorecard?.average_score || 0) >= 90 ? 'text-success' : 'text-warning'}`}>
                  {ops.quality?.engine_category_scorecard?.average_score ?? '-'}
                </p>
              </div>
              <div className="rounded-admin-sm bg-admin-surface-2 p-3">
                <p className="text-admin-2xs text-admin-muted">100점 글</p>
                <p className="mt-1 text-admin-h3 font-bold admin-num text-success">
                  {ops.quality?.engine_category_scorecard?.perfect_count ?? 0}
                </p>
              </div>
              <div className="rounded-admin-sm bg-admin-surface-2 p-3">
                <p className="text-admin-2xs text-admin-muted">보강 대상</p>
                <p className={`mt-1 text-admin-h3 font-bold admin-num ${(ops.quality?.engine_category_scorecard?.below_100_count || 0) > 0 ? 'text-warning' : 'text-success'}`}>
                  {ops.quality?.engine_category_scorecard?.below_100_count ?? 0}
                </p>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {topBuckets(ops.quality?.failure_buckets, 3).map(([bucket, count]) => (
                <div key={bucket} className="flex items-center justify-between gap-3 text-admin-xs">
                  <span className="text-admin-muted">{labelBucket(bucket)}</span>
                  <span className="font-semibold admin-num text-admin-text">{count}</span>
                </div>
              ))}
              {topBuckets(ops.quality?.engine_category_scorecard?.failed_category_buckets, 3).map(([bucket, count]) => (
                <div key={`engine-${bucket}`} className="flex items-center justify-between gap-3 text-admin-xs">
                  <span className="text-admin-muted">카테고리: {labelBucket(bucket)}</span>
                  <span className="font-semibold admin-num text-admin-text">{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="admin-card p-4">
            <h2 className="text-admin-sm font-semibold text-admin-text">색인 실패 분류</h2>
            <p className="mt-1 text-admin-xs text-admin-muted">발행 성공과 검색 반영 문제를 분리합니다.</p>
            <div className="mt-3 space-y-2">
              {topBuckets(ops.indexing.failure_buckets).length === 0 ? (
                <p className="text-admin-xs text-success">색인 작업 이상이 없습니다.</p>
              ) : topBuckets(ops.indexing.failure_buckets).map(([bucket, count]) => (
                <div key={bucket} className="flex items-center justify-between gap-3 text-admin-xs">
                  <span className="text-admin-muted">{labelBucket(bucket)}</span>
                  <span className="font-semibold admin-num text-admin-text">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {ops?.cron.core?.length ? (
        <div className="admin-card overflow-hidden">
          <div className="px-3 py-2.5 bg-admin-surface-2 border-b border-admin-border text-admin-xs font-semibold text-admin-text-2">
            핵심 블로그 크론 상태
          </div>
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>작업</th>
                <th>상태</th>
                <th>최근 실행</th>
                <th className="text-right">시간</th>
                <th className="text-right">오류</th>
              </tr>
            </thead>
            <tbody>
              {ops.cron.core.map((row) => {
                const copy = cronCopy(row.cron_name);
                return (
                <tr key={row.cron_name}>
                  <td>
                    <p className="text-admin-xs font-semibold text-admin-text">{copy.label}</p>
                    <p className="mt-0.5 text-admin-2xs leading-4 text-admin-muted">{copy.description}</p>
                    <p className="mt-0.5 font-mono text-admin-2xs text-admin-muted-2">{row.cron_name}</p>
                  </td>
                  <td>
                    <span className={`rounded-admin-xs px-2 py-0.5 text-admin-2xs font-semibold ${row.last_status === 'success' ? 'bg-status-successBg text-status-successFg' : 'bg-danger-light text-danger'}`}>
                      {labelStatus(row.last_status)}
                    </span>
                  </td>
                  <td className="text-admin-xs text-admin-muted admin-num">{row.last_run_at ? fmtDateTime(row.last_run_at) : '-'}</td>
                  <td className="text-right text-admin-xs text-admin-muted admin-num">{row.last_elapsed_ms ? `${Math.round(row.last_elapsed_ms / 1000)}s` : '-'}</td>
                  <td className="text-right text-admin-xs text-admin-muted admin-num">{row.last_error_count || 0}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {ops?.queue.published_state_mismatch ? (
        <div className="rounded-admin-md border border-danger/25 bg-danger-light p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <h2 className="text-admin-sm font-semibold text-danger">발행 상태 불일치 {ops.queue.published_state_mismatch}건</h2>
              <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
                큐는 발행 완료로 남아 있지만 실제 글은 공개 상태가 아닙니다. 운영자는 이 목록을 보고 실제 공개 글로 복구하거나 큐 상태를 숨김/보관으로 맞춰야 합니다.
              </p>
              <div className="mt-3 overflow-hidden rounded-admin-sm border border-danger/15 bg-admin-surface">
                {(ops.queue.published_state_mismatch_sample || []).map((item) => (
                  <div key={item.queue_id} className="border-b border-admin-border px-3 py-2 last:border-b-0">
                    <p className="truncate text-admin-xs font-semibold text-admin-text">{item.title || item.topic || '(제목 없음)'}</p>
                    <p className="mt-0.5 text-admin-2xs text-admin-muted">
                      실제 글 상태: <b className="text-danger">{labelStatus(item.article_status)}</b>
                      {item.slug ? <span className="admin-num"> · /blog/{item.slug}</span> : null}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* 환경 힌트 */}
      {data && (
        <div
          className={`rounded-admin-sm border px-3 py-2 text-admin-xs ${
            data.hints.cron_secret_configured
              ? 'bg-status-successBg border-success/20 text-status-successFg'
              : 'bg-status-warningBg border-warning/20 text-status-warningFg'
          }`}
        >
          <span className="font-semibold">CRON_SECRET:</span> {data.hints.cron_secret_configured ? '설정됨 (수동 발행·브리지에 필요)' : '없음 — 프로덕션 발행자가 401 날 수 있음'}
          {data.hints.base_url_for_cron_fetch && (
            <span className="block mt-1 text-admin-2xs opacity-90 font-mono">내부 호출 BASE: {data.hints.base_url_for_cron_fetch}</span>
          )}
        </div>
      )}

      {/* 수동 실행 */}
      <div className="admin-card p-4">
        <h2 className="text-admin-h3 text-admin-text mb-1">긴급 수동 실행</h2>
        <p className="mb-3 text-admin-xs leading-5 text-admin-muted">
          자동화가 멈췄을 때만 사용합니다. 평소에는 배포 스케줄이 자동으로 처리합니다.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(
            [
              ['run_scheduler', '스케줄러'],
              ['run_trend_miner', '트렌드'],
              ['run_publisher', '발행자'],
              ['run_lifecycle', '라이프사이클'],
            ] as const
          ).map(([action, label]) => (
            <button
              key={action}
              type="button"
              disabled={running !== null}
              onClick={() => trigger(action)}
              className="px-3 py-2.5 bg-admin-surface border border-admin-border-mid rounded-admin-sm text-admin-sm font-medium text-admin-text-2 hover:bg-admin-surface-2 hover:border-admin-border-strong disabled:opacity-50 transition-colors"
            >
              {running === action ? '…' : label}
            </button>
          ))}
        </div>
        {actionLog && (
          <pre className="mt-3 p-3 bg-admin-text text-admin-on-brand text-admin-2xs rounded-admin-sm overflow-x-auto max-h-64 whitespace-pre-wrap font-mono">
            {actionLog}
          </pre>
        )}
      </div>

      {loading && !data && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-3.5 bg-admin-surface-2 rounded animate-pulse" style={{ width: `${90 - i * 10}%` }} />
          ))}
        </div>
      )}

      {loadError && !loading && (
        <pre className="text-danger text-admin-xs whitespace-pre-wrap bg-danger-light border border-danger/20 rounded-admin-sm p-3 font-mono">{loadError}</pre>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(data.blog_queue_counts).map(([k, v]) => (
              <div key={k} className="admin-card px-4 py-3">
                <p className="text-admin-2xs text-admin-muted uppercase tracking-wider font-semibold">{labelStatus(k)}</p>
                <p className="text-admin-h2 font-bold text-admin-text admin-num mt-1">{v}</p>
              </div>
            ))}
            {Object.keys(data.blog_queue_counts).length === 0 && (
              <p className="text-admin-xs text-admin-muted col-span-full">큐 집계 없음</p>
            )}
          </div>

          <div className="admin-card overflow-hidden">
            <div className="px-3 py-2.5 bg-admin-surface-2 border-b border-admin-border text-admin-xs font-semibold text-admin-text-2">
              자동 실행 원본 기록
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-admin-xs">
                <tbody>
                  {data.blog_cron_health.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-admin-muted">뷰가 비었거나 아직 기록 없음</td>
                    </tr>
                  ) : (
                    data.blog_cron_health.map((row, i) => {
                      const cronRow = row as any;
                      const copy = cronCopy(String(cronRow.cron_name || ''));
                      const errors = extractCronErrors(cronRow);
                      return (
                        <tr key={i} className="border-b border-admin-border align-top last:border-0">
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-admin-text">{copy.label}</span>
                              <span className={`rounded-admin-xs px-2 py-0.5 text-admin-2xs font-semibold ${cronRow.last_status === 'success' ? 'bg-status-successBg text-status-successFg' : 'bg-danger-light text-danger'}`}>
                                {labelStatus(cronRow.last_status)}
                              </span>
                              <span className="text-admin-2xs text-admin-muted admin-num">{fmtDateTime(cronRow.last_run_at)}</span>
                              <span className="text-admin-2xs text-admin-muted admin-num">오류 {cronRow.last_error_count || 0}건</span>
                              {cronRow.last_elapsed_ms ? <span className="text-admin-2xs text-admin-muted admin-num">{Math.round(cronRow.last_elapsed_ms / 1000)}초</span> : null}
                            </div>
                            <p className="mt-1 text-admin-2xs text-admin-muted">{copy.description}</p>
                            {errors.length ? (
                              <ul className="mt-1 space-y-0.5">
                                {errors.map((error: string, errorIndex: number) => (
                                  <li key={errorIndex} className="text-admin-2xs text-danger">{error}</li>
                                ))}
                              </ul>
                            ) : null}
                            <p className="mt-1 font-mono text-admin-2xs text-admin-muted-2">{cronRow.cron_name || '-'}</p>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="admin-card overflow-hidden">
            <div className="px-3 py-2.5 bg-admin-surface-2 border-b border-admin-border text-admin-xs font-semibold text-admin-text-2">
              최근 24시간 블로그 크론 비성공 로그
            </div>
            {data.blog_failures_24h.length === 0 ? (
              <p className="px-3 py-4 text-admin-xs text-admin-muted">없음</p>
            ) : (
              <ul className="divide-y divide-admin-border max-h-56 overflow-y-auto">
                {data.blog_failures_24h.map((f, i) => {
                  const failure = f as any;
                  const copy = cronCopy(String(failure.cron_name || ''));
                  const messages = Array.isArray(failure.error_messages) ? failure.error_messages.map((message: unknown) => humanizeCronError(String(message || ''))).slice(0, 4) : [];
                  return (
                    <li key={i} className="px-3 py-2 text-admin-xs">
                      <span className="font-semibold text-admin-text">{copy.label}</span>{' '}
                      <span className="text-danger font-semibold">{labelStatus(failure.status)}</span>{' '}
                      <span className="text-admin-muted-2 admin-num">{fmtDateTime(failure.started_at)}</span>
                      <span className="ml-1 font-mono text-admin-2xs text-admin-muted-2">{failure.cron_name || '-'}</span>
                      {messages.length ? (
                        <ul className="mt-1 space-y-0.5">
                          {messages.map((message: string, messageIndex: number) => (
                            <li key={messageIndex} className="text-danger text-admin-2xs">{message}</li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="admin-card p-3">
            <h3 className="text-admin-xs font-semibold text-admin-text-2 mb-2">7일 성공률 (블로그 크론만)</h3>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(data.blog_success_rate_7d_percent)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, pct]) => (
                  <span key={name} className="inline-flex items-center gap-1 px-2 py-1 bg-admin-surface-2 rounded-admin-xs text-admin-xs">
                    <span className="font-mono text-admin-text-2">{name}</span>
                    <span className={`font-bold admin-num ${pct >= 95 ? 'text-success' : pct >= 80 ? 'text-warning' : 'text-danger'}`}>{pct}%</span>
                  </span>
                ))}
              {Object.keys(data.blog_success_rate_7d_percent).length === 0 && (
                <span className="text-admin-xs text-admin-muted-2">7일간 로그 없음</span>
              )}
            </div>
          </div>

          <div className="admin-card overflow-hidden">
            <div className="px-3 py-2.5 bg-admin-surface-2 border-b border-admin-border text-admin-xs font-semibold text-admin-text-2">
              최근 색인 요청 기록
            </div>
            {data.indexing_recent.length === 0 ? (
              <p className="px-3 py-4 text-admin-xs text-admin-muted">기록 없음</p>
            ) : (
              <ul className="divide-y divide-admin-border text-admin-xs max-h-64 overflow-y-auto">
                {data.indexing_recent.map((r, i) => (
                  <li key={i} className="px-3 py-2">
                    <div className="truncate text-brand font-mono text-admin-2xs" title={r.url}>
                      {r.url}
                    </div>
                    <div className="text-admin-muted mt-0.5 admin-num">
                      구글: <b className={r.google_status === 'ok' ? 'text-success' : 'text-danger'}>{labelStatus(r.google_status)}</b>
                      {r.google_error ? ` (${r.google_error})` : ''} · 네이버 수집 알림: <b className={r.indexnow_status === 'ok' ? 'text-success' : 'text-danger'}>{labelStatus(r.indexnow_status)}</b>
                      {r.indexnow_error ? ` (${r.indexnow_error})` : ''} ·{' '}
                      {fmtDateTime(r.reported_at)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-admin-2xs text-admin-muted-2 admin-num">갱신: {fmtDateTime(data.generated_at)}</p>
        </>
      )}
    </div>
  );
}
