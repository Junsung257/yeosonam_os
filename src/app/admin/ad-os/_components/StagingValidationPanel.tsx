import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import Button from '@/components/ui/Button';
import type { StagingValidation } from '../_lib/types';
import { auditTone, fmtWon } from '../_lib/display';
import { MetricGrid } from './MetricGrid';
import { SafetyEvidenceList } from './SafetyEvidenceList';
import { StatusPill } from './StatusPill';

export function StagingValidationPanel({
  stagingValidation,
  checking,
  onRefresh,
}: {
  stagingValidation: StagingValidation | null;
  checking: boolean;
  onRefresh: () => void;
}) {
  const safety = stagingValidation?.validation.safety;

  return (
    <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3 md:col-span-2">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-admin-2xs font-semibold text-admin-muted">Staging Validation Package</p>
          <p className="mt-1 text-admin-xs font-semibold text-admin-text">
            {stagingValidation?.validation.top_blocker || 'Review the staging validation package.'}
          </p>
          <p className="mt-1 line-clamp-2 text-admin-2xs leading-5 text-admin-muted">
            {stagingValidation?.validation.next_action || 'Check read-only smoke, DB summary, live-spend preflight, learning evidence, external writes, and full-auto state together.'}
          </p>
        </div>
        <StatusPill tone={stagingValidation ? auditTone(stagingValidation.validation.status) : 'neutral'}>
          {stagingValidation?.validation.status || 'not checked'}
        </StatusPill>
      </div>

      <MetricGrid
        columns="md:grid-cols-5"
        metrics={[
          { label: 'Score', value: `${Number(stagingValidation?.validation.readiness_score || 0).toLocaleString('ko-KR')}%` },
          { label: 'Pass', value: Number(stagingValidation?.validation.passed || 0).toLocaleString('ko-KR') },
          { label: 'Warn', value: Number(stagingValidation?.validation.warnings || 0).toLocaleString('ko-KR') },
          { label: 'Fail', value: Number(stagingValidation?.validation.failed || 0).toLocaleString('ko-KR') },
          { label: 'Live spend', value: fmtWon(safety?.live_spend_krw || 0) },
        ]}
      />

      <SafetyEvidenceList
        items={(stagingValidation?.validation.checks || []).slice(0, 6).map((item) => ({
          id: item.id,
          label: item.label,
          evidence: item.evidence,
          nextAction: item.next_action,
          status: item.status,
          tone: auditTone(item.status),
        }))}
        empty="Run validation check to load smoke, DB summary, live-spend safety, and learning evidence."
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onRefresh} loading={checking}>
          Validation check
        </Button>
        <Link href="/api/admin/ad-os/staging-validation" className="inline-flex items-center gap-1 text-admin-2xs font-semibold text-blue-700">
          JSON <ArrowRight className="h-3 w-3" />
        </Link>
        <StatusPill tone={
          safety?.external_api_write === false &&
          safety.database_mutation === false &&
          safety.full_auto_allowed === false
            ? 'good'
            : 'warn'
        }>
          DB write {safety?.database_mutation ? 'on' : 'off'} - external write {safety?.external_api_write ? 'on' : 'off'} - full auto {safety?.full_auto_allowed ? 'on' : 'off'}
        </StatusPill>
      </div>
    </div>
  );
}
