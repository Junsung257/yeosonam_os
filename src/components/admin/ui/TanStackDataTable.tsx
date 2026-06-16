'use client';

import { useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

type ColumnPriority = 1 | 2 | 3;

export interface AdminTableColumnMeta {
  priority?: ColumnPriority;
  width?: string;
  align?: 'left' | 'center' | 'right';
  thClassName?: string;
  tdClassName?: string;
}

export type AdminTanStackColumn<T> = ColumnDef<T, unknown> & {
  meta?: AdminTableColumnMeta;
};

interface TanStackDataTableProps<T> {
  columns: AdminTanStackColumn<T>[];
  data: T[];
  getRowId?: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  emptyState?: ReactNode;
  emptyLabel?: string;
  loading?: boolean;
  skeletonRows?: number;
  zebra?: boolean;
  className?: string;
  stickyTop?: number;
}

const ALIGN_CLS = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const;

function priorityCls(priority?: ColumnPriority) {
  if (priority === 2) return 'admin-col-priority-2';
  if (priority === 3) return 'admin-col-priority-3';
  return '';
}

function SkeletonRow({ colCount }: { colCount: number }) {
  const widths = ['w-24', 'w-32', 'w-20', 'w-28', 'w-16', 'w-24', 'w-20', 'w-28'];
  return (
    <tr>
      {Array.from({ length: colCount }).map((_, i) => (
        <td key={i} className="px-3">
          <div className={`h-3.5 animate-pulse rounded bg-admin-border ${widths[i % widths.length]}`} />
        </td>
      ))}
    </tr>
  );
}

function SortIcon({ state }: { state: false | 'asc' | 'desc' }) {
  if (state === 'asc') return <ArrowUp size={12} aria-hidden="true" />;
  if (state === 'desc') return <ArrowDown size={12} aria-hidden="true" />;
  return <ArrowUpDown size={12} aria-hidden="true" />;
}

export function TanStackDataTable<T>({
  columns,
  data,
  getRowId,
  onRowClick,
  emptyState,
  emptyLabel,
  loading = false,
  skeletonRows = 8,
  zebra = false,
  className = '',
  stickyTop = 0,
}: TanStackDataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;
  const colSpan = table.getAllLeafColumns().length;

  return (
    <div className={`relative overflow-x-auto rounded-admin-md border border-admin-border-mid bg-admin-surface shadow-admin-xs ${className}`}>
      <table className="admin-data-table">
        <thead>
          {headerGroups.map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const meta = header.column.columnDef.meta as AdminTableColumnMeta | undefined;
                const sortState = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    className={`${ALIGN_CLS[meta?.align ?? 'left']} ${priorityCls(meta?.priority)} ${meta?.thClassName ?? ''}`}
                    style={{ top: stickyTop, width: meta?.width }}
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1.5 text-inherit"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <SortIcon state={sortState} />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: skeletonRows }).map((_, i) => (
              <SkeletonRow key={i} colCount={colSpan} />
            ))}

          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="px-4 py-14 text-center" style={{ height: 'auto' }}>
                {emptyState ?? (
                  <div className="flex flex-col items-center gap-3">
                    <svg className="h-10 w-10 text-admin-border-strong" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                    </svg>
                    <p className="text-admin-sm font-medium text-admin-muted">{emptyLabel ?? '표시할 데이터가 없습니다'}</p>
                  </div>
                )}
              </td>
            </tr>
          )}

          {!loading &&
            rows.map((row, index) => {
              const zebraCls = zebra && index % 2 === 1 ? 'admin-zebra' : '';
              const hoverCls = onRowClick ? 'cursor-pointer' : '';
              return (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={`${zebraCls} ${hoverCls}`}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as AdminTableColumnMeta | undefined;
                    return (
                      <td
                        key={cell.id}
                        className={`${ALIGN_CLS[meta?.align ?? 'left']} ${priorityCls(meta?.priority)} ${meta?.tdClassName ?? ''}`}
                        style={meta?.width ? { width: meta.width } : undefined}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
