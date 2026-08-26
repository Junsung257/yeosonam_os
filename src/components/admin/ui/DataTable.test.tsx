import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataTable, type ColumnDef } from './DataTable';

interface DemoRow {
  id: string;
  name: string;
  score: number;
}

const rows: DemoRow[] = [
  { id: 'a', name: '알파', score: 10 },
  { id: 'b', name: '베타', score: 30 },
  { id: 'c', name: '감마', score: 20 },
];

const columns: ColumnDef<DemoRow>[] = [
  {
    key: 'name',
    header: '이름',
    cell: (row) => row.name,
    sortValue: (row) => row.name,
  },
  {
    key: 'score',
    header: '점수',
    align: 'right',
    cell: (row) => row.score,
    sortValue: (row) => row.score,
  },
];

describe('DataTable', () => {
  it('applies a deterministic initial sort with accessible state', () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        initialSort={{ key: 'score', desc: true }}
      />,
    );

    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('내림차순 정렬됨');
    expect(html.indexOf('베타')).toBeLessThan(html.indexOf('감마'));
    expect(html.indexOf('감마')).toBeLessThan(html.indexOf('알파'));
  });

  it('renders loading skeletons instead of stale rows', () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        loading
        skeletonRows={3}
      />,
    );

    expect(html).not.toContain('알파');
    expect((html.match(/animate-pulse/g) ?? [])).toHaveLength(6);
  });
});
