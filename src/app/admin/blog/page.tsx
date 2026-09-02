import { Suspense } from 'react';
import type { ElementType } from 'react';
import Link from 'next/link';
import BlogFilterTabs from './BlogFilterTabs';
import BlogDataFetcher from './BlogDataFetcher';
import Button from '@/components/ui/Button';
import { buildBlogOpsSummary, type BlogOpsLevel } from '@/lib/blog-ops-summary';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Clock, FileText, ListChecks, Search, Settings, ShieldCheck } from 'lucide-react';

// Next 15: route segment config 는 정적 평가만 가능. 항상 'auto' (60초 캐시).
export const dynamic = 'auto';
export const revalidate = 60;

function BlogTableSkeleton() {
  return (
    <div className="admin-card overflow-hidden animate-pulse">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="border-b border-admin-border px-4 py-3 flex gap-4 items-center last:border-0">
          <div className="h-4 bg-admin-surface-2 rounded flex-1" />
          <div className="h-4 bg-admin-surface-2 rounded w-20" />
          <div className="h-4 bg-admin-surface-2 rounded w-10" />
          <div className="h-4 bg-admin-surface-2 rounded w-12" />
          <div className="h-4 bg-admin-surface-2 rounded w-20" />
          <div className="h-4 bg-admin-surface-2 rounded w-8" />
        </div>
      ))}
    </div>
  );
}

const LEVEL_COPY: Record<BlogOpsLevel, { label: string; cls: string; description: string }> = {
  healthy: {
    label: '정상',
    cls: 'border-success/25 bg-status-successBg text-status-successFg',
    description: '발행, 큐, 색인, 크론이 운영 기준 안에 있습니다.',
  },
  watch: {
    label: '관찰',
    cls: 'border-warning/25 bg-status-warningBg text-status-warningFg',
    description: '즉시 장애는 아니지만 오늘 안에 확인할 항목이 있습니다.',
  },
  risk: {
    label: '위험',
    cls: 'border-danger/25 bg-danger-light text-danger',
    description: '자동 발행 또는 색인 흐름에 운영 조치가 필요합니다.',
  },
  blocked: {
    label: '차단',
    cls: 'border-danger/40 bg-danger-light text-danger',
    description: '핵심 크론 또는 발행 경로가 막혀 자동화가 완주하지 못합니다.',
  },
};

const CHECK_LABELS: Record<string, string> = {
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
  v4_quality_or_browser_gate: 'V4 품질 또는 브라우저 검사 차단',
  publish_ready_candidates_zero: '발행 준비 후보 없음',
  seo_weekly_audit_failed_or_critical: '주간 SEO 감사 실패 또는 치명 항목',
};

function checkLabel(check: string) {
  return CHECK_LABELS[check] || check;
}

function levelBadge(level: BlogOpsLevel) {
  const copy = LEVEL_COPY[level];
  return (
    <span className={`inline-flex items-center rounded-admin-xs border px-2 py-1 text-admin-xs font-semibold ${copy.cls}`}>
      {copy.label}
    </span>
  );
}

function metricCard(input: {
  label: string;
  value: string | number;
  hint: string;
  icon: ElementType;
  href: string;
  tone?: 'neutral' | 'good' | 'bad';
}) {
  const { label, value, hint, icon, href, tone = 'neutral' } = input;
  const Icon = icon;
  const toneCls = tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-admin-text';
  return (
    <Link
      href={href}
      className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-4 shadow-admin-xs transition-colors hover:border-admin-border-strong hover:bg-admin-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-admin-xs font-semibold uppercase tracking-wider text-admin-muted">{label}</p>
        <Icon size={15} className="shrink-0 text-admin-muted-2" />
      </div>
      <p className={`mt-2 text-admin-display font-bold admin-num ${toneCls}`}>{value}</p>
      <p className="mt-1 text-admin-xs leading-5 text-admin-muted">{hint}</p>
    </Link>
  );
}

export default async function BlogAdminPage(
  props: {
    searchParams: Promise<{ status?: string; page?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const status = searchParams.status ?? 'all';
  const page = Math.max(1, Number(searchParams.page ?? '1'));
  const ops = isSupabaseAdminConfigured ? await buildBlogOpsSummary(supabaseAdmin) : null;
  const levelCopy = ops ? LEVEL_COPY[ops.level] : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-admin-h1 text-admin-text">블로그 OS</h1>
            {ops && levelBadge(ops.level)}
          </div>
          <p className="mt-1 max-w-3xl text-admin-sm text-admin-muted">
            자동 글 생성, 발행 큐, 색인, 순위, 토픽 권위, 광고 연결을 한 흐름으로 확인합니다.
            {levelCopy ? ` ${levelCopy.description}` : ' 운영 DB 연결이 없으면 요약을 표시할 수 없습니다.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/blog/queue">
            <Button variant="secondary" size="sm">
              <ListChecks size={14} />
              발행 큐
            </Button>
          </Link>
          <Link href="/admin/blog/system">
            <Button variant="secondary" size="sm">
              <Settings size={14} />
              시스템
            </Button>
          </Link>
          <Link href="/admin/blog/write">
            <Button variant="primary" size="sm">
              <FileText size={14} />
              글 작성
            </Button>
          </Link>
        </div>
      </div>

      {ops && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
            {metricCard({
              label: '오늘 발행',
              value: `${ops.publish.published_today}/${ops.publish.daily_target}`,
              hint: ops.publish.remaining_today > 0 ? `남은 목표 ${ops.publish.remaining_today}편` : '오늘 목표 달성',
              icon: Clock,
              href: '/admin/blog/policy',
              tone: ops.publish.remaining_today > 0 ? 'bad' : 'good',
            })}
            {metricCard({
              label: '발행 준비',
              value: `${ops.autopilot.publish_ready_candidates}/${ops.autopilot.publish_ready_target}`,
              hint: `연구 완료 ${ops.autopilot.research_completed_candidates}/${ops.autopilot.research_target}`,
              icon: ListChecks,
              href: '/admin/blog/queue',
              tone: ops.autopilot.publish_ready_candidates === 0 ? 'bad' : 'neutral',
            })}
            {metricCard({
              label: '품질 / 브라우저',
              value: `${ops.autopilot.quality.pass_rate ?? '-'}%`,
              hint: `공개 전 ${ops.autopilot.browser_preview.pass_rate ?? '-'}% · 공개 후 ${ops.autopilot.browser_public.pass_rate ?? '-'}%`,
              icon: ShieldCheck,
              href: '/admin/blog/system',
              tone: ops.autopilot.quality.failed > 0 || ops.autopilot.browser_preview.failed > 0 || ops.autopilot.browser_public.failed > 0 || ops.autopilot.preview_pending_count > 0 ? 'bad' : 'good',
            })}
            {metricCard({
              label: '실제 색인',
              value: ops.indexing.actual_index_rate == null ? '-' : `${ops.indexing.actual_index_rate}%`,
              hint: `발견 ${ops.indexing.discovery_rate ?? '-'}% · 제출 ${ops.indexing.submission_rate ?? '-'}%`,
              icon: Search,
              href: '/admin/blog/rankings',
              tone: ops.indexing.level === 'risk' ? 'bad' : 'neutral',
            })}
            {metricCard({
              label: '파이프라인 예외',
              value: (ops.autopilot.retry_count + ops.autopilot.quarantine_count).toLocaleString('ko-KR'),
              hint: `재시도 ${ops.autopilot.retry_count} · 격리 ${ops.autopilot.quarantine_count}`,
              icon: AlertTriangle,
              href: '/admin/blog/system',
              tone: ops.autopilot.retry_count + ops.autopilot.quarantine_count > 0 ? 'bad' : 'good',
            })}
            {metricCard({
              label: '크론 이상',
              value: ops.cron.unhealthy_count.toLocaleString('ko-KR'),
              hint: ops.cron.unhealthy_count ? '시스템 탭에서 원인 확인' : '핵심 크론 정상',
              icon: Activity,
              href: '/admin/blog/system',
              tone: ops.cron.unhealthy_count ? 'bad' : 'good',
            })}
            {metricCard({
              label: '주간 SEO 감사',
              value: ops.seo_operations.latest_audit
                ? Number(ops.seo_operations.latest_audit.summary?.critical || 0).toLocaleString('ko-KR')
                : '-',
              hint: ops.seo_operations.latest_audit
                ? `${ops.seo_operations.latest_audit.status} · 어댑터 ${Object.values(ops.seo_operations.adapter_readiness).filter(Boolean).length}/3`
                : '기준선 감사 실행 필요',
              icon: BarChart3,
              href: '/admin/blog/system',
              tone: ops.seo_operations.level === 'risk' ? 'bad' : ops.seo_operations.latest_audit ? 'good' : 'neutral',
            })}
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs">
              <div className="border-b border-admin-border px-4 py-3">
                <p className="text-admin-xs font-semibold text-admin-text-2">오늘 해야 할 일</p>
              </div>
              <div className="divide-y divide-admin-border">
                {ops.next_actions.slice(0, 5).map((action) => (
                  <Link key={`${action.title}-${action.href}`} href={action.href} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-admin-surface-2">
                    <span className="mt-0.5">
                      {action.severity === 'healthy' ? (
                        <CheckCircle2 size={16} className="text-success" />
                      ) : action.severity === 'watch' ? (
                        <AlertTriangle size={16} className="text-warning" />
                      ) : (
                        <AlertTriangle size={16} className="text-danger" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-admin-sm font-semibold text-admin-text">{action.title}</span>
                      <span className="mt-0.5 block text-admin-xs leading-5 text-admin-muted">{action.detail}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            <div className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-4 shadow-admin-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="text-admin-xs font-semibold text-admin-text-2">자동 발행 계약</p>
                {levelBadge(ops.contract.passed ? 'healthy' : 'risk')}
              </div>
              <p className="mt-2 text-admin-xs leading-5 text-admin-muted">
                기준 문서: <code className="rounded-admin-xs bg-admin-surface-2 px-1.5 py-0.5 font-mono text-admin-2xs">docs/blog-autopublish-contract.md</code>
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {ops.contract.failed_checks.length === 0 ? (
                  <span className="rounded-admin-xs bg-status-successBg px-2 py-1 text-admin-2xs font-semibold text-status-successFg">핵심 계약 통과</span>
                ) : (
                  ops.contract.failed_checks.map((check) => (
                    <span key={check} className="rounded-admin-xs bg-danger-light px-2 py-1 text-admin-2xs font-semibold text-danger">{checkLabel(check)}</span>
                  ))
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-admin-xs">
                <Link href="/admin/blog/keyword-growth" className="rounded-admin-sm border border-admin-border px-3 py-2 hover:bg-admin-surface-2">
                  <BarChart3 size={14} className="mb-1 text-brand" />
                  키워드 성장
                </Link>
                <Link href="/admin/blog/topical" className="rounded-admin-sm border border-admin-border px-3 py-2 hover:bg-admin-surface-2">
                  <Activity size={14} className="mb-1 text-brand" />
                  토픽 권위
                </Link>
              </div>
            </div>
          </section>
        </>
      )}

      {!ops && (
        <section className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
          <div className="rounded-admin-md border border-warning/25 bg-status-warningBg p-4 shadow-admin-xs">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
              <div>
                <p className="text-admin-sm font-semibold text-admin-text">운영 DB 연결 전 확인 기준</p>
                <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
                  로컬 환경에서 Supabase 관리자 키가 없으면 실시간 큐, 색인, 크론 상태는 비어 보입니다. 그래도 운영 기준 문서와 실행 순서는 이 화면에서 바로 확인할 수 있어야 합니다.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-2 text-admin-xs sm:grid-cols-2">
              <Link href="/admin/blog/queue" className="rounded-admin-sm border border-warning/25 bg-admin-surface px-3 py-2 font-semibold text-admin-text hover:bg-admin-surface-2">
                발행 큐 상태 확인
              </Link>
              <Link href="/admin/blog/system" className="rounded-admin-sm border border-warning/25 bg-admin-surface px-3 py-2 font-semibold text-admin-text hover:bg-admin-surface-2">
                크론/색인 상태 확인
              </Link>
            </div>
          </div>

          <div className="rounded-admin-md border border-admin-border-mid bg-admin-surface p-4 shadow-admin-xs">
            <div className="flex items-center justify-between gap-2">
              <p className="text-admin-xs font-semibold text-admin-text-2">자동 발행 계약</p>
              <span className="rounded-admin-xs border border-admin-border px-2 py-1 text-admin-2xs font-semibold text-admin-muted">DB 대기</span>
            </div>
            <p className="mt-2 text-admin-xs leading-5 text-admin-muted">
              기준 문서: <code className="rounded-admin-xs bg-admin-surface-2 px-1.5 py-0.5 font-mono text-admin-2xs">docs/blog-autopublish-contract.md</code>
            </p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              운영 문서: <code className="rounded-admin-xs bg-admin-surface-2 px-1.5 py-0.5 font-mono text-admin-2xs">docs/blog-ops-runbook.md</code>
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {['오늘 발행 목표', '실패 큐 원인', '색인 작업', '자동 실행 기준'].map((label) => (
                <span key={label} className="rounded-admin-xs bg-admin-surface-2 px-2 py-1 text-admin-2xs font-semibold text-admin-muted">{label}</span>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="admin-card p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">구글 색인/노출</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              요청됨은 색인 요청, 색인처리됨은 구글 색인 확인 통과, 노출확인은 구글 서치콘솔 노출 데이터가 잡힌 상태입니다.
            </p>
          </div>
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">네이버 색인</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              현재는 네이버 수집 알림 요청 상태를 표시합니다. 실제 네이버 노출은 별도 수집 파이프라인으로 분리해야 합니다.
            </p>
          </div>
          <div>
            <p className="text-admin-xs font-semibold text-admin-text-2">광고 OS 학습</p>
            <p className="mt-1 text-admin-xs leading-5 text-admin-muted">
              구글 노출, 상담 버튼, 예약, 키워드 성과는 광고 운영 시스템에서 블로그/상품 단위로 묶어 학습합니다.
            </p>
          </div>
        </div>
      </section>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-admin-h3 text-admin-text">블로그 글 목록</h2>
          <span className="text-admin-xs text-admin-muted">기존 글 관리는 유지하고, 운영 요약을 상단에 고정했습니다.</span>
        </div>
        <BlogFilterTabs currentStatus={status} />
      </div>

      {/* 글 목록 — Suspense로 감싸 클릭 즉시 Skeleton 노출 */}
      <Suspense key={`${status}-${page}`} fallback={<BlogTableSkeleton />}>
        <BlogDataFetcher status={status} page={page} />
      </Suspense>
    </div>
  );
}
