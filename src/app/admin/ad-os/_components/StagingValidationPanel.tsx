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
          <p className="text-admin-2xs font-semibold text-admin-muted">배포 전 검증 패키지</p>
          <p className="mt-1 text-admin-xs font-semibold text-admin-text">
            {stagingValidation?.validation.top_blocker || '배포 전 검증 상태를 확인하세요.'}
          </p>
          <p className="mt-1 line-clamp-2 text-admin-2xs leading-5 text-admin-muted">
            {stagingValidation?.validation.next_action || '읽기 전용 점검, DB 요약, 실제 광고비 사전 점검, 학습 근거, 외부 반영, 완전 자동 상태를 함께 확인합니다.'}
          </p>
        </div>
        <StatusPill tone={stagingValidation ? auditTone(stagingValidation.validation.status) : 'neutral'}>
          {stagingValidation?.validation.status || '미점검'}
        </StatusPill>
      </div>

      <MetricGrid
        columns="md:grid-cols-5"
        metrics={[
          { label: '준비 점수', value: `${Number(stagingValidation?.validation.readiness_score || 0).toLocaleString('ko-KR')}%` },
          { label: '통과', value: Number(stagingValidation?.validation.passed || 0).toLocaleString('ko-KR') },
          { label: '주의', value: Number(stagingValidation?.validation.warnings || 0).toLocaleString('ko-KR') },
          { label: '실패', value: Number(stagingValidation?.validation.failed || 0).toLocaleString('ko-KR') },
          { label: '실제 광고비', value: fmtWon(safety?.live_spend_krw || 0) },
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
        empty="검증을 실행하면 기본 점검, DB 요약, 실제 광고비 안전 상태, 학습 근거가 표시됩니다."
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onRefresh} loading={checking}>
          검증 실행
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
          DB 변경 {safety?.database_mutation ? '켜짐' : '꺼짐'} - 외부 반영 {safety?.external_api_write ? '켜짐' : '꺼짐'} - 완전 자동 {safety?.full_auto_allowed ? '켜짐' : '꺼짐'}
        </StatusPill>
      </div>
    </div>
  );
}
