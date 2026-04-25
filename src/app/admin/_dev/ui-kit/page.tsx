'use client';

/**
 * /admin/_dev/ui-kit — 어드민 공통 컴포넌트 시각 검증 페이지
 *
 * Phase 2 마이그레이션 baseline. Storybook 미사용이므로 이 페이지가 catalog 역할.
 */

import { useState } from 'react';
import {
  StatusBadge,
  AlertIndicator,
  SearchInput,
  DataTable,
  DensityToggle,
  SHORTCUT_REGISTRY,
  type ColumnDef,
} from '@/components/admin/ui';
import { Keyboard } from 'lucide-react';

interface DemoRow {
  id: string;
  name: string;
  status: string;
  amount: number;
  date: string;
  alert?: 'critical' | 'warning' | null;
}

const demoRows: DemoRow[] = [
  { id: 'B-001', name: '김여행',     status: 'fully_paid',      amount: 1_990_000, date: '2026-05-12', alert: null },
  { id: 'B-002', name: '이고객',     status: 'waiting_deposit', amount:   890_000, date: '2026-05-15', alert: 'warning' },
  { id: 'B-003', name: '박패키지',   status: 'cancelled',       amount: 2_300_000, date: '2026-05-20', alert: 'critical' },
  { id: 'B-004', name: '최예약',     status: 'deposit_paid',    amount: 1_550_000, date: '2026-05-22', alert: null },
];

const columns: ColumnDef<DemoRow>[] = [
  { key: 'id',     header: '예약번호', priority: 1, cell: (r) => <span className="font-semibold">{r.id}</span> },
  { key: 'name',   header: '고객명',   priority: 1, cell: (r) => r.name },
  { key: 'status', header: '상태',     priority: 1, cell: (r) => <StatusBadge kind="booking" value={r.status} /> },
  { key: 'amount', header: '금액',     priority: 2, align: 'right', cell: (r) => `₩${r.amount.toLocaleString()}` },
  { key: 'date',   header: '출발일',   priority: 2, cell: (r) => r.date },
  { key: 'memo',   header: '담당자',   priority: 3, cell: () => '여소남' },
];

export default function UiKitPage() {
  const [search, setSearch] = useState('');

  return (
    <div className="admin-scope max-w-5xl mx-auto py-6 space-y-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-admin-lg font-bold text-admin-text">어드민 UI Kit</h1>
          <p className="text-admin-sm text-admin-textMuted mt-1">Phase 2 공통 컴포넌트 시각 검증</p>
        </div>
        <DensityToggle />
      </header>

      <section>
        <h2 className="text-admin-md font-semibold text-admin-text mb-3">StatusBadge</h2>
        <div className="flex flex-wrap gap-2 p-4 rounded-lg border border-admin-border bg-admin-surface">
          <StatusBadge kind="booking" value="pending" />
          <StatusBadge kind="booking" value="waiting_deposit" />
          <StatusBadge kind="booking" value="deposit_paid" />
          <StatusBadge kind="booking" value="fully_paid" />
          <StatusBadge kind="booking" value="cancelled" />
          <StatusBadge kind="package" value="approved" />
          <StatusBadge kind="package" value="pending" />
          <StatusBadge kind="package" value="archived" />
          <StatusBadge kind="audit" value="clean" />
          <StatusBadge kind="audit" value="warnings" />
          <StatusBadge kind="audit" value="blocked" />
          <StatusBadge kind="grade" value="VVIP" />
          <StatusBadge kind="grade" value="우수" />
          <StatusBadge kind="grade" value="일반" />
          <StatusBadge kind="custom" tone="info" value="info" label="알림" withDot />
        </div>
      </section>

      <section>
        <h2 className="text-admin-md font-semibold text-admin-text mb-3">AlertIndicator</h2>
        <div className="flex gap-4 p-4 rounded-lg border border-admin-border bg-admin-surface">
          <AlertIndicator level="critical" tooltip="치명 오류" />
          <AlertIndicator level="warning"  tooltip="경고" />
          <AlertIndicator level="info"     tooltip="정보" />
          <AlertIndicator level="ok"       tooltip="정상" />
        </div>
      </section>

      <section>
        <h2 className="text-admin-md font-semibold text-admin-text mb-3">SearchInput</h2>
        <div className="flex gap-4 p-4 rounded-lg border border-admin-border bg-admin-surface">
          <SearchInput
            variant="topbar"
            placeholder="통합검색..."
            kbd="⌘K"
            width="240px"
          />
          <SearchInput
            variant="inline"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="고객명, 예약번호 검색"
            width="280px"
          />
        </div>
      </section>

      <section>
        <h2 className="text-admin-md font-semibold text-admin-text mb-3 flex items-center gap-2">
          <Keyboard size={18} className="text-admin-textMuted" />
          단축키 & ⌘K 명령 팔레트
        </h2>
        <div className="p-4 rounded-lg border border-admin-border bg-admin-surface space-y-3">
          <p className="text-admin-sm text-admin-textMuted">
            <kbd className="bg-slate-100 px-1.5 py-0.5 rounded font-mono border border-slate-200 text-admin-xs">
              ⌘ K
            </kbd>{' '}
            또는{' '}
            <kbd className="bg-slate-100 px-1.5 py-0.5 rounded font-mono border border-slate-200 text-admin-xs">
              Ctrl K
            </kbd>{' '}
            로 명령 팔레트 열기.{' '}
            <kbd className="bg-slate-100 px-1.5 py-0.5 rounded font-mono border border-slate-200 text-admin-xs">
              ?
            </kbd>{' '}
            로 단축키 도움말 모달 열기. 입력창 밖에서 G + 영문키 시퀀스로 페이지 이동.
          </p>
          <div className="grid grid-cols-2 gap-2 text-admin-sm">
            {SHORTCUT_REGISTRY.slice(0, 8).map((s) => (
              <div
                key={s.keys + s.label}
                className="flex items-center gap-2 px-2 py-1 rounded bg-slate-50"
              >
                <span className="flex gap-1 shrink-0">
                  {s.keys.split(' ').map((k, i) => (
                    <kbd
                      key={i}
                      className="bg-white text-admin-text px-1.5 py-0.5 rounded font-mono border border-slate-200 text-admin-xs"
                    >
                      {k}
                    </kbd>
                  ))}
                </span>
                <span className="text-admin-textMuted truncate">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-admin-md font-semibold text-admin-text mb-3">
          DataTable (행 클릭 + alert 슬롯 + 우선순위 컬럼)
        </h2>
        <DataTable<DemoRow>
          columns={columns}
          rows={demoRows}
          getRowKey={(r) => r.id}
          alertCell={(r) =>
            r.alert
              ? { level: r.alert, tooltip: r.alert === 'critical' ? '취소된 예약' : '계약금 대기' }
              : null
          }
          onRowClick={(r) => console.log('row clicked', r)}
          zebra
        />
      </section>
    </div>
  );
}
