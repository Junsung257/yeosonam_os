'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Clock, ListChecks, Search } from 'lucide-react';

type OpsLevel = 'healthy' | 'watch' | 'risk' | 'blocked';

interface OpsSummary {
  level: OpsLevel;
  publish: { published_today: number; daily_target: number; remaining_today: number };
  queue: { active_count: number; counts: Record<string, number> };
  quality?: { non_slug_failures?: number; slug_only_failures?: number };
  indexing: {
    active_jobs: number;
    recent_failures: number;
    google_unknown_urls?: number;
    outbox_coverage?: { missing_count?: number };
  };
  health_sections?: {
    quality?: { level: OpsLevel; failed: boolean; checks: string[] };
    seo_operations?: { level: OpsLevel; failed: boolean; checks: string[] };
  };
  preflight?: { status?: 'pass' | 'warn' | 'block'; score?: number };
  canary_preflight?: { status?: 'pass' | 'warn' | 'block'; ready_count?: number; requested?: number };
  cron: { unhealthy_count: number };
  contract: { passed: boolean; failed_checks: string[] };
}

const LEVEL_STYLE: Record<OpsLevel, string> = {
  healthy: 'border-success/20 bg-status-successBg text-status-successFg',
  watch: 'border-warning/25 bg-status-warningBg text-status-warningFg',
  risk: 'border-danger/25 bg-danger-light text-danger',
  blocked: 'border-danger/40 bg-danger-light text-danger',
};

const LEVEL_LABEL: Record<OpsLevel, string> = {
  healthy: '정상',
  watch: '관찰',
  risk: '위험',
  blocked: '차단',
};

const CHECK_LABELS: Record<string, string> = {
  daily_publish_sla: '오늘 발행 목표 미달',
  queue_failures_or_stale_generation: '큐 실패 또는 생성 정체',
  published_state_mismatch: '발행 상태 불일치',
  cron_health: '자동 실행 이상',
  recent_quality_gate: '최근 글 품질',
  indexing_outbox_missing: '색인 작업 누락',
  publish_preflight_blocked: '발행 전 점검 차단',
  canary_candidates_unavailable: 'Canary 후보 부족',
  current_day_publisher_failure: '오늘 발행자 실패',
  google_url_unknown: '구글 미인지 URL',
  seo_weekly_audit_failed_or_critical: '주간 SEO 감사',
};

function checkLabels(checks: string[]) {
  return checks.map((check) => CHECK_LABELS[check] || check).join(', ');
}

function sectionTone(level?: OpsLevel) {
  if (level === 'risk' || level === 'blocked') return 'text-danger';
  if (level === 'watch') return 'text-warning';
  return 'text-success';
}

export default function BlogOpsStatusStrip() {
  const pathname = usePathname();
  const [ops, setOps] = useState<OpsSummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10_000);

    fetch('/api/admin/blog/ops-summary', { cache: 'no-store', signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.ok !== false) setOps(data as OpsSummary);
      })
      .catch(() => {})
      .finally(() => window.clearTimeout(timer));

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  if (!ops || pathname === '/admin/blog') return null;

  const hasIssue = ops.level === 'risk' || ops.level === 'blocked';
  const indexingLabel = ops.canary_preflight?.status === 'block'
    ? `Canary ${ops.canary_preflight.ready_count ?? 0}/${ops.canary_preflight.requested ?? 3}`
    : ops.preflight?.status === 'block'
    ? `Preflight ${ops.preflight.score ?? '-'}`
    : ops.indexing.outbox_coverage?.missing_count
    ? `색인누락 ${ops.indexing.outbox_coverage.missing_count}`
    : ops.indexing.google_unknown_urls
    ? `Google 미인지 ${ops.indexing.google_unknown_urls}`
    : `색인작업 ${ops.indexing.active_jobs}`;

  const qualityLabel = ops.quality?.non_slug_failures
    ? `품질 ${ops.quality.non_slug_failures}`
    : ops.quality?.slug_only_failures
      ? `Slug ${ops.quality.slug_only_failures}`
      : '품질 정상';

  return (
    <div className={`rounded-admin-md border px-3 py-2 text-admin-xs ${LEVEL_STYLE[ops.level]}`}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {hasIssue ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
          <span className="font-semibold">블로그 OS {LEVEL_LABEL[ops.level]}</span>
          <span className="opacity-80">
            계약 {ops.contract.passed ? '통과' : `미통과: ${checkLabels(ops.contract.failed_checks)}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-admin-2xs">
          <Link href="/admin/blog" className="inline-flex items-center gap-1 rounded-admin-xs bg-admin-surface/60 px-2 py-1 font-semibold text-admin-text-2 hover:bg-admin-surface">
            <Clock size={12} />
            오늘 {ops.publish.published_today}/{ops.publish.daily_target}
          </Link>
          <Link
            href={(ops.queue.counts.failed || 0) > 0
              ? '/admin/blog/queue?scope=attention'
              : '/admin/blog/queue'}
            className="inline-flex items-center gap-1 rounded-admin-xs bg-admin-surface/60 px-2 py-1 font-semibold text-admin-text-2 hover:bg-admin-surface"
          >
            <ListChecks size={12} />
            큐 {ops.queue.active_count} · 실패 {ops.queue.counts.failed || 0}
          </Link>
          <Link href="/admin/blog/rankings" className="inline-flex items-center gap-1 rounded-admin-xs bg-admin-surface/60 px-2 py-1 font-semibold text-admin-text-2 hover:bg-admin-surface">
            <Search size={12} />
            {indexingLabel}
          </Link>
          <Link href="/admin/blog/system" className={`inline-flex items-center gap-1 rounded-admin-xs bg-admin-surface/60 px-2 py-1 font-semibold hover:bg-admin-surface ${sectionTone(ops.health_sections?.quality?.level)}`}>
            <CheckCircle2 size={12} />
            {qualityLabel}
          </Link>
          <Link href="/admin/blog/system" className="inline-flex items-center gap-1 rounded-admin-xs bg-admin-surface/60 px-2 py-1 font-semibold text-admin-text-2 hover:bg-admin-surface">
            <AlertTriangle size={12} />
            크론 이상 {ops.cron.unhealthy_count}
          </Link>
        </div>
      </div>
    </div>
  );
}
