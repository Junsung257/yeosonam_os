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

function completionLabel(status?: CompletionAudit['status']): string {
  if (status === 'ready') return '준비 완료';
  if (status === 'blocked') return '차단';
  if (status === 'needs_attention') return '확인 필요';
  return '미확인';
}

function smokeLabel(status?: string): string {
  if (status === 'pass') return '통과';
  if (status === 'fail') return '실패';
  if (status === 'warn') return '확인 필요';
  return '미점검';
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
        <p className="text-admin-2xs font-semibold text-admin-muted">완료 점검</p>
        <StatusPill tone={completionTone(completionAudit?.status)}>
          {completionLabel(completionAudit?.status)}
        </StatusPill>
      </div>
      <p className="mt-1 admin-num text-admin-xl font-bold text-admin-text">
        {Number(completionAudit?.readiness_score || 0).toLocaleString('ko-KR')}%
      </p>
      <p className="mt-1 text-admin-2xs text-admin-muted">
        통과 {Number(completionAudit?.passed || 0).toLocaleString('ko-KR')} / 확인 {Number(completionAudit?.warnings || 0).toLocaleString('ko-KR')} / 실패 {Number(completionAudit?.failed || 0).toLocaleString('ko-KR')}
      </p>
      <p className="mt-2 line-clamp-2 text-admin-2xs leading-5 text-admin-muted">
        {completionAudit?.next_action || '완료로 표시하기 전에 현재 운영 근거를 수집하세요.'}
      </p>

      <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-admin-2xs font-semibold text-admin-muted">사전 안전 점검</p>
            <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">
              상품, 시나리오, 키워드, 소재, 실행, 전환 업로드, 포트폴리오, 학습 근거를 읽기 전용으로 점검합니다.
            </p>
          </div>
          <StatusPill tone={stagingSmoke?.ok ? 'good' : stagingSmoke ? 'bad' : 'neutral'}>
            {smokeLabel(stagingSmoke?.smoke.status)}
          </StatusPill>
        </div>
        <MetricGrid
          metrics={[
            {
              label: '점검 항목',
              value: `${Number(stagingSmoke?.smoke.passed_assertions || 0).toLocaleString('ko-KR')} / ${Number(
                (stagingSmoke?.smoke.passed_assertions || 0) + (stagingSmoke?.smoke.failed_assertions || 0),
              ).toLocaleString('ko-KR')}`,
            },
            { label: '키워드', value: Number(stagingSmoke?.smoke.counts.keywords || 0).toLocaleString('ko-KR') },
            { label: '소재', value: Number(stagingSmoke?.smoke.counts.creative_variants || 0).toLocaleString('ko-KR') },
            { label: '외부 광고비', value: fmtWon(stagingSmoke?.safety.external_spend_krw || 0) },
          ]}
        />
        <p className="mt-2 line-clamp-2 text-admin-2xs leading-5 text-admin-muted">
          {stagingSmoke?.smoke.next_action || '현재 운영 안전 근거를 확인하려면 사전 점검을 실행하세요.'}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={onRunStagingSmoke} loading={checkingStagingSmoke}>
            읽기 전용 점검
          </Button>
          <Link href="/api/admin/ad-os/staging-smoke" className="inline-flex items-center gap-1 text-admin-2xs font-semibold text-blue-700">
            JSON <ArrowRight className="h-3 w-3" />
          </Link>
          <StatusPill tone={stagingSmoke?.safety.external_api_write === false && stagingSmoke.safety.database_mutation === false ? 'good' : 'warn'}>
            DB 변경 {stagingSmoke?.safety.database_mutation ? '켜짐' : '꺼짐'} - 외부 반영 {stagingSmoke?.safety.external_api_write ? '켜짐' : '꺼짐'}
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
        empty="완료 점검 근거가 아직 없습니다."
        containerClassName="mt-3 space-y-2"
        itemClassName="grid gap-2 border-t border-admin-border pt-2 md:grid-cols-[minmax(0,1fr)_auto]"
        emptyClassName="border-t border-admin-border pt-2 text-admin-2xs text-admin-muted"
      />
    </div>
  );
}
