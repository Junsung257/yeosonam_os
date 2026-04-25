'use client';

/**
 * DataTable — 어드민 ERP 데이터 테이블 단일 진입점
 *
 * 핵심 기능:
 *   - 행 높이 통일: comfortable=56px / compact=48px (admin-scope CSS 변수)
 *   - 컬럼 우선순위: priority 1=항상, 2=태블릿+, 3=데스크톱만 (반응형 자동)
 *   - sticky header
 *   - 좌측 alert 슬롯 (40px) 자동 분리
 *   - 행 hover, 클릭, zebra (옵션)
 *   - empty state, loading state
 *
 * 가상화는 5,000행 이상 케이스에서만 별도로(react-window 등) 도입.
 * 이 컴포넌트는 native <table> 기반.
 */

import type { ReactNode } from 'react';
import AlertIndicator, { type AlertLevel } from './AlertIndicator';

export interface ColumnDef<T> {
  key: string;
  header: ReactNode;
  /** 1=항상, 2=태블릿+ (>=768px), 3=데스크톱+ (>=1024px) */
  priority?: 1 | 2 | 3;
  width?: string;
  align?: 'left' | 'center' | 'right';
  sticky?: 'left' | 'right';
  cell: (row: T, index: number) => ReactNode;
  thClassName?: string;
  tdClassName?: string;
}

export interface AlertSlot {
  level: AlertLevel;
  tooltip?: string;
}

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string | number;
  onRowClick?: (row: T) => void;
  /** 좌측 알림 슬롯 — null 반환 시 빈 셀 */
  alertCell?: (row: T) => AlertSlot | null;
  emptyState?: ReactNode;
  loading?: boolean;
  zebra?: boolean;
  className?: string;
  /** 헤더가 sticky일 때 top offset (예: 어드민 상단바 높이) */
  stickyTop?: number;
}

const ALIGN_CLS = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const;

function priorityCls(priority?: 1 | 2 | 3) {
  if (priority === 2) return 'admin-col-priority-2';
  if (priority === 3) return 'admin-col-priority-3';
  return '';
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  alertCell,
  emptyState,
  loading = false,
  zebra = false,
  className = '',
  stickyTop = 0,
}: DataTableProps<T>) {
  return (
    <div className={`relative overflow-x-auto rounded-lg border border-admin-border bg-admin-surface ${className}`}>
      <table className="admin-data-table w-full border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-admin-border">
            {alertCell && (
              <th
                className="sticky z-10 bg-slate-50 w-10 px-2 py-3"
                style={{ top: stickyTop }}
                aria-label="알림"
              />
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                className={`sticky z-10 bg-slate-50 px-3 py-3 text-admin-xs font-semibold text-admin-textMuted uppercase tracking-wider ${ALIGN_CLS[col.align ?? 'left']} ${priorityCls(col.priority)} ${col.thClassName ?? ''}`}
                style={{ top: stickyTop, width: col.width }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td
                colSpan={columns.length + (alertCell ? 1 : 0)}
                className="px-3 py-12 text-center text-admin-sm text-admin-textMuted"
              >
                불러오는 중...
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length + (alertCell ? 1 : 0)}
                className="px-3 py-12 text-center text-admin-sm text-admin-textMuted"
              >
                {emptyState ?? '표시할 데이터가 없습니다'}
              </td>
            </tr>
          )}
          {!loading &&
            rows.map((row, index) => {
              const alert = alertCell?.(row) ?? null;
              const baseRowCls =
                'border-b border-slate-100 transition-colors';
              const zebraCls = zebra && index % 2 === 1 ? 'bg-slate-50/40' : 'bg-admin-surface';
              const hoverCls = onRowClick
                ? 'hover:bg-blue-50/40 cursor-pointer'
                : 'hover:bg-slate-50/60';
              return (
                <tr
                  key={getRowKey(row, index)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`${baseRowCls} ${zebraCls} ${hoverCls}`}
                >
                  {alertCell && (
                    <td className="w-10 px-2 text-center align-middle">
                      {alert ? (
                        <AlertIndicator level={alert.level} tooltip={alert.tooltip} />
                      ) : null}
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 align-middle text-admin-sm text-admin-text ${ALIGN_CLS[col.align ?? 'left']} ${priorityCls(col.priority)} ${col.tdClassName ?? ''}`}
                      style={col.width ? { width: col.width } : undefined}
                    >
                      {col.cell(row, index)}
                    </td>
                  ))}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
