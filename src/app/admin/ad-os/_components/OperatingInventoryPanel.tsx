import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import Button from '@/components/ui/Button';
import type { OperatingInventory } from '../_lib/types';
import { fmtWon, inventoryTone } from '../_lib/display';
import { MetricGrid } from './MetricGrid';
import { SafetyEvidenceList } from './SafetyEvidenceList';
import { StatusPill } from './StatusPill';

function inventoryStatusLabel(status?: string): string {
  if (status === 'operational') return '정상';
  if (status === 'partial') return '확인 필요';
  if (status === 'blocked') return '막힘';
  return '미점검';
}

export function OperatingInventoryPanel({
  operatingInventory,
  checking,
  onRefresh,
}: {
  operatingInventory: OperatingInventory | null;
  checking: boolean;
  onRefresh: () => void;
}) {
  const inventory = operatingInventory?.inventory;
  const safety = inventory?.safety;

  return (
    <div className="rounded-admin-sm border border-admin-border bg-admin-surface p-3 md:col-span-2">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-admin-2xs font-semibold text-admin-muted">운영 항목 점검</p>
          <p className="mt-1 text-admin-xs font-semibold text-admin-text">
            {inventory?.top_gap || '광고 운영 항목을 점검하세요.'}
          </p>
          <p className="mt-1 line-clamp-2 text-admin-2xs leading-5 text-admin-muted">
            {inventory?.next_action || '관리 화면, 채널 실행, 전환 신호, 학습 루프, 소재 생성, 자동화 준비 상태를 함께 확인하세요.'}
          </p>
        </div>
        <StatusPill tone={inventoryTone(inventory?.status)}>
          {inventoryStatusLabel(inventory?.status)}
        </StatusPill>
      </div>

      <MetricGrid
        metrics={[
          { label: '점수', value: `${Number(inventory?.readiness_score || 0).toLocaleString('ko-KR')}%` },
          { label: '정상', value: Number(inventory?.operational || 0).toLocaleString('ko-KR') },
          { label: '확인 필요', value: Number(inventory?.partial || 0).toLocaleString('ko-KR') },
          { label: '막힘', value: Number(inventory?.blocked || 0).toLocaleString('ko-KR') },
        ]}
      />

      <SafetyEvidenceList
        items={(inventory?.items || []).slice(0, 8).map((item) => ({
          id: item.id,
          label: item.label,
          evidence: item.evidence,
          nextAction: item.next_action,
          status: item.status,
          tone: inventoryTone(item.status),
        }))}
        empty="운영 항목 점검을 실행하면 정상/확인 필요/막힘 영역이 표시됩니다."
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onRefresh} loading={checking}>
          운영 항목 점검
        </Button>
        <Link href="/api/admin/ad-os/operating-inventory" className="inline-flex items-center gap-1 text-admin-2xs font-semibold text-blue-700">
          JSON <ArrowRight className="h-3 w-3" />
        </Link>
        <StatusPill tone={safety?.external_api_write === false && safety.database_mutation === false ? 'good' : 'warn'}>
          실제 광고비 {fmtWon(safety?.live_spend_krw || 0)}
        </StatusPill>
      </div>
    </div>
  );
}
