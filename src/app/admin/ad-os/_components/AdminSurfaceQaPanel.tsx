import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import Button from '@/components/ui/Button';
import type { AdminSurfaceQa } from '../_lib/types';
import { auditTone, fmtWon } from '../_lib/display';
import { MetricGrid } from './MetricGrid';
import { SafetyEvidenceList } from './SafetyEvidenceList';
import { StatusPill } from './StatusPill';

export function AdminSurfaceQaPanel({
  adminSurfaceQa,
  checking,
  onRefresh,
}: {
  adminSurfaceQa: AdminSurfaceQa | null;
  checking: boolean;
  onRefresh: () => void;
}) {
  const safety = adminSurfaceQa?.qa.safety;

  return (
    <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3 md:col-span-2">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-admin-2xs font-semibold text-admin-muted">관리자 화면 QA</p>
          <p className="mt-1 text-admin-xs font-semibold text-admin-text">
            {adminSurfaceQa?.qa.top_gap || '관리자 운영 화면 6개를 확인하세요.'}
          </p>
          <p className="mt-1 line-clamp-2 text-admin-2xs leading-5 text-admin-muted">
            {adminSurfaceQa?.qa.next_action || '각 화면의 데이터 출처, 기대 상태, 상세 확인 경로를 점검합니다.'}
          </p>
        </div>
        <StatusPill tone={adminSurfaceQa ? auditTone(adminSurfaceQa.qa.status) : 'neutral'}>
          {adminSurfaceQa?.qa.status || '미점검'}
        </StatusPill>
      </div>

      <MetricGrid
        columns="md:grid-cols-5"
        metrics={[
          { label: '준비 점수', value: `${Number(adminSurfaceQa?.qa.readiness_score || 0).toLocaleString('ko-KR')}%` },
          { label: '통과', value: Number(adminSurfaceQa?.qa.passed || 0).toLocaleString('ko-KR') },
          { label: '주의', value: Number(adminSurfaceQa?.qa.warnings || 0).toLocaleString('ko-KR') },
          { label: '실패', value: Number(adminSurfaceQa?.qa.failed || 0).toLocaleString('ko-KR') },
          { label: '실제 광고비', value: fmtWon(safety?.live_spend_krw || 0) },
        ]}
      />

      <SafetyEvidenceList
        items={(adminSurfaceQa?.qa.surfaces || []).map((surface) => ({
          id: surface.id,
          label: surface.label,
          evidence: `${surface.path} - ${surface.evidence}`,
          nextAction: surface.next_action,
          status: surface.status,
          tone: auditTone(surface.status),
          href: surface.drilldown_url,
          hrefLabel: '화면 열기',
          meta: surface.expected_states.slice(0, 3).join(' / '),
        }))}
        empty="QA를 실행하면 6개 관리자 화면의 데이터 출처, 기대 상태, 다음 조치가 표시됩니다."
        containerClassName="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2"
        emptyClassName="rounded-admin-xs bg-admin-surface-2 px-3 py-2 text-admin-2xs text-admin-muted lg:col-span-2"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onRefresh} loading={checking}>
          화면 QA
        </Button>
        <Link href="/api/admin/ad-os/admin-surface-qa" className="inline-flex items-center gap-1 text-admin-2xs font-semibold text-blue-700">
          JSON <ArrowRight className="h-3 w-3" />
        </Link>
        <StatusPill tone={safety?.external_api_write === false && safety.database_mutation === false ? 'good' : 'warn'}>
          DB 변경 {safety?.database_mutation ? '켜짐' : '꺼짐'} - 외부 반영 {safety?.external_api_write ? '켜짐' : '꺼짐'}
        </StatusPill>
      </div>
    </div>
  );
}
