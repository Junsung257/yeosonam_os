'use client';

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type SearchAdsCtrPoint = {
  name: string;
  ctr: number;
  spend: number;
};

type SearchAdsCtrChartProps = {
  data: SearchAdsCtrPoint[];
};

export default function SearchAdsCtrChart({ data }: SearchAdsCtrChartProps) {
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <XAxis dataKey="name" tick={{ fontSize: 9 }} />
        <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `${v}%`} />
        <Tooltip
          formatter={(v: unknown, n: unknown) => [
            n === 'ctr' ? `${v}%` : `₩${Number(v).toFixed(0)}K`,
            n === 'ctr' ? 'CTR' : '지출',
          ] as [string, string]}
        />
        <Bar dataKey="ctr" radius={[3, 3, 0, 0]}>
          {data.map((_, idx) => (
            <Cell key={idx} fill={idx < 3 ? '#059669' : '#94a3b8'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
