import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import Button from '@/components/ui/Button';
import type { OperatingInventory } from '../_lib/types';
import { fmtWon, inventoryTone } from '../_lib/display';
import { MetricGrid } from './MetricGrid';
import { SafetyEvidenceList } from './SafetyEvidenceList';
import { StatusPill } from './StatusPill';

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
          <p className="text-admin-2xs font-semibold text-admin-muted">Operating Inventory</p>
          <p className="mt-1 text-admin-xs font-semibold text-admin-text">
            {inventory?.top_gap || 'Review the Ad OS operating inventory.'}
          </p>
          <p className="mt-1 line-clamp-2 text-admin-2xs leading-5 text-admin-muted">
            {inventory?.next_action || 'Review control plane, UX, channel execution, conversion signals, learning loop, creative factory, SaaS, and autopilot readiness together.'}
          </p>
        </div>
        <StatusPill tone={inventoryTone(inventory?.status)}>
          {inventory?.status || 'not checked'}
        </StatusPill>
      </div>

      <MetricGrid
        metrics={[
          { label: 'Score', value: `${Number(inventory?.readiness_score || 0).toLocaleString('ko-KR')}%` },
          { label: 'Operational', value: Number(inventory?.operational || 0).toLocaleString('ko-KR') },
          { label: 'Partial', value: Number(inventory?.partial || 0).toLocaleString('ko-KR') },
          { label: 'Blocked', value: Number(inventory?.blocked || 0).toLocaleString('ko-KR') },
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
        empty="Run inventory check to load operational, partial, and blocked Ad OS areas."
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onRefresh} loading={checking}>
          Inventory check
        </Button>
        <Link href="/api/admin/ad-os/operating-inventory" className="inline-flex items-center gap-1 text-admin-2xs font-semibold text-blue-700">
          JSON <ArrowRight className="h-3 w-3" />
        </Link>
        <StatusPill tone={safety?.external_api_write === false && safety.database_mutation === false ? 'good' : 'warn'}>
          live spend {fmtWon(safety?.live_spend_krw || 0)}
        </StatusPill>
      </div>
    </div>
  );
}
