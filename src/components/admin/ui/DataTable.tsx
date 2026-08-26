'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef as TanStackColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { AlertIndicator, type AlertLevel } from './AlertIndicator';

export interface ColumnDef<T> {
  key: string;
  header: ReactNode;
  /** 1=항상, 2=태블릿+ (>=768px), 3=데스크톱+ (>=1024px) */
  priority?: 1 | 2 | 3;
  width?: string;
  align?: 'left' | 'center' | 'right';
  sticky?: 'left' | 'right';
  cell: (row: T, index: number) => ReactNode;
  /** 제공한 경우에만 헤더 정렬을 활성화합니다. */
  sortValue?: (row: T) => string | number | null | undefined;
  sortDescFirst?: boolean;
  /** header가 문자열이 아닐 때 스크린리더에 제공할 정렬 라벨 */
  sortLabel?: string;
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
  getRowAriaLabel?: (row: T, index: number) => string;
  alertCell?: (row: T) => AlertSlot | null;
  emptyState?: ReactNode;
  emptyLabel?: string;
  loading?: boolean;
  skeletonRows?: number;
  zebra?: boolean;
  className?: string;
  stickyTop?: number;
  initialSort?: { key: string; desc?: boolean };
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

function SkeletonRow({ colCount, hasAlert }: { colCount: number; hasAlert: boolean }) {
  const widths = ['w-24', 'w-32', 'w-20', 'w-28', 'w-16', 'w-24', 'w-20', 'w-28'];
  return (
    <tr aria-hidden="true">
      {hasAlert && (
        <td className="w-10 px-2" aria-label="로딩 중">
          <div aria-hidden="true" className="h-3 w-3 bg-admin-border rounded-full mx-auto animate-pulse" />
        </td>
      )}
      {Array.from({ length: colCount }).map((_, i) => (
        <td key={i} className="px-3" aria-label="로딩 중">
          <div aria-hidden="true" className={`h-3.5 bg-admin-border rounded animate-pulse ${widths[i % widths.length]}`} />
        </td>
      ))}
    </tr>
  );
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  getRowAriaLabel,
  alertCell,
  emptyState,
  emptyLabel,
  loading = false,
  skeletonRows = 8,
  zebra = false,
  className = '',
  stickyTop = 0,
  initialSort,
}: DataTableProps<T>) {
  const colSpan = columns.length + (alertCell ? 1 : 0);
  const [sorting, setSorting] = useState<SortingState>(() => (
    initialSort ? [{ id: initialSort.key, desc: initialSort.desc ?? false }] : []
  ));
  const tableColumns = useMemo<TanStackColumnDef<T>[]>(
    () => columns.map((column) => ({
      id: column.key,
      accessorFn: column.sortValue ?? (() => null),
      enableSorting: Boolean(column.sortValue),
      sortDescFirst: column.sortDescFirst,
    })),
    [columns],
  );
  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const visibleRows = table.getRowModel().rows;

  return (
    <div
      className={`relative overflow-x-auto rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs ${className}`}
    >
      <table className="admin-data-table">
        <thead>
          <tr>
            {alertCell && (
              <th
                className="w-10 px-2"
                style={{ top: stickyTop }}
                scope="col"
              >
                <span className="sr-only">알림</span>
              </th>
            )}
            {columns.map((col) => {
              const tableColumn = table.getColumn(col.key);
              const sorted = tableColumn?.getIsSorted() ?? false;
              const canSort = tableColumn?.getCanSort() ?? false;
              const sortLabel = col.sortLabel ?? (typeof col.header === 'string' ? col.header : col.key);
              return (
                <th
                  key={col.key}
                  aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                  className={`${ALIGN_CLS[col.align ?? 'left']} ${priorityCls(col.priority)} ${col.thClassName ?? ''}`}
                  style={{ top: stickyTop, width: col.width }}
                  scope="col"
                >
                  {canSort ? (
                    <button
                      type="button"
                      onClick={tableColumn?.getToggleSortingHandler()}
                      className={`inline-flex w-full items-center gap-1 rounded-admin-sm text-inherit hover:text-admin-text focus-visible:outline-none focus-visible:shadow-admin-focus ${
                        col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : 'justify-start'
                      }`}
                      aria-label={`${sortLabel} 정렬`}
                    >
                      <span>{col.header}</span>
                      <span aria-hidden="true" className={sorted ? 'text-admin-text' : 'text-admin-muted-2'}>
                        {sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : '↕'}
                      </span>
                      <span className="sr-only">
                        {sorted === 'asc' ? '오름차순 정렬됨' : sorted === 'desc' ? '내림차순 정렬됨' : '정렬되지 않음'}
                      </span>
                    </button>
                  ) : col.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading && (
            Array.from({ length: skeletonRows }).map((_, i) => (
              <SkeletonRow key={i} colCount={columns.length} hasAlert={!!alertCell} />
            ))
          )}

          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="px-4 py-14 text-center" style={{ height: 'auto' }}>
                {emptyState ?? (
                  <div className="flex flex-col items-center gap-3">
                    <svg className="w-10 h-10 text-admin-border-strong" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                    </svg>
                    <p className="text-admin-sm font-medium text-admin-muted">{emptyLabel ?? '표시할 데이터가 없습니다'}</p>
                  </div>
                )}
              </td>
            </tr>
          )}

          {!loading && visibleRows.map((tableRow, index) => {
            const row = tableRow.original;
            const alert = alertCell?.(row) ?? null;
            const zebraCls = zebra && index % 2 === 1 ? 'admin-zebra' : '';
            const hoverCls = onRowClick ? 'cursor-pointer' : '';
            return (
              <tr
                key={getRowKey(row, index)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onRowClick(row);
                  }
                } : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                aria-label={getRowAriaLabel?.(row, index)}
                className={`${zebraCls} ${hoverCls} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500`}
              >
                {alertCell && (
                  <td className="w-10 px-2 text-center align-middle">
                    {alert ? <AlertIndicator level={alert.level} tooltip={alert.tooltip} /> : null}
                  </td>
                )}
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`${ALIGN_CLS[col.align ?? 'left']} ${priorityCls(col.priority)} ${col.tdClassName ?? ''}`}
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
