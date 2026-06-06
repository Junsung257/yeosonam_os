import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import Button from '@/components/ui/Button';
import type { StagingSmoke, Summary } from '../_lib/types';
import { fmtWon } from '../_lib/display';
import { MetricGrid } from './MetricGrid';
import { SafetyEvidenceList } from './SafetyEvidenceList';
import { StatusPill, type StatusPillTone } from './StatusPill';

type CompletionAudit = NonNullable<NonNullable<Summary['enterprise_layer']>['completion_audit']>;
type CompletionRequirement = CompletionAudit['requirements'][number];

function completionTone(status?: CompletionAudit['status']): StatusPillTone {
  if (status === 'ready') return 'good';
  if (status === 'blocked') return 'bad';
  return 'warn';
}

function requirementTone(status: CompletionRequirement['status']): StatusPillTone {
  if (status === 'pass') return 'good';
  if (status === 'fail') return 'bad';
  return 'warn';
}

export function CompletionAuditPanel({
  completionAudit,
  completionDrilldown,
  highlighted,
  stagingSmoke,
  checkingStagingSmoke,
  onRunStagingSmoke,
}: {
  completionAudit?: CompletionAudit;
  completionDrilldown: CompletionRequirement[];
  highlighted: boolean;
  stagingSmoke: StagingSmoke | null;
  checkingStagingSmoke: boolean;
  onRunStagingSmoke: () => void;
}) {
  return (
    <div
      id="completion-audit"
      className={`rounded-admin-sm border bg-admin-surface p-3 md:col-span-2 ${
        highlighted ? 'border-blue-300 ring-2 ring-blue-100' : 'border-admin-border'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-admin-2xs font-semibold text-admin-muted">Completion Audit</p>
        <StatusPill tone={completionTone(completionAudit?.status)}>
          {completionAudit?.status || 'unknown'}
        </StatusPill>
      </div>
      <p className="mt-1 admin-num text-admin-xl font-bold text-admin-text">
        {Number(completionAudit?.readiness_score || 0).toLocaleString('ko-KR')}%
      </p>
      <p className="mt-1 text-admin-2xs text-admin-muted">
        pass {Number(completionAudit?.passed || 0).toLocaleString('ko-KR')} / warn {Number(completionAudit?.warnings || 0).toLocaleString('ko-KR')} / fail {Number(completionAudit?.failed || 0).toLocaleString('ko-KR')}
      </p>
      <p className="mt-2 line-clamp-2 text-admin-2xs leading-5 text-admin-muted">
        {completionAudit?.next_action || 'Collect current evidence before declaring Ad OS complete.'}
      </p>

      <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-admin-2xs font-semibold text-admin-muted">Staging Smoke</p>
            <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">
              Checks fixture-backed product, scenario, keyword, creative, execution, conversion upload, portfolio, and learning evidence in read-only mode.
            </p>
          </div>
          <StatusPill tone={stagingSmoke?.ok ? 'good' : stagingSmoke ? 'bad' : 'neutral'}>
            {stagingSmoke?.smoke.status || 'not checked'}
          </StatusPill>
        </div>
        <MetricGrid
          metrics={[
            {
              label: 'Assertions',
              value: `${Number(stagingSmoke?.smoke.passed_assertions || 0).toLocaleString('ko-KR')} / ${Number(
                (stagingSmoke?.smoke.passed_assertions || 0) + (stagingSmoke?.smoke.failed_assertions || 0),
              ).toLocaleString('ko-KR')}`,
            },
            { label: 'Keywords', value: Number(stagingSmoke?.smoke.counts.keywords || 0).toLocaleString('ko-KR') },
            { label: 'Creative', value: Number(stagingSmoke?.smoke.counts.creative_variants || 0).toLocaleString('ko-KR') },
            { label: 'External spend', value: fmtWon(stagingSmoke?.safety.external_spend_krw || 0) },
          ]}
        />
        <p className="mt-2 line-clamp-2 text-admin-2xs leading-5 text-admin-muted">
          {stagingSmoke?.smoke.next_action || 'Run the smoke API to show current operational safety evidence here.'}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={onRunStagingSmoke} loading={checkingStagingSmoke}>
            Read-only smoke
          </Button>
          <Link href="/api/admin/ad-os/staging-smoke" className="inline-flex items-center gap-1 text-admin-2xs font-semibold text-blue-700">
            JSON <ArrowRight className="h-3 w-3" />
          </Link>
          <StatusPill tone={stagingSmoke?.safety.external_api_write === false && stagingSmoke.safety.database_mutation === false ? 'good' : 'warn'}>
            DB write {stagingSmoke?.safety.database_mutation ? 'on' : 'off'} - external write {stagingSmoke?.safety.external_api_write ? 'on' : 'off'}
          </StatusPill>
        </div>
      </div>

      <SafetyEvidenceList
        items={completionDrilldown.map((item) => ({
          id: item.id,
          label: item.label,
          evidence: item.evidence,
          nextAction: item.next_action,
          status: item.status,
          tone: requirementTone(item.status),
        }))}
        empty="No completion evidence loaded."
        containerClassName="mt-3 space-y-2"
        itemClassName="grid gap-2 border-t border-admin-border pt-2 md:grid-cols-[minmax(0,1fr)_auto]"
        emptyClassName="border-t border-admin-border pt-2 text-admin-2xs text-admin-muted"
      />
    </div>
  );
}
